"""기본 제공 시나리오 모음.

각 모듈은 `SCENARIO: dict` 하나를 노출한다 (ScenarioIn 스키마와 동일한 모양).
seed 와 `tests/smoke/seed_scenarios.py` 가 이 목록을 단일 소스로 사용한다.

세 갈래가 있다.

* `s01`–`s06` — 엔지니어링 트랙. 터미널·IDE 로 코드와 인프라를 다룬다.
* `b01`–`b13` — 사무 업무 트랙. 보고서·회의록·검토서·정산·요약처럼 **문서와 표가
  산출물**이고, 데스크톱도 그에 맞게(문서 편집기·표 편집기 중심으로) 구성된다.
* `g01`–`g06` — 일반 문제 해결 트랙. 특정 직무 지식이 없어도 풀 수 있는 문제들이다.
  장소 고르기, 당직표 짜기, 좌석 배치, 환불 판정, 갈등 조율처럼 **조건을 모으면 답이
  하나로 정해지는** 과제로, 조건의 절반이 파일이 아니라 관계자에게 있다.

뒤의 두 갈래(`OFFICE_SCENARIOS`)는 실행할 코드가 없으므로 채점이 전부 파일 기반
체크(`file_min_words`, `file_max_words`, `file_not_contains`, `csv_cell`, `csv_row_count`,
`csv_column_sum`, `csv_column_unique`)로 이루어진다. 덕분에 러너 없이도 "참조 해답이
실제로 통과하는가"를 CI 에서 매번 검증할 수 있다.
"""

from . import (
    b01_quarter_report,
    b02_meeting_minutes,
    b03_vendor_review,
    b04_customer_complaint,
    b05_dispatch_plan,
    b06_budget_review,
    b07_team_conflict,
    b08_priority_conflict,
    b09_incident_notice,
    b10_interview_schedule,
    b11_expense_audit,
    b12_survey_onepager,
    b13_onboarding_schedule,
    g01_workshop_venue,
    g02_duty_roster,
    g03_copier_decision,
    g04_remote_work_conflict,
    g05_seat_layout,
    g06_refund_rules,
    s01_weekly_report,
    s02_vllm_compose,
    s03_k8s_inference,
    s04_kvm_gpu_node,
    s05_gateway_analysis,
    s06_batch_race,
)

#: 엔지니어링 트랙 (코드·인프라)
ENGINEERING_SCENARIOS: list[dict] = [
    s01_weekly_report.SCENARIO,
    s02_vllm_compose.SCENARIO,
    s03_k8s_inference.SCENARIO,
    s04_kvm_gpu_node.SCENARIO,
    s05_gateway_analysis.SCENARIO,
    s06_batch_race.SCENARIO,
]

#: 사무 업무 트랙 (문서·표·커뮤니케이션·정산·요약)
BUSINESS_SCENARIOS: list[dict] = [
    b01_quarter_report.SCENARIO,
    b02_meeting_minutes.SCENARIO,
    b03_vendor_review.SCENARIO,
    b04_customer_complaint.SCENARIO,
    b05_dispatch_plan.SCENARIO,
    b06_budget_review.SCENARIO,
    b07_team_conflict.SCENARIO,
    b08_priority_conflict.SCENARIO,
    b09_incident_notice.SCENARIO,
    b10_interview_schedule.SCENARIO,
    b11_expense_audit.SCENARIO,
    b12_survey_onepager.SCENARIO,
    b13_onboarding_schedule.SCENARIO,
]

#: 일반 문제 해결 트랙 (계산·배정·판단 — 업무 지식보다 조건 수집이 핵심)
GENERAL_SCENARIOS: list[dict] = [
    g01_workshop_venue.SCENARIO,
    g02_duty_roster.SCENARIO,
    g03_copier_decision.SCENARIO,
    g04_remote_work_conflict.SCENARIO,
    g05_seat_layout.SCENARIO,
    g06_refund_rules.SCENARIO,
]

#: 터미널 없이 문서·표로만 푸는 트랙 전체 (사무 + 일반) — 채점이 파일 기반인 시나리오들
OFFICE_SCENARIOS: list[dict] = BUSINESS_SCENARIOS + GENERAL_SCENARIOS

DEFAULT_SCENARIOS: list[dict] = ENGINEERING_SCENARIOS + OFFICE_SCENARIOS

#: 기본 제공 시험 구성 — (제목, 설명, 분, 에이전트 한도, 시나리오 제목 목록)
DEFAULT_ASSESSMENTS: list[dict] = [
    {
        "title": "실무 시뮬레이션 데모 — 매출 리포트",
        "description": "메신저로 관계자와 대화하며 요구사항을 파악하고, 워크스페이스에서 문제를 해결하세요.",
        "duration_min": 90,
        "agent_max_turns": 30,
        "assign_demo_candidate": True,
        "scenarios": ["주간 매출 리포트 이상"],
    },
    {
        "title": "인프라 심화 — LLM 추론 스택",
        "description": (
            "LLM 추론 인프라 장애 3종(컨테이너·쿠버네티스·가상화)을 실제 로그와 설정으로 진단하고 고칩니다. "
            "관계자에게 물어 요구사항을 스스로 확정해야 합니다."
        ),
        "duration_min": 240,
        "agent_max_turns": 60,
        "assign_demo_candidate": False,
        "scenarios": [
            "LLM 추론 서비스가 GPU 노드에서 계속 죽는다",
            "쿠버네티스 추론 파드가 스케줄되지 않는다",
            "GPU 패스스루 추론 VM이 느리고 가끔 부팅에 실패한다",
        ],
    },
    {
        "title": "심화 문제 해결 — 분석과 동시성",
        "description": "운영 로그 분석으로 SLO·비용 문제를 규명하고, 비결정적으로 재현되는 동시성 버그를 잡습니다.",
        "duration_min": 180,
        "agent_max_turns": 50,
        "assign_demo_candidate": False,
        "scenarios": [
            "추론 게이트웨이가 SLO를 못 맞추고 비용도 넘겼다",
            "야간 임베딩 배치가 결과를 흘린다",
        ],
    },
    # ── 사무·일반 업무 트랙 ────────────────────────────────────
    {
        "title": "사무 실무 입문 — 회의록 정리",
        "description": (
            "받아 적은 속기록 하나를 회의록과 액션 아이템 표로 정리합니다. 결정된 것과 보류된 것을 가려내고, "
            "'다음 주 수요일' 같은 말을 날짜로 확정해야 합니다. 코딩 지식은 필요하지 않습니다."
        ),
        "duration_min": 60,
        "agent_max_turns": 25,
        "assign_demo_candidate": True,
        "scenarios": ["주간 회의록 정리와 액션 아이템"],
    },
    {
        "title": "사무 실무 종합 — 보고서와 데이터",
        "description": (
            "집계 규칙을 관계자에게 확인해 실적표를 만들고 임원 보고서로 정리한 뒤, 예산 초과의 원인을 분석해 "
            "절감안까지 제안합니다. 숫자 정확도와 문서 완성도를 함께 봅니다."
        ),
        "duration_min": 210,
        "agent_max_turns": 45,
        "assign_demo_candidate": False,
        "scenarios": ["3분기 지사 실적 보고서", "상반기 예산 초과 원인 분석"],
    },
    {
        "title": "커뮤니케이션 — 클레임·공지·갈등",
        "description": (
            "화가 난 고객, 밖으로 나갈 장애 공지, 말을 섞지 않는 두 동료. 규정과 권한 안에서 쓸 수 있는 문장을 "
            "찾아내는 능력을 봅니다."
        ),
        "duration_min": 240,
        "agent_max_turns": 50,
        "assign_demo_candidate": False,
        "scenarios": [
            "성난 고객의 항의 메일 대응",
            "결제 장애 공지문과 상담 FAQ",
            "말을 섞지 않는 두 사람 — 팀 갈등 중재",
        ],
    },
    {
        "title": "문제 해결·조율 — 제약 속에서 계획 세우기",
        "description": (
            "처리 능력, 입고 일정, 가용 공수, 면접 규칙처럼 서로 물린 제약 안에서 실행 가능한 계획을 만들고 "
            "밀려나는 쪽을 설득합니다."
        ),
        "duration_min": 240,
        "agent_max_turns": 50,
        "assign_demo_candidate": False,
        "scenarios": [
            "밀린 주문 출고 계획과 지연 안내",
            "2차 면접 일정 조율",
            "개발자 한 명, 부서 셋 — 스프린트 우선순위 조정",
        ],
    },
    # ── 일반 문제 해결 트랙 ────────────────────────────────────
    {
        "title": "일반 문제 해결 입문 — 기준부터 찾기",
        "description": (
            "표와 견적서는 이미 있습니다. 없는 것은 '무엇을 기준으로 고를 것인가'입니다. "
            "장소 하나를 고르고 복합기 하나를 결정하는 동안, 계산보다 먼저 조건을 모으는 사람인지를 봅니다. "
            "업무 지식도 코딩도 필요하지 않습니다."
        ),
        "duration_min": 120,
        "agent_max_turns": 30,
        "assign_demo_candidate": True,
        "scenarios": ["하반기 워크숍 장소 선정", "복합기 수리 vs 교체 판단"],
    },
    {
        "title": "일반 문제 해결 심화 — 제약 속 배정",
        "description": (
            "당직표, 좌석 배치, 온보딩 일정. 겉으로는 빈칸 채우기지만 규칙을 하나만 빠뜨려도 "
            "그럴듯하면서 실행되지 않는 답이 나옵니다. 제약을 끝까지 모으는 사람인지를 봅니다."
        ),
        "duration_min": 210,
        "agent_max_turns": 50,
        "assign_demo_candidate": False,
        "scenarios": [
            "다음 주 당직 근무표 편성",
            "7층 이전 좌석 재배치",
            "신규 입사자 첫 주 온보딩 일정",
        ],
    },
    {
        "title": "규정 적용 — 판정하고 설명하기",
        "description": (
            "환불 여섯 건과 출장비 여덟 건. 규정 요약본은 낡았고 사실관계는 다른 팀이 쥐고 있습니다. "
            "판정을 내리는 것뿐 아니라 깎이고 거절당한 사람에게 그 이유를 설명하는 문서까지 봅니다."
        ),
        "duration_min": 210,
        "agent_max_turns": 50,
        "assign_demo_candidate": False,
        "scenarios": ["환불 요청 여섯 건 판정", "9월 출장비 정산 검증"],
    },
    {
        "title": "갈등 조율 심화 — 요구 뒤의 이해관계",
        "description": (
            "재택근무를 두고 갈라진 팀, 말을 섞지 않는 두 사람, 개발자 한 명을 두고 다투는 세 부서. "
            "가운데를 자르는 절충이 아니라 규정 안에서 양쪽의 진짜 요구를 찾아내는지를 봅니다."
        ),
        "duration_min": 240,
        "agent_max_turns": 55,
        "assign_demo_candidate": False,
        "scenarios": [
            "재택근무 축소 방침 — 팀 갈등 조율",
            "말을 섞지 않는 두 사람 — 팀 갈등 중재",
            "개발자 한 명, 부서 셋 — 스프린트 우선순위 조정",
        ],
    },
    {
        "title": "요약과 보고 — 한 장으로 말하기",
        "description": (
            "속기록 하나를 회의록으로, 설문 원자료 22건을 임원용 한 장으로 줄입니다. "
            "길게 쓰는 능력이 아니라 무엇을 남기고 무엇을 버릴지 정하는 능력을 봅니다. 분량 상한이 있습니다."
        ),
        "duration_min": 150,
        "agent_max_turns": 35,
        "assign_demo_candidate": False,
        "scenarios": ["주간 회의록 정리와 액션 아이템", "조직문화 설문 — 한 장 보고"],
    },
    {
        "title": "기획·의사결정 — 벤더 선정",
        "description": (
            "총소유비용을 직접 계산하고 필수 요건으로 후보를 걸러, 최저가를 고르지 않은 이유까지 문서로 남깁니다."
        ),
        "duration_min": 120,
        "agent_max_turns": 35,
        "assign_demo_candidate": False,
        "scenarios": ["모니터링 시스템 벤더 선정 검토"],
    },
]
