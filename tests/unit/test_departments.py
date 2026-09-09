"""부서 시드와 형식 규칙 검증 — 서버도 도커도 없이.

부서 목록은 이제 코드가 아니라 데이터다. 그래서 여기서 증명할 것이 달라졌다. 예전에는
"어휘가 서로 맞물리는가"를 봤지만, 이제는 **처음 한 번 심는 기본 한 벌이 성립하는가**와
**어떤 값이 부서 키로 통과하는가**를 본다.

가장 흔한 실수는 시나리오를 새로 추가하면서 부서를 빠뜨리거나, 기본 부서에 없는 키를
적는 것이다. 그러면 그 시나리오는 화면에서 조용히 로비로 밀려난다 — 사라지지는 않지만
아무도 눈치채지 못한다. 그것을 여기서 잡는다.
"""

import pathlib
import re
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))

from odysseus_api.departments import (  # noqa: E402
    ACCENT_RE,
    DEFAULT_DEPARTMENTS,
    MAX_DEPARTMENTS,
    SLUG_RE,
    normalize_accent,
    normalize_app_preset,
    normalize_slug,
    normalize_slugs,
)
from odysseus_api.desktop import APP_PRESETS  # noqa: E402
from odysseus_api.scenarios import DEFAULT_SCENARIOS  # noqa: E402
from odysseus_api.schemas import ScenarioIn  # noqa: E402


class SlugRuleTests(unittest.TestCase):
    def test_shape_only_no_membership(self):
        """존재 여부를 보지 않는다 — 관리자가 만든 부서를 코드가 모른다고 버리면 안 된다."""
        self.assertEqual(normalize_slug("backend"), "backend")
        self.assertEqual(normalize_slug("  BACKEND "), "backend")
        self.assertEqual(normalize_slug("data-eng"), "data-eng")
        self.assertEqual(normalize_slug("ml2"), "ml2")

    def test_rejects_shapes_that_break_urls_or_selectors(self):
        for bad in ["", "  ", "마케팅", "2fast", "-lead", "has space", "UPPER!", "a" * 41]:
            with self.subTest(value=bad):
                self.assertEqual(normalize_slug(bad), "")
        self.assertEqual(normalize_slug(None), "")

    def test_list_dedupes_but_keeps_the_caller_order(self):
        """첫 부서가 '그 일이 시작되는 자리'라서 순서를 다시 정렬하면 안 된다."""
        self.assertEqual(normalize_slugs(["cs", "ai", "cs", "!nope", ""]), ["cs", "ai"])
        self.assertEqual(normalize_slugs(["ai", "cs"]), ["ai", "cs"])
        self.assertEqual(normalize_slugs([]), [])
        self.assertEqual(normalize_slugs(None), [])

    def test_accent_falls_back_instead_of_failing(self):
        self.assertEqual(normalize_accent("#62A8C8"), "#62A8C8")
        for bad in ["", "red", "#fff", "#12345g", None]:
            with self.subTest(value=bad):
                self.assertTrue(ACCENT_RE.match(normalize_accent(bad)))

    def test_unknown_app_preset_falls_back(self):
        self.assertEqual(normalize_app_preset("engineering"), "engineering")
        self.assertEqual(normalize_app_preset("없는프리셋"), "office")
        self.assertEqual(normalize_app_preset(None), "office")


class DefaultSeedTests(unittest.TestCase):
    """기본 한 벌은 지우라고 넣어 둔 것이지만, 심는 순간에는 성립해야 한다."""

    def test_seed_is_not_empty_and_fits_one_floor(self):
        self.assertTrue(DEFAULT_DEPARTMENTS)
        self.assertLessEqual(len(DEFAULT_DEPARTMENTS), MAX_DEPARTMENTS)

    def test_every_field_is_present_and_well_formed(self):
        for spec in DEFAULT_DEPARTMENTS:
            with self.subTest(slug=spec.get("slug")):
                self.assertTrue(SLUG_RE.match(spec["slug"]))
                self.assertTrue(spec["label"].strip())
                self.assertTrue(spec["summary"].strip(), "방 설명이 없으면 하단 바가 빈다")
                self.assertTrue(ACCENT_RE.match(spec["accent"]))
                self.assertIn(spec["app_preset"], APP_PRESETS)

    def test_slugs_are_unique(self):
        slugs = [s["slug"] for s in DEFAULT_DEPARTMENTS]
        self.assertEqual(len(slugs), len(set(slugs)))

    def test_summaries_do_not_promise_tools_the_room_may_not_have(self):
        """방 설명이 도구를 약속하면 그 방 시나리오가 실제로 그 도구를 열어야 한다.

        예전 설명에 "터미널과 IDE 가 있는 유일한 방"이 있었는데, 직군이 쪼개지면서
        터미널이 열리는 방이 여럿이 되어 그 문장이 거짓이 됐다. 도구 이름을 설명에
        적는 순간 이런 종류의 거짓말이 생기므로, 아예 적지 않는 쪽을 고정한다.
        """
        for spec in DEFAULT_DEPARTMENTS:
            with self.subTest(slug=spec["slug"]):
                for word in ("터미널", "IDE", "GitHub"):
                    self.assertNotIn(word, spec["summary"])


class ScenarioPlacementTests(unittest.TestCase):
    def test_every_preset_scenario_lands_in_a_seeded_room(self):
        known = {s["slug"] for s in DEFAULT_DEPARTMENTS}
        for spec in DEFAULT_SCENARIOS:
            with self.subTest(scenario=spec["title"]):
                self.assertIn(
                    spec.get("department"),
                    known,
                    "시나리오를 추가할 때 부서를 빠뜨리면 화면에서 조용히 로비로 밀려난다",
                )

    def test_no_seeded_room_is_empty(self):
        placed = {spec.get("department") for spec in DEFAULT_SCENARIOS}
        for spec in DEFAULT_DEPARTMENTS:
            with self.subTest(slug=spec["slug"]):
                self.assertIn(
                    spec["slug"], placed, "기본으로 심는 방에는 최소 하나가 있어야 한다"
                )

    def test_department_survives_schema_validation(self):
        for spec in DEFAULT_SCENARIOS:
            with self.subTest(scenario=spec["title"]):
                self.assertEqual(ScenarioIn.model_validate(spec).department, spec["department"])

    def test_omitted_department_is_none_not_empty(self):
        """부서를 보내지 않은 저장은 부서를 **건드리지 않는다**는 신호여야 한다.

        빈 문자열로 채워 버리면 이 필드를 모르는 클라이언트가 시나리오를 한 번
        저장할 때마다 방에 있던 시나리오가 로비로 내려간다. 저장은 전체 교체다.
        """
        self.assertIsNone(ScenarioIn.model_validate({"title": "부서 없는 시나리오"}).department)

    def test_explicit_empty_department_means_the_lobby(self):
        """반대로 빈 문자열을 **명시해서** 보낸 것은 '로비로 내려라'는 뜻이다."""
        self.assertEqual(ScenarioIn.model_validate({"title": "x", "department": ""}).department, "")

    def test_malformed_department_is_dropped_not_rejected(self):
        """형식이 틀린 값으로 저장이 막히면 스튜디오가 한 번의 오타로 잠긴다."""
        parsed = ScenarioIn.model_validate({"title": "x", "department": "마케팅팀"})
        self.assertEqual(parsed.department, "")


class FrontendMirrorTests(unittest.TestCase):
    """프론트가 부서를 하드코딩으로 되돌리지 않았는지 본다.

    이 검사가 있는 이유는 실제로 그렇게 시작했기 때문이다. 슬러그를 유니온 타입으로
    적어 두면 관리자가 만든 부서를 코드가 모른다는 이유로 화면에서 지워 버린다.
    """

    def test_no_hardcoded_department_vocabulary_in_web(self):
        web = REPO_ROOT / "apps" / "web"
        offenders = []
        for path in list(web.glob("lib/*.ts")) + list(web.glob("components/office/*.ts*")):
            text = path.read_text(encoding="utf-8")
            if re.search(r"\bDEPARTMENT_LABEL\b|\bDepartmentId\b", text):
                offenders.append(str(path.relative_to(REPO_ROOT)))
        self.assertEqual(offenders, [], "부서 어휘가 다시 코드로 들어왔다")


if __name__ == "__main__":
    unittest.main()
