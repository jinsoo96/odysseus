"""프로세스 경계를 넘는 짧은 임대(lease) 잠금.

API를 여러 인스턴스로 늘려도 같은 응시/대화 턴이 동시에 실행되지 않도록 Redis에
SET NX EX로 소유권을 둔다. 해제는 토큰을 비교한 뒤 DEL하는 Lua 스크립트로 수행해
만료 뒤 다른 프로세스가 얻은 잠금을 예전 요청이 지우지 못하게 한다.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from .runqueue import get_redis

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

    async def release(self) -> None:
        try:
            await get_redis().eval(_RELEASE_SCRIPT, 1, self.key, self.token)
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
    ok = await get_redis().set(key, token, nx=True, ex=max(5, int(ttl_s)))
    return RedisLease(key=key, token=token) if ok else None
