"""프로세스 경계를 넘는 짧은 임대(lease) 잠금.

API를 여러 인스턴스로 늘려도 같은 응시/대화 턴이 동시에 실행되지 않도록 Redis에
SET NX EX로 소유권을 둔다. 해제는 토큰을 비교한 뒤 DEL하는 Lua 스크립트로 수행해
만료 뒤 다른 프로세스가 얻은 잠금을 예전 요청이 지우지 못하게 한다.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass

from redis.exceptions import RedisError

from .runqueue import get_redis

log = logging.getLogger("odysseus.locks")
# Redis 가 잠시 없을 때의 프로세스 로컬 폴백 — 단일 인스턴스에서는 main 의 asyncio.Lock 과 같은 보장이다.
# 여러 인스턴스라면 폴백 동안 인스턴스 간 배타는 잃지만, 500 으로 대화를 끊는 것보다 낫다.
_local_held: dict[str, float] = {}

_PREFIX = "odysseus:lease:"
_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


@dataclass(slots=True)
class RedisLease:
    key: str
    token: str
    local: bool = False

    async def release(self) -> None:
        if self.local:
            if _local_held.get(self.key) is not None:
                _local_held.pop(self.key, None)
            return
        try:
            # 요청 태스크가 취소(클라이언트 이탈)돼도 Redis 쪽 DEL 은 끝까지 간다 — 그렇지 않으면
            # 새로고침 한 번에 이 응시의 다음 턴이 TTL 동안 409 로 막힌다.
            await asyncio.shield(get_redis().eval(_RELEASE_SCRIPT, 1, self.key, self.token))
        except asyncio.CancelledError:
            pass
        except Exception:
            # 해제 실패가 사용자 응답을 깨면 안 된다. TTL이 최종 안전장치다.
            pass


async def acquire_lease(name: str, *, ttl_s: int = 900) -> RedisLease | None:
    """이름의 분산 lease를 얻는다. 이미 누가 가지고 있으면 None.

    ttl_s는 API 프로세스가 비정상 종료되어 finally가 실행되지 않는 경우의 안전장치다.
    일반 턴보다 충분히 길게 잡되 영구 잠금은 만들지 않는다.
    """
    token = secrets.token_urlsafe(24)
    key = _PREFIX + name
    ttl = max(5, int(ttl_s))
    try:
        ok = await get_redis().set(key, token, nx=True, ex=ttl)
    except (RedisError, OSError):
        log.warning("Redis lease unavailable; process-local fallback name=%s", name)
        now = time.monotonic()
        held_until = _local_held.get(key)
        if held_until is not None and held_until > now:
            return None
        _local_held[key] = now + ttl
        return RedisLease(key=key, token=token, local=True)
    return RedisLease(key=key, token=token) if ok else None
