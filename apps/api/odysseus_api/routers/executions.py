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

    # Persist exactly what this command is supposed to see before committing the durable Execution.
    # A Redis outage/restart can then replay this identical input instead of a later workspace state.
    rows = await ws.list_files(db, attempt_id, scenario_id)
    input_files = ws.files_payload(rows)
    execution = Execution(
        attempt_id=attempt_id,
        scenario_id=scenario_id,
        user_id=user.id,
        source="ide",
        command=command,
        input_files=input_files,
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
    await db.commit()
    await db.refresh(execution)

    try:
        delivered = await enqueue_run(
            str(execution.id),
            command,
            execution.input_files or [],
            settings.run_timeout_s,
            attempt_id=str(execution.attempt_id),
            scenario_id=str(execution.scenario_id),
            source=execution.source,
            callback_token=execution.callback_token or "",
        )
        if not delivered:
            db.add(
                Event(
                    attempt_id=attempt_id,
                    scenario_id=scenario_id,
                    type="run_enqueue_delayed",
                    payload={"execution_id": str(execution.id), "reason": "redis_unavailable_or_already_pending"},
                )
            )
            await db.commit()
    except Exception as exc:
        # Programming/serialization errors still surface in telemetry while leaving the durable row for
        # the reconciler. Transient Redis errors are normally converted to delivered=False in runqueue.
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
