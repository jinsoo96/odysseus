"""부서 — 건물 안의 방 하나이자, 이 회사가 채용하는 직군 하나.

**이 파일에는 부서 목록이 없다.** 목록은 `departments` 표에 있고 관리자가 고친다.
회사마다 뽑는 직군이 다르기 때문이다 — AI 를 뽑는 회사와 게임 서버를 뽑는 회사가
같은 층을 쓸 수는 없다. 여기 남는 것은 두 가지뿐이다: 처음 한 번 심는 **기본 한 벌**과,
어떤 값이 부서로 성립하는지 판정하는 **형식 규칙**.

평면도도 마찬가지로 데이터에서 나온다. 방의 좌표를 적어 둔 곳은 어디에도 없고,
부서를 하나 더 만들면 방이 하나 더 생긴다.

시나리오는 부서를 `slug` 로 가리킨다(`Scenario.department`). 외래키를 걸지 않은 것은
의도적이다: 부서를 지웠다고 시나리오가 사라지면 안 되고, 갈 곳을 잃은 시나리오는
화면에서 **로비**로 모여 다시 배치되기를 기다린다.
"""

from __future__ import annotations

import re

from .desktop import APP_PRESETS

#: 부서 키의 형식. 주소와 CSS 선택자에 그대로 들어가므로 소문자 영문으로 시작한다.
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")

#: 문패·문턱·불 켜진 화면에 쓰는 색. 바닥을 이 색으로 칠하지는 않는다.
ACCENT_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

#: 한 층에 놓을 수 있는 방의 수. 위아래 두 줄로 나뉘므로 짝수에 가까울수록 보기 좋다.
#: 상한은 미학이 아니라 가독성이다 — 열여섯 칸을 넘으면 한 화면에서 방 이름이 읽히지 않는다.
MAX_DEPARTMENTS = 16

DEFAULT_ACCENT = "#62A8C8"


def normalize_slug(value: str | None) -> str:
    """부서 키로 쓸 수 있는 값인지 본다. 아니면 빈 문자열 — 곧 '로비'다.

    **존재 여부는 보지 않는다.** 어떤 부서가 있는지는 DB 가 알고, 이 함수는 형식만
    본다. 코드가 부서 목록을 알던 시절의 습관을 여기 남기면, 관리자가 만든 부서를
    코드가 모른다는 이유로 버리게 된다.
    """
    slug = (value or "").strip().lower()
    return slug if SLUG_RE.match(slug) else ""


def normalize_slugs(values: list[str] | tuple[str, ...] | None) -> list[str]:
    """중복과 빈 값을 없애되 **넘긴 순서를 지킨다.**

    순서를 여기서 정하지 않는 이유는, 시험이 부서를 지나는 순서에 의미가 있기
    때문이다. 시험은 시나리오를 순서대로 풀게 되어 있으므로 첫 부서가 곧 **그 일이
    시작되는 자리**다. 표시 순서로 다시 정렬해 버리면 그 사실이 사라진다.
    """
    if not values:
        return []
    seen: list[str] = []
    for value in values:
        slug = normalize_slug(value)
        if slug and slug not in seen:
            seen.append(slug)
    return seen


def normalize_accent(value: str | None) -> str:
    color = (value or "").strip()
    return color if ACCENT_RE.match(color) else DEFAULT_ACCENT


def normalize_app_preset(value: str | None) -> str:
    preset = (value or "").strip().lower()
    return preset if preset in APP_PRESETS else "office"


#: 처음 한 번 심는 기본 한 벌.
#:
#: 이 제품은 코딩 테스트의 심화판이고, 응시자는 **지원한 직군의 자리에 출근한다.**
#: 그래서 방은 일반적인 회사 조직도가 아니라 요즘 테크 회사가 실제로 공고를 내는
#: 직군이어야 한다. 아래는 기본 제공 시나리오 스물다섯 개가 실제로 무엇을 측정하는지에서
#: 거꾸로 세운 한 벌이며, **지우고 바꾸라고 넣어 둔 것이다.**
#:
#: `ordinal` 이 평면도 배치 순서다. 위 줄 왼쪽부터 채워지고 절반이 넘어가면 아래 줄로
#: 내려가므로, 서로 자주 오가는 팀을 이웃에 두었다.
DEFAULT_DEPARTMENTS: list[dict] = [
    {
        "slug": "ai",
        "label": "AI 플랫폼팀",
        "summary": "GPU 위에 추론 스택을 올리고, 죽는 이유를 찾아 고칩니다. 지연과 비용도 여기서 셉니다.",
        "accent": "#62A8C8",
        "app_preset": "engineering",
    },
    {
        "slug": "data",
        "label": "데이터 엔지니어링팀",
        "summary": "배치가 조용히 틀린 숫자를 냅니다. 코드를 읽어 파이프라인의 계약을 되찾는 자리.",
        "accent": "#6FBDB4",
        "app_preset": "engineering",
    },
    {
        "slug": "analytics",
        "label": "데이터 분석팀",
        "summary": "무엇을 세고 무엇을 빼는지부터 관계자에게 확인합니다. 답은 계산이 아니라 정의에서 갈립니다.",
        "accent": "#8496D6",
        "app_preset": "analysis",
    },
    {
        "slug": "product",
        "label": "프로덕트팀",
        "summary": "무엇을 먼저 하고 무엇을 미룰지 정합니다. 정해진 것은 담당자와 날짜가 붙은 기록으로 남습니다.",
        "accent": "#9B8FD1",
        "app_preset": "office",
    },
    {
        "slug": "cx",
        "label": "고객경험팀",
        "summary": "고객에게 나가는 말과, 그 말을 뒷받침하는 판정. 확인된 사실만으로, 규정 안에서.",
        "accent": "#C58FC9",
        "app_preset": "communication",
    },
    {
        "slug": "ops",
        "label": "비즈니스 운영팀",
        "summary": "처리 능력과 규칙 안에서 사람과 물량을 배정합니다. 규칙을 하나만 빠뜨려도 실행되지 않는 답이 나옵니다.",
        "accent": "#6DBBA0",
        "app_preset": "coordination",
    },
    {
        "slug": "people",
        "label": "피플팀",
        "summary": "사람이 일할 조건을 만듭니다. 규정과 권한의 선을 넘지 않는 자리.",
        "accent": "#D28FA0",
        "app_preset": "coordination",
    },
    {
        "slug": "finance",
        "label": "재무·구매팀",
        "summary": "돈이 나가는 결정을 총비용과 규정으로 검증합니다. 계산상 최저가가 답이 아닌 이유까지 문서에 남깁니다.",
        "accent": "#C9A96A",
        "app_preset": "analysis",
    },
]
