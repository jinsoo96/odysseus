"""Immutable assessment definitions bound to an attempt.

The editable Scenario/Assessment rows are authoring state. An attempt must never read those rows as
its source of truth after it has started, otherwise a later edit can silently change the problem,
NPC knowledge, points, or grading criteria for historical candidates.

To avoid a disruptive schema migration, the complete canonical definition is stored in the existing
Attempt.snapshot JSONB under reserved keys. Workspace submission digests live alongside it.
"""

from __future__ import annotations

import copy
import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .models import Assessment, AssessmentScenario, Attempt, Scenario

DEFINITION_KEY = "_definition"
DEFINITION_HASH_KEY = "_definition_hash"
DEFINITION_VERSION = 1


def _json_copy(value: Any) -> Any:
    """Detach mutable JSON values from SQLAlchemy rows and guarantee JSON-serializable output."""
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def canonical_hash(value: dict) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def scenario_to_spec(scenario: Scenario, *, ordinal: int, points: int) -> dict:
    return {
        "scenario_id": str(scenario.id),
        "ordinal": int(ordinal),
        "points": int(points),
        "title": scenario.title,
        "summary": scenario.summary,
        "difficulty": scenario.difficulty,
        "briefing_md": scenario.briefing_md,
        "characters": _json_copy(scenario.characters or []),
        "opening_messages": _json_copy(scenario.opening_messages or []),
        "initial_files": _json_copy(scenario.initial_files or []),
        "objectives_md": scenario.objectives_md,
        "npc_base_prompt": scenario.npc_base_prompt,
        "checks": _json_copy(scenario.checks or []),
        "rubric": _json_copy(scenario.rubric or {}),
        "agent_enabled": bool(scenario.agent_enabled),
    }


async def build_assessment_definition(db: AsyncSession, assessment: Assessment) -> dict:
    links = (
        await db.execute(
            select(AssessmentScenario)
            .where(AssessmentScenario.assessment_id == assessment.id)
            .options(selectinload(AssessmentScenario.scenario))
            .order_by(AssessmentScenario.ordinal)
        )
    ).scalars().all()
    spec = {
        "version": DEFINITION_VERSION,
        "assessment_id": str(assessment.id),
        "title": assessment.title,
        "description": assessment.description,
        "duration_min": int(assessment.duration_min),
        "agent_max_turns": int(assessment.agent_max_turns),
        "npc_provider_id": str(assessment.npc_provider_id) if assessment.npc_provider_id else None,
        "agent_provider_id": str(assessment.agent_provider_id) if assessment.agent_provider_id else None,
        "starts_at": assessment.starts_at.isoformat() if assessment.starts_at else None,
        "ends_at": assessment.ends_at.isoformat() if assessment.ends_at else None,
        "scenarios": [
            scenario_to_spec(link.scenario, ordinal=link.ordinal, points=link.points)
            for link in links
            if link.scenario is not None
        ],
    }
    # Hash excludes itself by construction and therefore identifies exactly what the candidate saw.
    spec["definition_hash"] = canonical_hash(spec)
    return spec


def bind_definition(attempt: Attempt, definition: dict) -> None:
    snap = dict(attempt.snapshot or {})
    snap[DEFINITION_KEY] = _json_copy(definition)
    snap[DEFINITION_HASH_KEY] = str(definition.get("definition_hash") or canonical_hash(definition))
    attempt.snapshot = snap


async def definition_for_attempt(db: AsyncSession, attempt: Attempt) -> dict:
    snap = attempt.snapshot or {}
    frozen = snap.get(DEFINITION_KEY)
    if isinstance(frozen, dict) and frozen.get("scenarios") is not None:
        return _json_copy(frozen)

    # Legacy attempts predate definition snapshots. Keep them readable; the first new write/evaluation
    # should persist a snapshot so subsequent reads become reproducible.
    assessment = await db.get(Assessment, attempt.assessment_id)
    if not assessment:
        raise LookupError("assessment not found for attempt")
    definition = await build_assessment_definition(db, assessment)
    bind_definition(attempt, definition)
    await db.commit()
    return definition


@dataclass(slots=True)
class FrozenScenario:
    id: uuid.UUID
    title: str
    summary: str
    difficulty: str
    briefing_md: str
    characters: list
    opening_messages: list
    initial_files: list
    objectives_md: str
    npc_base_prompt: str
    checks: list
    rubric: dict
    agent_enabled: bool
    ordinal: int
    points: int


def scenario_from_definition(definition: dict, scenario_id: uuid.UUID | str) -> FrozenScenario | None:
    sid = str(scenario_id)
    for spec in definition.get("scenarios") or []:
        if str(spec.get("scenario_id")) != sid:
            continue
        return FrozenScenario(
            id=uuid.UUID(sid),
            title=str(spec.get("title") or ""),
            summary=str(spec.get("summary") or ""),
            difficulty=str(spec.get("difficulty") or "medium"),
            briefing_md=str(spec.get("briefing_md") or ""),
            characters=copy.deepcopy(spec.get("characters") or []),
            opening_messages=copy.deepcopy(spec.get("opening_messages") or []),
            initial_files=copy.deepcopy(spec.get("initial_files") or []),
            objectives_md=str(spec.get("objectives_md") or ""),
            npc_base_prompt=str(spec.get("npc_base_prompt") or ""),
            checks=copy.deepcopy(spec.get("checks") or []),
            rubric=copy.deepcopy(spec.get("rubric") or {}),
            agent_enabled=bool(spec.get("agent_enabled", True)),
            ordinal=int(spec.get("ordinal", 0) or 0),
            points=int(spec.get("points", 0) or 0),
        )
    return None


def provider_id(definition: dict, key: str) -> uuid.UUID | None:
    value = definition.get(key)
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def definition_summary(snapshot: dict | None) -> tuple[str | None, str | None]:
    snap = snapshot or {}
    definition = snap.get(DEFINITION_KEY)
    if not isinstance(definition, dict):
        return None, None
    return str(definition.get("title") or "") or None, str(snap.get(DEFINITION_HASH_KEY) or "") or None
