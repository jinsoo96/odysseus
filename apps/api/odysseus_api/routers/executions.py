"""실행 — IDE 터미널의 명령 실행 요청/조회."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import workspace as ws
from ..commands import validate_command
from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import Attempt, Event, Execution, User
from ..ratelimit import enforce
from ..runqueue import enqueue_run, new_callback_token
from ..schemas import ExecutionOut, RunIn
from .attempts import get_attempt_for, require_own_active, scenario_in_attempt

router = APIRouter(tags=["executions"])


@router.post(
    "/attempts/{attempt_id}/scenarios/{scenario_id}/run", response_model=ExecutionOut
)
async def run_command(
    attempt_id: uuid.UUID,
    scenario_id: uuid.UUID,
    body: RunIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await require_own_active(attempt_id, user, db)
    await scenario_in_attempt(attempt, scenario_id, db, user, mutate=True)
    command = validate_command(body.command, settings.run_command_max_len)
    enforce(f"run:{attempt_id}", per_min=30, burst=10, what="실행 요청")

    # COUNT -> INSERT 사이 race를 막는다. 동일 응시의 실행 admission을 Attempt row로
    # 직렬화하면 API replica가 여러 개여도 동시 상한을 넘겨 큐에 밀어 넣지 못한다.
    await db.execute(select(Attempt).where(Attempt.id == attempt_id).with_for_update())
    open_count = (
        await db.execute(
            select(func.count(Execution.id)).where(
                Execution.attempt_id == attempt_id, Execution.status.in_(("queued", "running"))
            )
        )
    ).scalar() or 0
    if open_count >= settings.run_max_concurrent_per_attempt:
        await db.rollback()
        raise HTTPException(
            429,
            f"실행 중인 명령이 이미 {open_count}개 있습니다. 끝나기를 기다리거나 Ctrl+C 로 중단하세요",
            headers={"Retry-After": "2"},
        )

    execution = Execution(
        attempt_id=attempt_id,
        scenario_id=scenario_id,
        user_id=user.id,
        source="ide",
        command=command,
        callback_token=new_callback_token(),
    )
    db.add(execution)
    db.add(
        Event(
            attempt_id=attempt_id,
            scenario_id=scenario_id,
            type="run_request",
            payload={"command": command[:200], "actor": "ide"},
        )
    )
    # PostgreSQL is the durable source of truth. Redis delivery happens after this commit and is
    # idempotent; queue_recovery repairs the crash/outage window by replaying rows still `queued`.
    await db.commit()
    await db.refresh(execution)

    rows = await ws.list_files(db, attempt_id, scenario_id)
    try:
        await enqueue_run(
            str(execution.id),
            command,
            ws.files_payload(rows),
            settings.run_timeout_s,
            attempt_id=str(execution.attempt_id),
            scenario_id=str(execution.scenario_id),
            source=execution.source,
            callback_token=execution.callback_token or "",
        )
    except Exception as exc:
        # Do not turn a transient Redis outage into a permanently failed execution. The committed
        # row stays queued and the reconciler will enqueue it when Redis returns.
        db.add(
            Event(
                attempt_id=attempt_id,
                scenario_id=scenario_id,
                type="run_enqueue_delayed",
                payload={"execution_id": str(execution.id), "error_type": type(exc).__name__},
            )
        )
        await db.commit()
    return execution


@router.get("/executions/{execution_id}", response_model=ExecutionOut)
async def get_execution(
    execution_id: uuid.UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    execution = await db.get(Execution, execution_id, populate_existing=True)
    if not execution:
        raise HTTPException(404, "실행을 찾을 수 없습니다")
    await get_attempt_for(execution.attempt_id, user, db)
    return execution


@router.get(
    "/attempts/{attempt_id}/scenarios/{scenario_id}/executions",
    response_model=list[ExecutionOut],
)
async def list_executions(
    attempt_id: uuid.UUID,
    scenario_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    attempt = await get_attempt_for(attempt_id, user, db)
    await scenario_in_attempt(attempt, scenario_id, db, user)
    return (
        await db.execute(
            select(Execution)
            .where(Execution.attempt_id == attempt_id, Execution.scenario_id == scenario_id)
            .order_by(Execution.created_at)
        )
    ).scalars().all()
