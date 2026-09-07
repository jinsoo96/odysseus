"""Execution delivery reconciliation and stale-run recovery.

PostgreSQL owns the durable execution state and exact input snapshot. Redis is a delivery layer:
- queued rows are idempotently replayed when Redis/API delivery was interrupted;
- running rows that outlive the sandbox + callback safety window are closed and cancelled so a dead
  runner cannot consume an attempt's concurrency slot forever.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from . import workspace as ws
from .config import settings
from .db import SessionLocal
from .models import Event, Execution, utcnow
from .runqueue import enqueue_run, get_redis

log = logging.getLogger("odysseus.queue-recovery")
RECONCILE_INTERVAL_S = 15.0
BATCH_SIZE = 100
CANCEL_KEY = "odysseus:runner:cancel"
STALE_RUNNING_MIN_S = 5 * 60


async def reconcile_once() -> int:
    recovered = 0
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                select(Execution)
                .where(Execution.status == "queued", Execution.callback_token.is_not(None))
                .order_by(Execution.created_at)
                .limit(BATCH_SIZE)
            )
        ).scalars().all()
        for execution in rows:
            try:
                input_files = execution.input_files
                if input_files is None:
                    legacy_rows = await ws.list_files(db, execution.attempt_id, execution.scenario_id)
                    input_files = ws.files_payload(legacy_rows)
                added = await enqueue_run(
                    str(execution.id),
                    execution.command,
                    input_files,
                    settings.run_timeout_s,
                    attempt_id=str(execution.attempt_id),
                    scenario_id=str(execution.scenario_id),
                    source=execution.source,
                    callback_token=execution.callback_token or "",
                )
                recovered += int(added)
            except Exception as exc:  # noqa: BLE001 — recovery continues next interval
                log.warning("queued execution reconciliation failed id=%s: %s", execution.id, type(exc).__name__)
    return recovered


async def _started_at(db, execution: Execution):
    """Read the server-observed runner start timestamp from the append-only event log."""
    rows = (
        await db.execute(
            select(Event)
            .where(
                Event.attempt_id == execution.attempt_id,
                Event.scenario_id == execution.scenario_id,
                Event.type == "run_started",
            )
            .order_by(Event.created_at.desc())
            .limit(50)
        )
    ).scalars().all()
    expected = str(execution.id)
    for event in rows:
        if str((event.payload or {}).get("execution_id") or "") == expected:
            return event.created_at
    return None


async def reap_stale_running() -> int:
    """Close executions whose runner vanished after marking them running."""
    threshold_s = max(STALE_RUNNING_MIN_S, int(settings.run_timeout_s) + 180)
    cutoff = utcnow() - timedelta(seconds=threshold_s)
    reaped = 0
    async with SessionLocal() as db:
        running = (
            await db.execute(
                select(Execution)
                .where(Execution.status == "running", Execution.callback_token.is_not(None))
                .order_by(Execution.created_at)
                .limit(BATCH_SIZE)
            )
        ).scalars().all()
        for execution in running:
            started = await _started_at(db, execution)
            # Old versions did not emit run_started. created_at is a conservative compatibility fallback.
            observed = started or execution.created_at
            if not observed or observed > cutoff:
                continue
            execution.status = "error"
            execution.stderr = (
                (execution.stderr or "")
                + "\n[러너 응답이 장시간 없어 고아 실행을 자동 종료했습니다]"
            ).strip()
            execution.finished_at = utcnow()
            execution.callback_token = None
            db.add(
                Event(
                    attempt_id=execution.attempt_id,
                    scenario_id=execution.scenario_id,
                    type="run_stale_reaped",
                    payload={
                        "execution_id": str(execution.id),
                        "threshold_s": threshold_s,
                        "actor": "queue_recovery",
                    },
                )
            )
            try:
                r = get_redis()
                await r.sadd(CANCEL_KEY, str(execution.id))
                await r.expire(CANCEL_KEY, 6 * 3600)
            except Exception:  # noqa: BLE001 — DB closure must not depend on Redis availability
                pass
            reaped += 1
        if reaped:
            await db.commit()
    return reaped


async def recovery_loop() -> None:
    while True:
        try:
            count = await reconcile_once()
            if count:
                log.warning("re-enqueued %d committed executions missing from Redis pending queue", count)
            stale = await reap_stale_running()
            if stale:
                log.warning("reaped %d stale running executions", stale)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("execution queue reconciliation failed")
        await asyncio.sleep(RECONCILE_INTERVAL_S)
