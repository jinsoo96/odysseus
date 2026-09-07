from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://odysseus:odysseus@localhost:5432/odysseus"
    redis_url: str = "redis://localhost:6379/0"

    # 시크릿에는 기본값이 없다 — 운영 모드에서는 충분히 긴 무작위 값이 없으면 기동을 거부한다
    jwt_secret: str = ""
    jwt_expire_hours: int = 12
    session_idle_hours: int = 4
    internal_token: str = ""
    # DB에 보관되는 공급자 API 키/AppSetting JSON을 AES-GCM으로 암호화하는 별도 키.
    # 백업 복원에도 같은 값이 필요하며 JWT_SECRET과 분리해 회전 범위를 제한한다.
    data_encryption_key: str = ""
    internal_api_base: str = "http://127.0.0.1:8000"

    # 운영 모드가 기본. development 에서만 데모 시드(고정 비밀번호)가 허용된다.
    odysseus_env: str = "production"
    seed_demo_data: bool = False
    bootstrap_admin_email: str = ""
    bootstrap_admin_password: str = ""
    cookie_secure: bool | None = None
    https_only: bool | None = None

    # DB에 공급자가 없을 때의 env 폴백 (OpenAI 호환)
    ai_base_url: str = "https://api.openai.com/v1"
    ai_api_key: str = ""
    ai_chat_model: str = "gpt-4o-mini"
    ai_eval_model: str = "gpt-4o-mini"

    # 워크스페이스 제한
    max_file_bytes: int = 400 * 1024
    max_files_per_scenario: int = 600
    max_event_batch: int = 50

    # 대화/에이전트 제한
    messenger_max_per_attempt: int = 300
    run_max_concurrent_per_attempt: int = 2
    messenger_history_limit: int = 60
    agent_history_limit: int = 30
    agent_max_tool_iterations: int = 10

    # 실행(러너) 제한
    run_timeout_s: int = 30
    run_command_max_len: int = 500

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


def cookie_secure_enabled() -> bool:
    return settings.cookie_secure if settings.cookie_secure is not None else settings.odysseus_env != "development"


def https_only_enabled() -> bool:
    return settings.https_only if settings.https_only is not None else settings.odysseus_env != "development"


KNOWN_PLACEHOLDER_SECRETS = frozenset(
    {
        "",
        "odysseus-dev-secret-change-me",
        "odysseus-internal-change-me",
        "change-me-openssl-rand-hex-32",
    }
)
MIN_SECRET_LEN = 32


def _secret_problem(name: str, value: str) -> str | None:
    if value in KNOWN_PLACEHOLDER_SECRETS:
        return f"{name} 이 비어 있거나 알려진 자리표시자 값입니다"
    if len(value) < MIN_SECRET_LEN:
        return f"{name} 이 너무 짧습니다 ({len(value)}자, 최소 {MIN_SECRET_LEN}자)"
    return None


def check_startup_security() -> None:
    """기동 전에 알려진 자격증명/암호화 실패 구성을 거부한다.

    운영 모드는 인증용 JWT, 내부 서비스 토큰, DB 저장 암호화 키 셋을 모두 요구한다.
    개발 모드는 경고만 하며 DATA_ENCRYPTION_KEY가 없으면 기존처럼 평문 DB를 허용한다.
    """
    problems = [
        p
        for p in (
            _secret_problem("JWT_SECRET", settings.jwt_secret),
            _secret_problem("INTERNAL_TOKEN", settings.internal_token),
            _secret_problem("DATA_ENCRYPTION_KEY", settings.data_encryption_key),
        )
        if p
    ]
    if problems:
        hint = "각각 `openssl rand -hex 32` 로 만들어 .env 에 넣으세요."
        if settings.odysseus_env == "development":
            import sys

            print(f"[security] WARNING (development): {'; '.join(problems)}. {hint}", file=sys.stderr, flush=True)
        else:
            raise RuntimeError(f"{'; '.join(problems)}. {hint}")
    if settings.seed_demo_data and settings.odysseus_env != "development":
        raise RuntimeError(
            "SEED_DEMO_DATA=true 는 ODYSSEUS_ENV=development 에서만 허용됩니다. "
            "운영 환경에서는 SEED_DEMO_DATA 를 끄고 BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_PASSWORD "
            "로 최초 관리자를 만드세요 (비워 두면 무작위 비밀번호가 로그에 한 번 출력됩니다)."
        )
