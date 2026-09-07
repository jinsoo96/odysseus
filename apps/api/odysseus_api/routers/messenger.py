"""메신저 — 등장인물별 스레드 조회 + 메시지 전송(NPC 응답 생성).

동일한 응시/인물 스레드는 Redis lease로 직렬화한다. 따라서 API replica가 여러 개여도
두 NPC 답변이 같은 history를 보고 동시에 생성되어 순서가 뒤집히지 않는다.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import npc
from ..ai.errors import describe_error
from ..config import settings
from ..db import get_db
from ..definitions import definition_for_attempt, resolve_attempt_ai
from ..deps import get_current_user
from ..guests import guest_chat_gate
from ..locks import acquire_lease
from ..models import Attempt, Event, MessengerMessage, User
from ..ratelimit import enforce
from ..schemas import MessengerMessageOut, MessengerSendIn
from .attempts import get_attempt_for, require_own_active, scenario_in_attempt

router = APIRouter(tags=["messenger"])


def _find_character(scenario, character_key: str) -> dict:
    for c in scenario.characters or []:
        if c.get("key") == character_key:
            return c
    raise HTTPException(404, "등장인물을 찾을 수 없습니다")


@router.get(
    "/attempts/{attempt_id}/scenarios/{scenario_id}/messenger",
    response_model=list[MessengerMessageOut],
)
async def list_messages(
    attempt_id: uuid.UUID,
    scenario_id: uuid.UUID,
    character_key: str | None = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await get_attempt_for(attempt_id, user, db)
    await scenario_in_attempt(attempt, scenario_id, db, user)
    q = (
        select(MessengerMessage)
        .where(MessengerMessage.attempt_id == attempt_id, MessengerMessage.scenario_id == scenario_id)
        .order_by(MessengerMessage.created_at)
    )
    if character_key:
        q = q.where(MessengerMessage.character_key == character_key)
    return (await db.execute(q)).scalars().all()


@router.post(
    "/attempts/{attempt_id}/scenarios/{scenario_id}/messenger/{character_key}",
    response_model=list[MessengerMessageOut],
)
async def send_message(
    attempt_id: uuid.UUID,
    scenario_id: uuid.UUID,
    character_key: str,
    body: MessengerSendIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await require_own_active(attempt_id, user, db)
    scenario = await scenario_in_attempt(attempt, scenario_id, db, user, mutate=True)
    character = _find_character(scenario, character_key)
    enforce(f"messenger:{attempt_id}", per_min=12, burst=6, what="메시지 전송")
    await guest_chat_gate(db, user, attempt_id, what="메시지 전송")

    lease = await acquire_lease(
        f"messenger-turn:{attempt_id}:{scenario_id}:{character_key}", ttl_s=3 * 60
    )
    if lease is None:
        raise HTTPException(409, "이 대화방의 이전 메시지를 처리 중입니다. 답변이 온 뒤 다시 보내세요")

    try:
        await db.execute(select(Attempt).where(Attempt.id == attempt_id).with_for_update())
        sent = (
            await db.execute(
                select(func.count(MessengerMessage.id)).where(
                    MessengerMessage.attempt_id == attempt_id, MessengerMessage.sender == "candidate"
                )
            )
        ).scalar() or 0
        if sent >= settings.messenger_max_per_attempt:
            await db.rollback()
            raise HTTPException(
                429,
                f"이 시험에서 보낼 수 있는 메시지 한도({settings.messenger_max_per_attempt}건)에 도달했습니다",
            )

        definition = await definition_for_attempt(db, attempt, persist_legacy=False)
        res = await resolve_attempt_ai(db, definition, "npc")
        if res is None or not res.configured:
            await db.rollback()
            raise HTTPException(503, "AI가 설정되지 않았습니다. 관리자에게 문의하세요 (관리자 콘솔 > 설정)")

        user_msg = MessengerMessage(
            attempt_id=attempt_id,
            scenario_id=scenario_id,
            character_key=character_key,
            sender="candidate",
            content=body.content,
        )
        db.add(user_msg)
        db.add(
            Event(
                attempt_id=attempt_id,
                scenario_id=scenario_id,
                type="msg_sent",
                payload={"character": character_key, "chars": len(body.content)},
            )
        )
        await db.commit()

        history = (
            await db.execute(
                select(MessengerMessage)
                .where(
                    MessengerMessage.attempt_id == attempt_id,
                    MessengerMessage.scenario_id == scenario_id,
                    MessengerMessage.character_key == character_key,
                )
                .order_by(MessengerMessage.created_at)
            )
        ).scalars().all()

        try:
            reply = await npc.generate_reply(res, scenario, character, list(history))
            meta: dict = {}
        except Exception as e:  # noqa: BLE001
            reply = "(지금 자리를 비운 것 같습니다 — 잠시 후 다시 말을 걸어 보세요)"
            info = describe_error(e, where="npc")
            meta = {"error": info["code"], "correlation_id": info["correlation_id"]}

        npc_msg = MessengerMessage(
            attempt_id=attempt_id,
            scenario_id=scenario_id,
            character_key=character_key,
            sender="npc",
            content=reply,
            model=res.model,
            meta=meta,
        )
        db.add(npc_msg)
        db.add(
            Event(
                attempt_id=attempt_id,
                scenario_id=scenario_id,
                type="msg_received",
                payload={"character": character_key, "chars": len(reply), "error": meta.get("error")},
            )
        )
        await db.commit()
        await db.refresh(user_msg)
        await db.refresh(npc_msg)
        return [user_msg, npc_msg]
    finally:
        await lease.release()
