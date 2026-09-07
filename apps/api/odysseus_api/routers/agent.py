"""AI 에이전트 라우터 — SSE 스트리밍 도구 루프 + 이력/사용량."""

import asyncio
import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import agent as agent_ai
from ..ai import provider as ai_provider
from ..ai.errors import describe_error, public_meta
from ..config import settings
from ..db import SessionLocal, get_db
from ..definitions import definition_for_attempt, resolve_attempt_ai
from ..deps import get_current_user
from ..guests import guest_chat_gate
from ..locks import acquire_lease
from ..models import AgentMessage, Attempt, Event, User
from ..ratelimit import enforce
from ..schemas import AgentMessageOut, AgentSendIn, AgentUsageOut
from .attempts import get_attempt_for, require_own_active, scenario_in_attempt

router = APIRouter(tags=["agent"])


async def _used_turns(db: AsyncSession, attempt_id: uuid.UUID) -> int:
    return (
        await db.execute(
            select(func.count(AgentMessage.id)).where(
                AgentMessage.attempt_id == attempt_id, AgentMessage.role == "user"
            )
        )
    ).scalar() or 0


@router.get("/attempts/{attempt_id}/agent/usage", response_model=AgentUsageOut)
async def agent_usage(
    attempt_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    attempt = await get_attempt_for(attempt_id, user, db)
    definition = await definition_for_attempt(db, attempt)
    max_turns = int(definition.get("agent_max_turns", 0) or 0)
    used = await _used_turns(db, attempt_id)
    res = await resolve_attempt_ai(db, definition, "agent")
    return AgentUsageOut(
        enabled=max_turns > 0,
        used=used,
        max=max_turns,
        remaining=max(0, max_turns - used),
        configured=bool(res and res.configured),
        model=res.model if res else None,
        tools_available=bool(res and ai_provider.agent_tools_available(res)),
        provider_name=res.name if res else None,
    )


@router.get(
    "/attempts/{attempt_id}/scenarios/{scenario_id}/agent/messages",
    response_model=list[AgentMessageOut],
)
async def list_agent_messages(
    attempt_id: uuid.UUID,
    scenario_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await get_attempt_for(attempt_id, user, db)
    await scenario_in_attempt(attempt, scenario_id, db, user)
    rows = (
        await db.execute(
            select(AgentMessage)
            .where(AgentMessage.attempt_id == attempt_id, AgentMessage.scenario_id == scenario_id)
            .order_by(AgentMessage.created_at)
        )
    ).scalars().all()
    return [
        AgentMessageOut(id=r.id, role=r.role, content=r.content, model=r.model, meta=public_meta(r.meta), created_at=r.created_at)
        for r in rows
    ]


@router.post("/attempts/{attempt_id}/scenarios/{scenario_id}/agent/messages")
async def send_agent_message(
    attempt_id: uuid.UUID,
    scenario_id: uuid.UUID,
    body: AgentSendIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await require_own_active(attempt_id, user, db)
    scenario = await scenario_in_attempt(attempt, scenario_id, db, user, mutate=True)
    if not scenario.agent_enabled:
        raise HTTPException(403, "이 시나리오에서는 AI 에이전트를 사용할 수 없습니다")
    enforce(f"agent:{attempt_id}", per_min=12, burst=6, what="에이전트 요청")
    await guest_chat_gate(db, user, attempt_id, what="에이전트 요청")

    definition = await definition_for_attempt(db, attempt)
    max_turns = int(definition.get("agent_max_turns", 0) or 0)
    if max_turns <= 0:
        raise HTTPException(403, "이 시험에서는 AI 에이전트를 사용할 수 없습니다")

    res = await resolve_attempt_ai(db, definition, "agent")
    if res is None or not res.configured:
        raise HTTPException(503, "AI가 설정되지 않았습니다. 관리자에게 문의하세요 (관리자 콘솔 > 설정)")

    turn_lease = await acquire_lease(f"agent-turn:{attempt_id}", ttl_s=15 * 60)
    if turn_lease is None:
        raise HTTPException(409, "이미 진행 중인 에이전트 요청이 있습니다. 끝난 뒤 다시 보내세요")

    reserved = False
    try:
        await db.execute(select(Attempt).where(Attempt.id == attempt_id).with_for_update())
        used = await _used_turns(db, attempt_id)
        if used >= max_turns:
            await db.rollback()
            raise HTTPException(429, f"에이전트 사용 한도({max_turns}회)를 모두 사용했습니다")

        history = (
            await db.execute(
                select(AgentMessage)
                .where(AgentMessage.attempt_id == attempt_id, AgentMessage.scenario_id == scenario_id)
                .order_by(AgentMessage.created_at.desc())
                .limit(settings.agent_history_limit)
            )
        ).scalars().all()
        messages = [{"role": m.role, "content": m.content} for m in reversed(list(history)) if m.content]
        messages.append({"role": "user", "content": body.content})

        user_msg = AgentMessage(
            attempt_id=attempt_id, scenario_id=scenario_id, role="user", content=body.content
        )
        db.add(user_msg)
        db.add(
            Event(
                attempt_id=attempt_id,
                scenario_id=scenario_id,
                type="agent_turn",
                payload={"chars": len(body.content), "turn": used + 1, "max": max_turns},
            )
        )
        await db.commit()
        reserved = True
    finally:
        if not reserved:
            await turn_lease.release()

    user_id = user.id

    async def persist(parts: list[str], steps: list[dict], error: str | None, correlation_id: str | None = None) -> str | None:
        async with SessionLocal() as s:
            meta: dict = {"steps": steps}
            if error:
                meta["error"] = error
                if correlation_id:
                    meta["correlation_id"] = correlation_id
            msg = AgentMessage(
                attempt_id=attempt_id,
                scenario_id=scenario_id,
                role="assistant",
                content="".join(parts),
                model=res.model,
                meta=meta,
            )
            s.add(msg)
            await s.commit()
            return str(msg.id)

    async def event_stream():
        parts: list[str] = []
        steps: list[dict] = []
        error: str | None = None
        correlation_id: str | None = None
        persisted = False
        try:
            try:
                async for ev in agent_ai.run_agent_turn(
                    db, res, attempt_id, scenario_id, user_id, messages
                ):
                    if "delta" in ev:
                        parts.append(ev["delta"])
                        yield f"data: {json.dumps({'delta': ev['delta']}, ensure_ascii=False)}\n\n"
                    elif "tool" in ev:
                        yield f"data: {json.dumps({'tool': ev['tool']}, ensure_ascii=False)}\n\n"
                    elif "steps" in ev:
                        steps = ev["steps"]
            except Exception as e:  # noqa: BLE001
                info = describe_error(e, where="agent")
                error = info["code"]
                correlation_id = info["correlation_id"]
                yield f"data: {json.dumps({'error': info['message'], 'code': info['code'], 'correlation_id': correlation_id}, ensure_ascii=False)}\n\n"
            msg_id = await persist(parts, steps, error, correlation_id)
            persisted = True
            yield f"data: {json.dumps({'done': True, 'message_id': msg_id})}\n\n"
        finally:
            if not persisted:
                asyncio.get_running_loop().create_task(persist(parts, steps, error or "AI_BACKEND_ERROR", correlation_id))
            await turn_lease.release()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
