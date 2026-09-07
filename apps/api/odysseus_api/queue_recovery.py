"""Recover the DB-commit -> Redis-enqueue crash window.

Execution is durable in PostgreSQL first. `enqueue_run` is idempotent, so periodically replaying every
row still marked `queued` is safe: an already pending/processing execution has its Redis marker and is
not duplicated, while a process crash before enqueue is repaired automatically.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from . import workspace as ws
from .config import settings
from .db import SessionLocal
from .models import Execution
from .runqueue import enqueue_run

log = logging.getLogger("odysseus.queue-recovery")
RECONCILE_INTERVAL_S = 15.0
BATCH_SIZE = 100


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
                files = await ws.list_files(db, execution.attempt_id, execution.scenario_id)
                added = await enqueue_run(
                    str(execution.id),
                    execution.command,
                    ws.files_payload(files),
                    settings.run_timeout_s,
                    attempt_id=str(execution.attempt_id),
                    scenario_id=str(execution.scenario_id),
                    source=execution.source,
                    callback_token=execution.callback_token or "",
                )
                recovered += int(added)
            except Exception as exc:  # noqa: BLE001 — Redis recovery continues next interval
                log.warning("queued execution reconciliation failed id=%s: %s", execution.id, type(exc).__name__)
    return recovered


async def recovery_loop() -> None:
    while True:
        try:
            count = await reconcile_once()
            if count:
                log.warning("re-enqueued %d committed executions missing from Redis pending queue", count)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("execution queue reconciliation failed")
        await asyncio.sleep(RECONCILE_INTERVAL_S)
