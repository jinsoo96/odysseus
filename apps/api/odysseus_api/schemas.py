import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

from .departments import normalize_department
from .desktop import normalize_desktop_apps

#: 관리자가 직접 부여할 수 있는 역할. guest 는 여기 없다 — 게스트 계정은
#: 게스트 로그인만이 만든다. 사람을 게스트로 "강등"하는 조작은 의미가 없고,
#: 반대 방향(게스트 → candidate 승격)은 UserUpdate 로 가능하다.
Role = Literal["admin", "evaluator", "candidate"]


class GuestStartIn(BaseModel):
    #: 화면에 보일 이름. 비우면 서버가 붙인다.
    name: str = Field(default="", max_length=40)


class GuestPolicyOut(BaseModel):
    enabled: bool
    max_new_per_hour_per_ip: int
    chat_per_min: int
    chat_total_per_attempt: int


class GuestPolicyIn(BaseModel):
    enabled: bool
    max_new_per_hour_per_ip: int = Field(ge=0, le=1000)
    chat_per_min: int = Field(ge=1, le=120)
    chat_total_per_attempt: int = Field(ge=0, le=100000)


class BlockedIpIn(BaseModel):
    #: 단일 주소("203.0.113.7") 또는 대역("203.0.113.0/24")
    cidr: str = Field(min_length=3, max_length=64)
    reason: str = Field(default="", max_length=200)


class BlockedIpOut(BaseModel):
    id: uuid.UUID
    cidr: str
    reason: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── auth / users ─────────────────────────────────────────────


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    name: str
    role: str
    is_active: bool
    #: 게스트 계정이 어느 주소에서 만들어졌는지 (일반 계정은 비어 있다)
    created_ip: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=6)
    role: Role = "candidate"


class BulkUserRow(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=100)
    role: Role = "candidate"
    password: str | None = Field(default=None, min_length=6, max_length=100)


class BulkUsersIn(BaseModel):
    users: list[BulkUserRow] = Field(min_length=1, max_length=500)
    default_password: str | None = Field(default=None, min_length=6, max_length=100)


class UserUpdate(BaseModel):
    name: str | None = None
    password: str | None = Field(default=None, min_length=6)
    role: Role | None = None
    is_active: bool | None = None


# ── scenarios ────────────────────────────────────────────────


class CharacterIn(BaseModel):
    key: str = Field(min_length=1, max_length=50, pattern=r"^[a-z0-9_\-]+$")
    name: str = Field(min_length=1, max_length=60)
    role: str = Field(default="", max_length=100)  # 직함 (예: 백엔드 팀 리드)
    color: str = Field(default="#6366f1", max_length=20)  # 아바타 색
    persona: str = Field(default="", max_length=8000)  # 성격/말투/입장
    knowledge: str = Field(default="", max_length=16000)  # 이 인물이 아는 사실


class OpeningMessageIn(BaseModel):
    character_key: str = Field(min_length=1, max_length=50)
    content: str = Field(min_length=1, max_length=4000)


class InitialFileIn(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(default="", max_length=400_000)


#: 자동 체크 종류.
#:
#: 코딩 과제는 "실행해서 통과하는가"로 채점되지만, 사무·문서 과제는 실행할 것이
#: 없다. 그래서 실행 없이도 결과물을 객관적으로 검증할 수 있는 종류를 함께 둔다 —
#: 금칙어(file_not_contains), 분량 하한·상한(file_min_words / file_max_words),
#: 표의 특정 값(csv_cell), 행 수(csv_row_count), 열 합계(csv_column_sum),
#: 값 중복 없음(csv_column_unique).
CheckType = Literal[
    "file_exists",
    "file_contains",
    "file_not_contains",
    "file_min_words",
    "file_max_words",
    "csv_cell",
    "csv_row_count",
    "csv_column_sum",
    "csv_column_unique",
    "command",
]


class CheckIn(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    type: CheckType
    path: str | None = Field(default=None, max_length=500)  # file_* / csv_* 용
    pattern: str | None = Field(default=None, max_length=2000)  # file_contains / file_not_contains 정규식
    command: str | None = Field(default=None, max_length=500)  # command 용
    expected_stdout: str | None = Field(default=None, max_length=8000)  # command 출력 포함 문자열
    # ── 표(csv_*) 용 ──
    #: 값을 읽을 열 이름 (헤더 기준). csv_cell / csv_column_sum / csv_column_unique
    column: str | None = Field(default=None, max_length=200)
    #: 행을 고르는 조건 "열이름=값". csv_cell 은 첫 일치 행, 나머지는 일치하는 행 전체.
    row_match: str | None = Field(default=None, max_length=400)
    #: 기대값. csv_cell(칸 값) / csv_row_count(행 수) / csv_column_sum(합계).
    #: 숫자면 수치로, 아니면 공백을 무시한 문자열로 비교한다.
    expected: str | None = Field(default=None, max_length=500)
    #: 숫자 비교 허용 오차 (기본 0 — 정확히 일치)
    tolerance: float | None = Field(default=None, ge=0)
    # ── 분량 용 ──
    #: 최소 단어 수 (file_min_words)
    min_count: int | None = Field(default=None, ge=1, le=100000)
    #: 최대 단어 수 (file_max_words) — 짧게 쓰는 것이 요구사항인 산출물용
    max_count: int | None = Field(default=None, ge=1, le=100000)
    points: int = Field(default=10, ge=0, le=100)


class ScenarioIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: str = Field(default="", max_length=2000)
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    briefing_md: str = Field(default="", max_length=40000)
    characters: list[CharacterIn] = Field(default_factory=list, max_length=8)
    opening_messages: list[OpeningMessageIn] = Field(default_factory=list, max_length=10)
    initial_files: list[InitialFileIn] = Field(default_factory=list, max_length=60)
    objectives_md: str = Field(default="", max_length=32000)
    # NPC 기본 규칙 덮어쓰기 — 비어 있으면 전역 기본(npc_prompt.BASE_RULES)
    npc_base_prompt: str = Field(default="", max_length=20000)
    checks: list[CheckIn] = Field(default_factory=list, max_length=30)
    rubric: dict = Field(default_factory=dict)
    agent_enabled: bool = True
    #: 이 시나리오에서 제공할 데스크톱 앱. 비어 있으면 전부 제공(기존 동작).
    desktop_apps: list[str] = Field(default_factory=list, max_length=20)

    #: 이 업무가 벌어지는 부서. 빈 문자열은 로비(미배치)를 뜻한다.
    #:
    #: **없음(None)과 빈 문자열은 다르다.** 필드를 아예 보내지 않은 요청은 "부서를
    #: 건드리지 말라"는 뜻이고, 빈 문자열을 보낸 요청은 "로비로 내려라"는 뜻이다.
    #: 둘을 같게 두면 이 필드를 모르는 클라이언트가 저장할 때마다 부서가 조용히
    #: 지워진다 — 전체 교체(PUT)라 다른 필드처럼 넘어가 주지 않는다.
    department: str | None = Field(default=None, max_length=40)

    @field_validator("desktop_apps")
    @classmethod
    def _clean_desktop_apps(cls, value: list[str]) -> list[str]:
        return normalize_desktop_apps(value)

    @field_validator("department")
    @classmethod
    def _clean_department(cls, value: str | None) -> str | None:
        return None if value is None else normalize_department(value)


class ScenarioSummary(BaseModel):
    id: uuid.UUID
    title: str
    summary: str
    difficulty: str
    character_count: int
    check_count: int
    agent_enabled: bool
    department: str = ""
    is_archived: bool
    updated_at: datetime


class ScenarioOut(BaseModel):
    id: uuid.UUID
    title: str
    summary: str
    difficulty: str
    briefing_md: str
    characters: list
    opening_messages: list
    initial_files: list
    objectives_md: str
    npc_base_prompt: str = ""
    checks: list
    rubric: dict
    agent_enabled: bool
    desktop_apps: list = []
    department: str = ""
    is_archived: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── assessments ──────────────────────────────────────────────


class AssessmentScenarioIn(BaseModel):
    scenario_id: uuid.UUID
    points: int = Field(default=100, ge=0, le=1000)


class AssessmentIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    duration_min: int = Field(default=120, ge=5, le=600)
    agent_max_turns: int = Field(default=30, ge=0, le=500)
    npc_provider_id: uuid.UUID | None = None
    agent_provider_id: uuid.UUID | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    scenarios: list[AssessmentScenarioIn] = Field(min_length=1, max_length=10)
    assignee_ids: list[uuid.UUID] = Field(default_factory=list)


class AssessmentScenarioOut(BaseModel):
    scenario_id: uuid.UUID
    title: str
    difficulty: str
    ordinal: int
    points: int


class AssignmentOut(BaseModel):
    user_id: uuid.UUID
    name: str
    email: str


class AssessmentOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str
    duration_min: int
    agent_max_turns: int
    npc_provider_id: uuid.UUID | None
    agent_provider_id: uuid.UUID | None
    starts_at: datetime | None
    ends_at: datetime | None
    created_at: datetime
    scenarios: list[AssessmentScenarioOut]
    assignments: list[AssignmentOut]


class AssessmentSummary(BaseModel):
    id: uuid.UUID
    title: str
    duration_min: int
    scenario_count: int
    assignee_count: int
    attempt_count: int
    created_at: datetime


# ── attempts / exam desktop ──────────────────────────────────


class MyAssignmentOut(BaseModel):
    assessment_id: uuid.UUID
    title: str
    description: str
    duration_min: int
    scenario_count: int
    starts_at: datetime | None
    ends_at: datetime | None
    attempt_id: uuid.UUID | None = None
    attempt_status: str | None = None
    assigned: bool = True
    #: 이 시험이 지나는 부서 — 시나리오에서 문제 순서대로 유도한다(저장하지 않는다).
    #: 따라서 첫 항목이 **이 일이 시작되는 자리**다. 비어 있으면 로비다.
    departments: list[str] = []


class AttemptScenarioOut(BaseModel):
    scenario_id: uuid.UUID
    title: str
    briefing_md: str
    ordinal: int
    points: int
    agent_enabled: bool
    #: 이 문제에서 열 수 있는 앱 — 비어 있으면 전부 (desktop.OPTIONAL_APPS)
    desktop_apps: list[str] = []
    characters: list  # [{key, name, role, color}] — persona/knowledge는 제외
    # 순차 진행 상태: completed(제출 완료) | in_progress(현재) | locked(아직 잠김)
    status: str = "in_progress"
    unread: int = 0


class AttemptOut(BaseModel):
    id: uuid.UUID
    assessment_id: uuid.UUID
    assessment_title: str
    status: str
    started_at: datetime
    deadline_at: datetime
    submitted_at: datetime | None
    agent_max_turns: int
    current_ordinal: int = 0
    # 시네마틱 인트로(게이미피케이션) 사용 여부 — 플랫폼 전역 설정
    gamified_intro: bool = False
    scenarios: list[AttemptScenarioOut]


class EventIn(BaseModel):
    type: str = Field(min_length=1, max_length=50)
    scenario_id: uuid.UUID | None = None
    payload: dict = Field(default_factory=dict)


class EventBatchIn(BaseModel):
    events: list[EventIn] = Field(min_length=1, max_length=50)


# ── messenger ────────────────────────────────────────────────


class MessengerSendIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class MessengerMessageOut(BaseModel):
    id: uuid.UUID
    character_key: str
    sender: str
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── agent ────────────────────────────────────────────────────


class AgentSendIn(BaseModel):
    content: str = Field(min_length=1, max_length=16000)


class AgentMessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str
    model: str | None
    meta: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class AgentUsageOut(BaseModel):
    enabled: bool
    used: int
    max: int
    remaining: int
    configured: bool
    model: str | None = None
    # 이 공급자가 워크스페이스 조작 도구를 받을 수 있는가 (Claude Code CLI 등은 대화 전용)
    tools_available: bool = True
    provider_name: str | None = None


# ── workspace ────────────────────────────────────────────────


class FileEntryOut(BaseModel):
    path: str
    size: int
    updated_at: datetime


class FileContentOut(BaseModel):
    path: str
    content: str
    updated_at: datetime


class FileSaveIn(BaseModel):
    path: str = Field(min_length=1, max_length=500)
    content: str = Field(default="", max_length=400_000)


class FileRenameIn(BaseModel):
    from_path: str = Field(min_length=1, max_length=500)
    to_path: str = Field(min_length=1, max_length=500)


# ── executions ───────────────────────────────────────────────


class RunIn(BaseModel):
    command: str = Field(min_length=1, max_length=500)


class ExecutionOut(BaseModel):
    id: uuid.UUID
    scenario_id: uuid.UUID
    source: str
    command: str
    status: str
    exit_code: int | None
    stdout: str | None
    stderr: str | None
    time_ms: int | None
    changed_files: list | None
    created_at: datetime
    finished_at: datetime | None

    model_config = {"from_attributes": True}


class InternalAgentToolIn(BaseModel):
    """MCP 브리지 → API 도구 실행 (Claude Code CLI 경로)."""

    attempt_id: uuid.UUID
    scenario_id: uuid.UUID
    name: str = Field(min_length=1, max_length=60)
    input: dict = Field(default_factory=dict)


class InternalRunResultIn(BaseModel):
    status: Literal["done", "error"]
    exit_code: int | None = None
    stdout: str = ""
    stderr: str = ""
    time_ms: int | None = None
    # [{path, content}] — 실행으로 생성/변경된 파일. deleted=true면 삭제.
    changed_files: list[dict] = Field(default_factory=list)


# ── review / evaluation ──────────────────────────────────────


class HumanEvalIn(BaseModel):
    scores: dict = Field(default_factory=dict)
    summary: str = Field(default="", max_length=8000)


class AutoEvalIn(BaseModel):
    provider_id: uuid.UUID | None = None


# ── ai providers (admin settings) ────────────────────────────


class AiProviderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    provider: str = Field(max_length=30)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = None  # None=기존 유지, ""=삭제
    model: str = Field(min_length=1, max_length=200)
    temperature: float = Field(default=0.2, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=256, le=128000)
    enabled: bool = True


class AiProviderOut(BaseModel):
    id: uuid.UUID
    name: str
    provider: str
    base_url: str | None
    model: str
    temperature: float
    max_tokens: int
    enabled: bool
    is_chat_default: bool
    is_eval_default: bool
    has_key: bool = False
    key_hint: str | None = None
    supports_host_tools: bool = True
    created_at: datetime


class AiDefaultsIn(BaseModel):
    chat_provider_id: uuid.UUID | None = None
    eval_provider_id: uuid.UUID | None = None


class AiTestIn(BaseModel):
    provider_id: uuid.UUID | None = None
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
