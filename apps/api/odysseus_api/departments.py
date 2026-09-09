"""시나리오가 놓인 부서 — 건물 안의 어느 섹터에서 이 일이 벌어지는가.

시나리오에는 이미 부서가 들어 있었다. 발명한 것이 아니라 꺼낸 것이다: 오프닝
메시지를 보내는 인물에게는 직함이 있고("인사팀 채용 담당", "물류센터장"),
그 직함이 이 업무가 어느 팀 책상에서 시작되는지를 이미 말하고 있다. 이 모듈은
그 소속을 어휘로 고정해, 응시자가 시험 목록 대신 **사무실 평면도**를 볼 수 있게
한다.

`track`(엔지니어링·사무·일반)과는 **직교한다.** 트랙은 "이 문제를 풀려면 무엇을
알아야 하는가"이고 부서는 "이 일이 어디서 벌어지는가"이다. 총무팀 방에도 직무
지식이 필요 없는 문제가 있고, 개발팀 방에도 문서로 끝나는 문제가 있다. 둘을 한
필드로 합치면 그 구분을 다시는 되돌릴 수 없어 따로 둔다.

빈 문자열은 **로비**를 뜻한다 — 아직 부서가 정해지지 않은 시나리오다. 기본값이
빈 문자열이라, 이 컬럼이 생기기 전에 만들어진 시나리오는 아무것도 잃지 않고
그대로 로비에 놓인다.
"""

from __future__ import annotations

#: 건물 안의 섹터 (표시 순서 = 평면도에서 왼쪽 위부터의 배치 순서)
DEPARTMENTS: tuple[str, ...] = (
    "dev",
    "product",
    "planning",
    "finance",
    "hr",
    "ga",
    "ops",
    "cs",
)

#: 응시자와 관리자에게 보이는 이름. 슬러그는 코드가, 이름은 사람이 읽는다.
DEPARTMENT_LABELS: dict[str, str] = {
    "dev": "개발팀",
    "product": "프로덕트팀",
    "planning": "경영기획팀",
    "finance": "재무팀",
    "hr": "인사팀",
    "ga": "총무팀",
    "ops": "운영지원팀",
    "cs": "고객지원팀",
}

#: 그 방에서 주로 하는 일 — 평면도의 방 설명이자, 새 시나리오를 쓸 때의 길잡이
DEPARTMENT_SUMMARIES: dict[str, str] = {
    "dev": "장애를 재현하고 원인을 찾아 고칩니다. 터미널과 IDE 가 있는 유일한 방입니다.",
    "product": "부서 사이에 낀 요구를 정리해 무엇을 먼저 할지 정합니다.",
    "planning": "숫자를 모아 결정을 만들고, 그 결정을 문서로 남깁니다.",
    "finance": "예산과 정산 — 규정과 금액이 맞는지 끝까지 확인합니다.",
    "hr": "사람 사이의 일. 일정과 갈등, 그리고 규정 안에서 쓸 수 있는 문장.",
    "ga": "공간과 비품 — 조건을 모으면 답이 하나로 정해지는 일들입니다.",
    "ops": "현장의 제약 안에서 실행 가능한 계획을 세웁니다.",
    "cs": "고객에게 나가는 말. 확인된 사실만으로, 규정 안에서.",
}

#: 부서별로 권하는 데스크톱 앱 조합 (`desktop.APP_PRESETS` 의 키).
#:
#: 새 시나리오를 만들 때의 **기본 제안**일 뿐이다. 시나리오가 `desktop_apps` 를
#: 직접 지정했다면 그쪽이 언제나 이긴다 — 이 표가 기존 시나리오의 도구를 바꾸는
#: 일은 없다.
DEPARTMENT_APP_PRESET: dict[str, str] = {
    "dev": "engineering",
    "product": "office",
    "planning": "analysis",
    "finance": "analysis",
    "hr": "coordination",
    "ga": "office",
    "ops": "coordination",
    "cs": "communication",
}


def normalize_department(value: str | None) -> str:
    """알 수 없는 값은 버린다 — 빈 문자열은 '로비'를 뜻한다."""
    slug = (value or "").strip().lower()
    return slug if slug in DEPARTMENTS else ""


def normalize_departments(values: list[str] | tuple[str, ...] | None) -> list[str]:
    """중복과 빈 값을 없애되 **넘긴 순서를 지킨다.**

    순서를 여기서 정하지 않는 이유는, 시험이 부서를 지나는 순서에 의미가 있기
    때문이다. 시험은 시나리오를 순서대로 풀게 되어 있으므로 첫 부서가 곧 **그 일이
    시작되는 자리**다. 표시 순서로 다시 정렬해 버리면 그 사실이 사라진다.
    """
    if not values:
        return []
    seen: list[str] = []
    for value in values:
        slug = normalize_department(value)
        if slug and slug not in seen:
            seen.append(slug)
    return seen


def department_vocabulary() -> list[dict]:
    """관리 화면이 그대로 그릴 수 있는 어휘 — 슬러그를 프론트에 복제하지 않기 위해."""
    return [
        {
            "id": dept,
            "label": DEPARTMENT_LABELS[dept],
            "summary": DEPARTMENT_SUMMARIES[dept],
            "app_preset": DEPARTMENT_APP_PRESET[dept],
        }
        for dept in DEPARTMENTS
    ]
