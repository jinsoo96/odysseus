"""Reproducible assessment evaluation bound to an Attempt definition snapshot.

The LLM remains useful for qualitative process judgement, but it is not allowed to overwrite
objective artifact checks. Deterministic checks participate mathematically in the result score and
all inputs that matter for later auditing are identified by hashes/versions in Evaluation.scores.
"""

from __future__ import annotations

import hashlib
import json
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..definitions import (
    DEFINITION_HASH_KEY,
    definition_for_attempt,
    scenario_from_definition,
)
from ..lifecycle import workspace_digest
from ..models import Attempt, Evaluation, MessengerMessage
from ..requirements_graph import graph_metrics
from . import provider
from .autoeval import (
    EVAL_PROMPT,
    default_rubric,
    gather_evidence,
    parse_eval_json,
    run_checks,
    validate_eval_output,
    _section_score,
)

SCORE_ENGINE_VERSION = "odysseus-score/2"
DEFAULT_DETERMINISTIC_RESULT_WEIGHT = 70.0
EVAL_PROMPT_SHA256 = hashlib.sha256(EVAL_PROMPT.encode("utf-8")).hexdigest()


def _pct(earned: float, total: float) -> float:
    return max(0.0, min(100.0, (earned / (total or 1.0)) * 100.0))


def combine_scores(
    *,
    process_earned: float,
    process_total: float,
    qualitative_result_earned: float,
    qualitative_result_total: float,
    checks_earned: float,
    checks_total: float,
    rubric: dict,
) -> dict:
    """Pure server-side score calculation.

    Result quality is objective-check dominant by default (70/30). A scenario author can override
    `deterministic_check_weight` in the rubric, but the server clamps it to [0, 100]. When a scenario
    has no deterministic checks, result scoring falls back to the qualitative rubric instead of
    manufacturing an objective score.
    """
    process_pct = _pct(process_earned, process_total)
    qualitative_pct = _pct(qualitative_result_earned, qualitative_result_total)
    deterministic_pct = _pct(checks_earned, checks_total) if checks_total > 0 else None

    requested = rubric.get("deterministic_check_weight", DEFAULT_DETERMINISTIC_RESULT_WEIGHT)
    try:
        deterministic_weight = max(0.0, min(100.0, float(requested)))
    except (TypeError, ValueError):
        deterministic_weight = DEFAULT_DETERMINISTIC_RESULT_WEIGHT
    if deterministic_pct is None:
        deterministic_weight = 0.0
    elif qualitative_result_total <= 0:
        # rubric 에 정성 result 항목이 없으면 '0점짜리 30%' 를 섞지 않는다 — checks 가 result 전부다.
        deterministic_weight = 100.0
    qualitative_weight = 100.0 - deterministic_weight
    result_pct = (
        (deterministic_pct or 0.0) * deterministic_weight
        + qualitative_pct * qualitative_weight
    ) / 100.0

    try:
        process_weight = max(0.0, float(rubric.get("process_weight", 50) or 0))
        result_weight = max(0.0, float(rubric.get("result_weight", 50) or 0))
    except (TypeError, ValueError):
        process_weight, result_weight = 50.0, 50.0
    weight_sum = process_weight + result_weight
    if weight_sum <= 0:
        process_weight = result_weight = 50.0
        weight_sum = 100.0
    overall_pct = (process_pct * process_weight + result_pct * result_weight) / weight_sum

    return {
        "version": SCORE_ENGINE_VERSION,
        "overall_pct": round(overall_pct, 3),
        "process_pct": round(process_pct, 3),
        "result_pct": round(result_pct, 3),
        "qualitative_result_pct": round(qualitative_pct, 3),
        "deterministic_result_pct": round(deterministic_pct, 3) if deterministic_pct is not None else None,
        "weights": {
            "process": process_weight,
            "result": result_weight,
            "deterministic_within_result": deterministic_weight,
            "qualitative_within_result": qualitative_weight,
        },
    }


async def _requirement_metrics(db: AsyncSession, attempt: Attempt, scenario, checks: list[dict]) -> dict:
    contacted = set(
        (
            await db.execute(
                select(MessengerMessage.character_key).where(
                    MessengerMessage.attempt_id == attempt.id,
                    MessengerMessage.scenario_id == scenario.id,
                    MessengerMessage.sender == "candidate",
                )
            )
        ).scalars().all()
    )
    passed = {f"check-{i + 1}" for i, check in enumerate(checks) if bool(check.get("passed"))}
    return graph_metrics(
        scenario.requirement_graph or {},
        contacted_characters={str(v) for v in contacted if v},
        passed_check_ids=passed,
    )


async def evaluate_frozen_scenario(
    db: AsyncSession,
    res: provider.ResolvedAi,
    attempt: Attempt,
    scenario,
) -> dict:
    checks = await run_checks(db, attempt, scenario)
    requirement_metrics = await _requirement_metrics(db, attempt, scenario, checks)

    integrity_note = None
    snap = (attempt.snapshot or {}).get(str(scenario.id))
    if isinstance(snap, dict) and snap.get("digest"):
        now_digest = await workspace_digest(db, attempt.id, scenario.id)
        if now_digest["digest"] != snap.get("digest"):
            integrity_note = "제출 시점 스냅샷과 워크스페이스 내용이 다릅니다 — 제출 후 변경이 의심됩니다"

    evidence = await gather_evidence(db, attempt, scenario, checks)
    injection_hits = evidence.pop("_injection_hits", [])
    # This section is trusted server-generated context. It gives the qualitative judge a structured
    # view of which stakeholders the candidate actually contacted and which requirements were verified.
    trusted = evidence.setdefault("trusted", {})
    trusted["requirement_graph"] = scenario.requirement_graph
    trusted["requirement_metrics"] = requirement_metrics
    raw = await provider.complete_text(
        res,
        [{"role": "user", "content": json.dumps(evidence, ensure_ascii=False, indent=1)}],
        system=EVAL_PROMPT,
        max_tokens=4096,
    )
    rubric = scenario.rubric or default_rubric()
    try:
        parsed = parse_eval_json(raw)
        parse_error = False
    except (json.JSONDecodeError, ValueError):
        parsed = {"summary": raw[:2000]}
        parse_error = True
    data, schema_issues = validate_eval_output(parsed if isinstance(parsed, dict) else {}, rubric)

    p_earned, p_total = _section_score(data.get("process", []), rubric.get("process") or [])
    r_earned, r_total = _section_score(data.get("result", []), rubric.get("result") or [])
    checks_earned = float(sum(c["earned"] for c in checks))
    checks_total = float(sum(c["points"] for c in checks))
    score_engine = combine_scores(
        process_earned=p_earned,
        process_total=p_total,
        qualitative_result_earned=r_earned,
        qualitative_result_total=r_total,
        checks_earned=checks_earned,
        checks_total=checks_total,
        rubric=rubric,
    )

    flags = list(data.get("integrity_flags", []))
    for hit in injection_hits:
        flags.append(f"평가 조작 시도 의심 ({hit['where']}): “{hit['snippet'][:160]}”")
    if integrity_note:
        flags.append(integrity_note)
    needs_review = bool(injection_hits) or parse_error or bool(schema_issues) or bool(integrity_note)

    return {
        "scenario_id": str(scenario.id),
        "title": scenario.title,
        "points": scenario.points,
        "score_pct": round(score_engine["overall_pct"], 1),
        "earned_points": round(scenario.points * score_engine["overall_pct"] / 100.0, 1),
        "score_engine": score_engine,
        "requirement_metrics": requirement_metrics,
        "requirement_graph_mode": (scenario.requirement_graph or {}).get("mode"),
        "checks": checks,
        "checks_earned": checks_earned,
        "checks_total": checks_total,
        "process": data.get("process", []),
        "result": data.get("result", []),
        "requirement_discovery": data.get("requirement_discovery", ""),
        "summary": data.get("summary", ""),
        "strengths": data.get("strengths", []),
        "concerns": data.get("concerns", []),
        "integrity_flags": flags,
        "injection_hits": injection_hits,
        "schema_issues": schema_issues,
        "needs_review": needs_review,
        "snapshot_verified": (integrity_note is None) if snap else None,
        "parse_error": parse_error,
    }


async def run_auto_eval(
    attempt: Attempt, db: AsyncSession, override_provider_id: uuid.UUID | None = None
) -> Evaluation:
    if attempt.status == "in_progress":
        raise RuntimeError("진행 중인 시험은 자동평가할 수 없습니다. 먼저 제출 또는 종료하세요")

    definition = await definition_for_attempt(db, attempt)
    res = await provider.resolve_ai(db, "eval", override_provider_id=override_provider_id)
    if res is None or not res.configured:
        raise RuntimeError("AI가 설정되지 않았습니다. 관리자 콘솔 > 설정에서 LLM 공급자를 연결하세요")

    scenario_results: list[dict] = []
    for spec in sorted(definition.get("scenarios") or [], key=lambda x: int(x.get("ordinal", 0) or 0)):
        scenario = scenario_from_definition(definition, spec.get("scenario_id"))
        if scenario:
            scenario_results.append(await evaluate_frozen_scenario(db, res, attempt, scenario))

    total_points = sum(float(r["points"]) for r in scenario_results) or 1.0
    overall = sum(float(r["earned_points"]) for r in scenario_results) / total_points * 100.0
    snapshot_hashes = {
        sid: value.get("digest")
        for sid, value in (attempt.snapshot or {}).items()
        if not sid.startswith("_") and isinstance(value, dict) and value.get("digest")
    }
    audit = {
        "definition_hash": (attempt.snapshot or {}).get(DEFINITION_HASH_KEY) or definition.get("definition_hash"),
        "definition_version": definition.get("version"),
        "workspace_digests": snapshot_hashes,
        "eval_prompt_sha256": EVAL_PROMPT_SHA256,
        "score_engine_version": SCORE_ENGINE_VERSION,
        "evaluator": {"provider": res.provider, "model": res.model, "name": res.name},
    }

    evaluation = Evaluation(
        attempt_id=attempt.id,
        kind="auto",
        scores={
            "overall_score": round(overall, 1),
            "scenarios": scenario_results,
            "evaluated_by": audit["evaluator"],
            "audit": audit,
        },
        summary="\n\n".join(
            f"[{r['title']}] {r['summary']}" for r in scenario_results if r.get("summary")
        )[:8000],
    )
    db.add(evaluation)
    await db.commit()
    await db.refresh(evaluation)
    return evaluation
