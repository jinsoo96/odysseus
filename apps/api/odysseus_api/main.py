import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .config import check_startup_security, https_only_enabled, settings
from .db import Base, SessionLocal, engine
from .secrets import install_encrypted_types, migrate_encrypted_storage
from .routers import (
    access,
    agent,
    assessments,
    attempts,
    auth,
    executions,
    files,
    internal,
    messenger,
    reference,
    resources,
    review,
    scenarios,
    settings as settings_router,
    users,
)
from .seed import bootstrap_if_empty, seed_demo_if_empty

# Routers import the models. Replace the persistence types before the first application query so
# Python sees plaintext while PostgreSQL stores authenticated ciphertext.
install_encrypted_types()

# create_all은 기존 테이블에 컬럼을 추가하지 않는다 — 스키마 변경은 여기에 idempotent DDL로 누적
MIGRATIONS: list[str] = [
    "ALTER TABLE attempts ADD COLUMN IF NOT EXISTS current_ordinal INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE executions ADD COLUMN IF NOT EXISTS callback_token VARCHAR(64)",
    "ALTER TABLE attempts ADD COLUMN IF NOT EXISTS snapshot JSONB",
    "ALTER TABLE scenarios ADD COLUMN IF NOT EXISTS npc_base_prompt TEXT NOT NULL DEFAULT ''",
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
    "ALTER TABLE events ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'server'",
    """
    UPDATE attempts a SET superseded = true
    WHERE a.superseded = false AND EXISTS (
        SELECT 1 FROM attempts b
        WHERE b.assessment_id = a.assessment_id AND b.user_id = a.user_id AND b.superseded = false
          AND (b.started_at > a.started_at OR (b.started_at = a.started_at AND b.id > a.id))
    )
    """,
    "CREATE UNIQUE INDEX IF NOT EXISTS attempts_one_active_per_user ON attempts (assessment_id, user_id) WHERE superseded = false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS created_ip VARCHAR(64)",
    "DROP TRIGGER IF EXISTS workspace_files_frozen ON workspace_files",
    """
    CREATE TRIGGER workspace_files_frozen BEFORE INSERT OR UPDATE OR DELETE ON workspace_files
        FOR EACH ROW EXECUTE FUNCTION workspace_files_frozen_guard()
    """,
]

# All API replicas run startup. One transaction-scoped advisory lock makes bootstrap DDL a single
# ordered operation instead of letting multiple replicas race CREATE/ALTER/TRIGGER statements.
SCHEMA_MIGRATION_LOCK = 5_472_943_197_011


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail before touching stored secrets if production credentials are incomplete.
    check_startup_security()
    for i in range(30):
        try:
            async with engine.begin() as conn:
                await conn.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": SCHEMA_MIGRATION_LOCK})
                await conn.run_sync(Base.metadata.create_all)
                for stmt in MIGRATIONS:
                    await conn.execute(text(stmt))
            break
        except Exception:
            if i == 29:
                raise
            await asyncio.sleep(2)

    async with SessionLocal() as db:
        # Legacy plaintext provider/AppSetting values are rewritten through the AES-GCM SQLAlchemy
        # types before normal request handling starts. This is idempotent on every boot.
        await migrate_encrypted_storage(db)
        if settings.seed_demo_data:
            await seed_demo_if_empty(db)
        else:
            await bootstrap_if_empty(db)
    yield
    await engine.dispose()


app = FastAPI(title="Odysseus API", version="0.1.0", lifespan=lifespan)

PROXY_MARKERS = ("x-forwarded-for", "x-forwarded-proto", "cf-visitor", "cf-connecting-ip")
MUTATING = frozenset({"POST", "PUT", "PATCH", "DELETE"})


@app.middleware("http")
async def no_store_and_origin_check(request, call_next):
    """ODY-023: 모든 API 응답은 저장하지 않는다 (답안·대화·평가가 브라우저 캐시에 남지 않게).
    ODY-024: 프록시를 거쳐 온 변경 요청은 Origin 이 이 사이트여야 한다 (CSRF).
    """
    if request.method in MUTATING and any(h in request.headers for h in PROXY_MARKERS):
        origin = request.headers.get("origin")
        host = request.headers.get("host", "")
        proto = (request.headers.get("x-forwarded-proto") or "http").split(",")[0].strip().lower()
        if origin:
            if origin.lower() != f"{proto}://{host}".lower():
                from fastapi.responses import JSONResponse

                return JSONResponse({"detail": "다른 출처에서 온 요청입니다"}, status_code=403)
        else:
            site = (request.headers.get("sec-fetch-site") or "").lower()
            if site in ("cross-site", "same-site"):
                from fastapi.responses import JSONResponse

                return JSONResponse({"detail": "다른 출처에서 온 요청입니다"}, status_code=403)
    response = await call_next(request)
    if request.url.path.startswith("/reference/web/asset"):
        response.headers.setdefault("Cache-Control", "private, max-age=300")
    else:
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
    return response


@app.middleware("http")
async def require_https_behind_proxy(request, call_next):
    """운영 모드: 프록시를 거쳐 온 변경 요청은 HTTPS 였어야 한다 (ODY-014)."""
    if https_only_enabled() and request.method in MUTATING and any(h in request.headers for h in PROXY_MARKERS):
        proto = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
        if proto != "https":
            from fastapi.responses import JSONResponse

            return JSONResponse({"detail": "HTTPS 로만 접속할 수 있습니다"}, status_code=403)
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3100", "http://127.0.0.1:3100"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(access.router)
app.include_router(scenarios.router)
app.include_router(assessments.router)
app.include_router(attempts.router)
app.include_router(messenger.router)
app.include_router(agent.router)
app.include_router(files.router)
app.include_router(reference.router)
app.include_router(resources.router)
app.include_router(executions.router)
app.include_router(review.router)
app.include_router(settings_router.router)
app.include_router(internal.router)


@app.get("/healthz")
async def healthz():
    return {"ok": True}
