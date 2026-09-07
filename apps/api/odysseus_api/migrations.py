"""Small versioned migration runner for Odysseus.

Historically startup kept a raw list of DDL strings in `main.py`; every boot replayed every statement
and there was no ledger telling operators which schema changes had actually been applied. This module
keeps the zero-extra-dependency deployment model while providing ordered versions, a durable ledger,
and one PostgreSQL advisory lock across API replicas.

Migrations must remain backward-compatible/idempotent because existing installations may already have
some of the pre-ledger DDL effects. New schema changes should be appended as a new Migration; never
edit a migration that has shipped.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

SCHEMA_MIGRATION_LOCK = 5_472_943_197_011


@dataclass(frozen=True, slots=True)
class Migration:
    version: int
    name: str
    statements: tuple[str, ...]


MIGRATIONS: tuple[Migration, ...] = (
    Migration(
        1,
        "attempt sequencing and execution callbacks",
        (
            "ALTER TABLE attempts ADD COLUMN IF NOT EXISTS current_ordinal INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE executions ADD COLUMN IF NOT EXISTS callback_token VARCHAR(64)",
            "ALTER TABLE attempts ADD COLUMN IF NOT EXISTS snapshot JSONB",
            "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS npc_base_prompt TEXT NOT NULL DEFAULT ''",
        ),
    ),
    Migration(
        2,
        "freeze completed workspaces",
        (
            """
            CREATE OR REPLACE FUNCTION workspace_files_frozen_guard() RETURNS trigger AS $$
            DECLARE st TEXT;
            BEGIN
                SELECT status INTO st FROM attempts WHERE id = COALESCE(NEW.attempt_id, OLD.attempt_id);
                IF st IS NOT NULL AND st <> 'in_progress' THEN
                    RAISE EXCEPTION 'workspace is frozen: attempt % is %', COALESCE(NEW.attempt_id, OLD.attempt_id), st
                        USING ERRCODE = 'check_violation';
                END IF;
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END $$ LANGUAGE plpgsql
            """,
            "DROP TRIGGER IF EXISTS workspace_files_frozen ON workspace_files",
            """
            CREATE TRIGGER workspace_files_frozen BEFORE INSERT OR UPDATE OR DELETE ON workspace_files
                FOR EACH ROW EXECUTE FUNCTION workspace_files_frozen_guard()
            """,
        ),
    ),
    Migration(
        3,
        "event provenance and user origin",
        (
            "ALTER TABLE events ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'server'",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_ip VARCHAR(64)",
        ),
    ),
    Migration(
        4,
        "one active attempt per assessment and user",
        (
            """
            UPDATE attempts a SET superseded = true
            WHERE a.superseded = false AND EXISTS (
                SELECT 1 FROM attempts b
                WHERE b.assessment_id = a.assessment_id AND b.user_id = a.user_id AND b.superseded = false
                  AND (b.started_at > a.started_at OR (b.started_at = a.started_at AND b.id > a.id))
            )
            """,
            "CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_active_per_user ON attempts (assessment_id, user_id) WHERE superseded = false",
        ),
    ),
    Migration(
        5,
        "durable execution input snapshots",
        (
            "ALTER TABLE executions ADD COLUMN IF NOT EXISTS input_files JSONB",
        ),
    ),
)


async def run_schema_migrations(conn: AsyncConnection, create_all=None) -> list[Migration]:
    """Apply pending migrations under one transaction/advisory lock and return what was applied.

    create_all(metadata.create_all) 을 넘기면 같은 lock 아래에서 먼저 실행한다 — 동시에 뜨는 replica 가
    CREATE TABLE 을 서로 부딪히지 않게.
    """
    await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SCHEMA_MIGRATION_LOCK})
    if create_all is not None:
        await conn.run_sync(create_all)
    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                name VARCHAR(200) NOT NULL,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """
        )
    )
    applied_versions = set(
        (await conn.execute(text("SELECT version FROM schema_migrations"))).scalars().all()
    )
    applied: list[Migration] = []
    for migration in MIGRATIONS:
        if migration.version in applied_versions:
            continue
        for statement in migration.statements:
            await conn.execute(text(statement))
        await conn.execute(
            text("INSERT INTO schema_migrations(version, name) VALUES (:version, :name)"),
            {"version": migration.version, "name": migration.name},
        )
        applied.append(migration)
    return applied
