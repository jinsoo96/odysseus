"""부서 어휘와 시나리오 배치 검증 — 서버도 도커도 없이.

사무실 평면도는 두 가지를 전제로 그려진다. **모든 시나리오가 정확히 한 부서에
있다**는 것과 **모든 방에 최소 한 개의 책상이 있다**는 것이다. 둘 중 하나라도
깨지면 화면에는 잘못된 개수가 뜨거나 빈 방이 생긴다 — 채용 시험에서 잠긴 빈 방은
"이 제품은 미완성"으로 읽힌다.

새 시나리오를 추가하면서 부서를 빠뜨리는 것이 가장 흔한 실수이므로, 그것을 여기서
잡는다.
"""

import pathlib
import sys
import unittest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))

from odysseus_api.departments import (  # noqa: E402
    DEPARTMENT_APP_PRESET,
    DEPARTMENT_LABELS,
    DEPARTMENT_SUMMARIES,
    DEPARTMENTS,
    department_vocabulary,
    normalize_department,
    normalize_departments,
)
from odysseus_api.desktop import APP_PRESETS  # noqa: E402
from odysseus_api.scenarios import DEFAULT_SCENARIOS, ENGINEERING_SCENARIOS  # noqa: E402
from odysseus_api.schemas import ScenarioIn  # noqa: E402


class VocabularyTests(unittest.TestCase):
    def test_every_department_has_a_label_and_summary(self):
        for dept in DEPARTMENTS:
            with self.subTest(department=dept):
                self.assertTrue(DEPARTMENT_LABELS.get(dept))
                self.assertTrue(DEPARTMENT_SUMMARIES.get(dept))

    def test_no_stray_labels(self):
        """표에만 있고 어휘에는 없는 부서는 화면 어디에도 뜨지 않는다 — 오타 방지."""
        self.assertEqual(set(DEPARTMENT_LABELS), set(DEPARTMENTS))
        self.assertEqual(set(DEPARTMENT_SUMMARIES), set(DEPARTMENTS))
        self.assertEqual(set(DEPARTMENT_APP_PRESET), set(DEPARTMENTS))

    def test_app_presets_exist(self):
        for dept, preset in DEPARTMENT_APP_PRESET.items():
            with self.subTest(department=dept):
                self.assertIn(preset, APP_PRESETS)

    def test_slugs_are_url_safe(self):
        for dept in DEPARTMENTS:
            with self.subTest(department=dept):
                self.assertTrue(dept.isascii() and dept.islower() and dept.isalpha())

    def test_normalize_drops_unknown_values(self):
        self.assertEqual(normalize_department("dev"), "dev")
        self.assertEqual(normalize_department("  DEV "), "dev")
        self.assertEqual(normalize_department("마케팅"), "")
        self.assertEqual(normalize_department(None), "")

    def test_normalize_list_dedupes_but_keeps_the_caller_order(self):
        """첫 부서가 '그 일이 시작되는 자리'라서 순서를 다시 정렬하면 안 된다."""
        self.assertEqual(normalize_departments(["cs", "dev", "cs", "nope", ""]), ["cs", "dev"])
        self.assertEqual(normalize_departments(["dev", "cs"]), ["dev", "cs"])
        self.assertEqual(normalize_departments([]), [])
        self.assertEqual(normalize_departments(None), [])

    def test_vocabulary_is_serializable_for_the_client(self):
        vocab = department_vocabulary()
        self.assertEqual([v["id"] for v in vocab], list(DEPARTMENTS))
        for entry in vocab:
            with self.subTest(department=entry["id"]):
                self.assertEqual(set(entry), {"id", "label", "summary", "app_preset"})


class ScenarioPlacementTests(unittest.TestCase):
    def test_every_preset_scenario_has_a_known_department(self):
        for spec in DEFAULT_SCENARIOS:
            with self.subTest(scenario=spec["title"]):
                self.assertIn(
                    spec.get("department"),
                    DEPARTMENTS,
                    "시나리오를 추가할 때 부서를 빠뜨리면 로비에 쌓인다",
                )

    def test_no_empty_rooms(self):
        placed = {spec.get("department") for spec in DEFAULT_SCENARIOS}
        for dept in DEPARTMENTS:
            with self.subTest(department=dept):
                self.assertIn(dept, placed, "책상이 하나도 없는 방은 만들지 않는다")

    def test_engineering_track_lives_in_the_dev_room(self):
        """터미널·IDE 가 있는 방은 하나뿐이다 — 엔지니어링 트랙은 전부 거기 있다."""
        for spec in ENGINEERING_SCENARIOS:
            with self.subTest(scenario=spec["title"]):
                self.assertEqual(spec.get("department"), "dev")

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

    def test_unknown_department_is_dropped_not_rejected(self):
        """모르는 값으로 저장이 막히면 스튜디오가 한 번의 오타로 잠긴다."""
        parsed = ScenarioIn.model_validate({"title": "x", "department": "마케팅팀"})
        self.assertEqual(parsed.department, "")


if __name__ == "__main__":
    unittest.main()
