"""리뷰 — 스태프의 응시 열람/평가.

과거 응시의 문제·배점·숨은 목표·체크는 현재 authoring row가 아니라 응시 시작 시 저장한
immutable definition snapshot을 사용한다. 자동/수동 평가 모두 종료된 응시에만 허용한다.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..ai import provider as ai_provider
from ..ai.assessment_eval import run_auto_eval
from ..ai.autoeval import run_checks
from ..ai.errors import redact
from ..db import get_db
from ..definitions import (
    DEFINITION_HASH_KEY,
    definition_for_attempt,
    definition_summary,
    scenario_from_definition,
)
from ..deps import is_staff, require_staff
from ..models import AiProvider, Attempt, Evaluation, Event, User
from ..schemas import AutoEvalIn, HumanEvalIn

router = APIRouter(prefix="/review", tags=["review"], dependencies=[Depends(require_staff)])


@router.get("/attempts")
async def list_attempts(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(Attempt)
            .options(selectinload(Attempt.user), selectinload(Attempt.assessment))
            .order_by(Attempt.started_at.desc())
        )
    ).scalars().all()
    evals = (await db.execute(select(Evaluation.attempt_id, Evaluation.kind))).all()
    eval_kinds: dict[uuid.UUID, set[str]] = {}
    for attempt_id, kind in evals:
        eval_kinds.setdefault(attempt_id, set()).add(kind)
    out = []
    for a in rows:
        frozen_title, definition_hash = definition_summary(a.snapshot)
        out.append(
            {
                "id": str(a.id),
                "user": {"id": str(a.user.id), "name": a.user.name, "email": a.user.email, "role": a.user.role},
                "assessment_id": str(a.assessment_id),
                "assessment_title": frozen_title or a.assessment.title,
                "definition_hash": definition_hash,
                "status": a.status,
                "superseded": a.superseded,
                "is_staff": is_staff(a.user),
                "started_at": a.started_at.isoformat(),
                "submitted_at": a.submitted_at.isoformat() if a.submitted_at else None,
                "has_auto_eval": "auto" in eval_kinds.get(a.id, set()),
                "has_human_eval": "human" in eval_kinds.get(a.id, set()),
            }
        )
    return out


async def _load_attempt(attempt_id: uuid.UUID, db: AsyncSession) -> Attempt:
    attempt = (
        await db.execute(
            select(Attempt)
            .where(Attempt.id == attempt_id)
            .options(selectinload(Attempt.user), selectinload(Attempt.assessment))
        )
    ).scalar_one_or_none()
    if not attempt:
        raise HTTPException(404, "응시 정보를 찾을 수 없습니다")
    return attempt


def _require_final(attempt: Attempt) -> None:
    if attempt.status == "in_progress":
        raise HTTPException(409, "진행 중인 시험은 평가할 수 없습니다. 먼저 제출 또는 종료하세요")


@router.get("/attempts/{attempt_id}")
async def attempt_detail(attempt_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    attempt = await _load_attempt(attempt_id, db)
    definition = await definition_for_attempt(db, attempt)
    evaluations = (
        await db.execute(
            select(Evaluation)
            .where(Evaluation.attempt_id == attempt_id)
            .options(selectinload(Evaluation.evaluator))
            .order_by(Evaluation.created_at.desc())
        )
    ).scalars().all()
    scenarios = []
    for spec in sorted(definition.get("scenarios") or [], key=lambda x: int(x.get("ordinal", 0) or 0)):
        scenario = scenario_from_definition(definition, spec.get("scenario_id"))
        if not scenario:
            continue
        scenarios.append(
            {
                "scenario_id": str(scenario.id),
                "title": scenario.title,
                "difficulty": scenario.difficulty,
                "ordinal": scenario.ordinal,
                "points": scenario.points,
                "briefing_md": scenario.briefing_md,
                "objectives_md": scenario.objectives_md,
                "checks": scenario.checks,
                "rubric": scenario.rubric,
                "characters": scenario.characters,
                "initial_files": [f.get("path") for f in (scenario.initial_files or [])],
            }
        )
    return {
        "id": str(attempt.id),
        "status": attempt.status,
        "superseded": attempt.superseded,
        "started_at": attempt.started_at.isoformat(),
        "deadline_at": attempt.deadline_at.isoformat(),
        "submitted_at": attempt.submitted_at.isoformat() if attempt.submitted_at else None,
        "definition_hash": (attempt.snapshot or {}).get(DEFINITION_HASH_KEY) or definition.get("definition_hash"),
        "user": {
            "id": str(attempt.user.id),
            "name": attempt.user.name,
            "email": attempt.user.email,
            "role": attempt.user.role,
        },
        "assessment": {
            "id": str(attempt.assessment_id),
            "title": definition.get("title") or attempt.assessment.title,
            "description": definition.get("description") or "",
            "duration_min": int(definition.get("duration_min", 0) or 0),
            "agent_max_turns": int(definition.get("agent_max_turns", 0) or 0),
        },
        "scenarios": scenarios,
        "evaluations": [
            {
                "id": str(e.id),
                "kind": e.kind,
                "evaluator": e.evaluator.name if e.evaluator else None,
                "scores": e.scores,
                "summary": e.summary,
                "created_at": e.created_at.isoformat(),
            }
            for e in evaluations
        ],
    }


@router.get("/attempts/{attempt_id}/events")
async def attempt_events(attempt_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await _load_attempt(attempt_id, db)
    events = (
        await db.execute(
            select(Event).where(Event.attempt_id == attempt_id).order_by(Event.created_at)
        )
    ).scalars().all()
    return [
        {
            "id": e.id,
            "scenario_id": str(e.scenario_id) if e.scenario_id else None,
            "type": e.type,
            "source": e.source,
            "payload": e.payload,
            "created_at": e.created_at.isoformat(),
        }
        for e in events
    ]


@router.get("/ai-providers")
async def eval_providers(db: AsyncSession = Depends(get_db)):
    rows = (
        await db.execute(
            select(AiProvider).where(AiProvider.enabled.is_(True)).order_by(AiProvider.created_at)
        )
    ).scalars().all()
    return [
        {
            "id": str(r.id),
            "name": r.name,
            "provider": r.provider,
            "model": r.model,
            "is_eval_default": r.is_eval_default,
        }
        for r in rows
    ]


@router.post("/attempts/{attempt_id}/checks")
async def run_scenario_checks(attempt_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """종료된 응시에 대해 frozen checks만 실행한다 — 현재 스튜디오의 수정값은 읽지 않는다."""
    attempt = await _load_attempt(attempt_id, db)
    _require_final(attempt)
    definition = await definition_for_attempt(db, attempt)
    out = []
    for spec in sorted(definition.get("scenarios") or [], key=lambda x: int(x.get("ordinal", 0) or 0)):
        scenario = scenario_from_definition(definition, spec.get("scenario_id"))
        if not scenario:
            continue
        checks = await run_checks(db, attempt, scenario)
        out.append(
            {
                "scenario_id": str(scenario.id),
                "title": scenario.title,
                "checks": checks,
                "earned": sum(c["earned"] for c in checks),
                "total": sum(c["points"] for c in checks),
            }
        )
    return {
        "definition_hash": (attempt.snapshot or {}).get(DEFINITION_HASH_KEY) or definition.get("definition_hash"),
        "scenarios": out,
    }


@router.post("/attempts/{attempt_id}/autoeval")
async def autoeval(
    attempt_id: uuid.UUID, body: AutoEvalIn | None = None, db: AsyncSession = Depends(get_db)
):
    attempt = await _load_attempt(attempt_id, db)
    _require_final(attempt)
    try:
        evaluation = await run_auto_eval(
            attempt, db, override_provider_id=body.provider_id if body else None
        )
    except RuntimeError as e:
        raise HTTPException(503, redact(str(e))[:600])
    return {
        "id": str(evaluation.id),
        "kind": evaluation.kind,
        "scores": evaluation.scores,
        "summary": evaluation.summary,
        "created_at": evaluation.created_at.isoformat(),
    }


@router.post("/attempts/{attempt_id}/evaluate")
async def human_evaluate(
    attempt_id: uuid.UUID,
    body: HumanEvalIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_staff),
):
    attempt = await _load_attempt(attempt_id, db)
    _require_final(attempt)
    definition = await definition_for_attempt(db, attempt)
    scores = dict(body.scores or {})
    scores["audit"] = {
        **(scores.get("audit") if isinstance(scores.get("audit"), dict) else {}),
        "definition_hash": (attempt.snapshot or {}).get(DEFINITION_HASH_KEY) or definition.get("definition_hash"),
        "evaluator_id": str(user.id),
        "kind": "human",
    }
    evaluation = Evaluation(
        attempt_id=attempt_id,
        kind="human",
        evaluator_id=user.id,
        scores=scores,
        summary=body.summary,
    )
    db.add(evaluation)
    await db.commit()
    return {"id": str(evaluation.id), "ok": True}
