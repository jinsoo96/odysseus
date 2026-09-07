import hashlib
import hmac
import json
import secrets

import redis.asyncio as aioredis

from .config import settings

QUEUE_KEY = "odysseus:run:queue"
ENQUEUED_TTL_S = 24 * 3600

_redis: aioredis.Redis | None = None

# Marker + LPUSH happen in one Redis transaction (Lua). A reconciler can therefore call enqueue_run
# repeatedly for every DB row still in `queued` without creating duplicate pending jobs.
_ENQUEUE_LUA = """
if redis.call('SET', KEYS[2], '1', 'NX', 'EX', ARGV[2]) then
  redis.call('LPUSH', KEYS[1], ARGV[1])
  return 1
end
return 0
"""


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def canonical_job(job: dict) -> bytes:
    return json.dumps(
        {k: v for k, v in job.items() if k != "sig"},
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    ).encode("utf-8")


def sign_job(job: dict) -> str:
    return hmac.new(
        settings.internal_token.encode("utf-8"), canonical_job(job), hashlib.sha256
    ).hexdigest()


def new_callback_token() -> str:
    return secrets.token_urlsafe(32)


def enqueue_marker(execution_id: str) -> str:
    return f"odysseus:run:enqueued:{execution_id}"


async def enqueue_run(
    execution_id: str,
    command: str,
    files: list[dict],
    timeout_s: int,
    *,
    attempt_id: str = "",
    scenario_id: str = "",
    source: str = "",
    callback_token: str = "",
) -> bool:
    """Atomically enqueue once per execution id. Returns True only when a new queue item was added."""
    job = {
        "execution_id": execution_id,
        "command": command,
        "files": files,
        "timeout_s": timeout_s,
        "attempt_id": attempt_id,
        "scenario_id": scenario_id,
        "source": source,
        "callback_token": callback_token,
    }
    job["sig"] = sign_job(job)
    payload = json.dumps(job, ensure_ascii=False, separators=(",", ":"))
    added = await get_redis().eval(
        _ENQUEUE_LUA,
        2,
        QUEUE_KEY,
        enqueue_marker(execution_id),
        payload,
        ENQUEUED_TTL_S,
    )
    return bool(added)
