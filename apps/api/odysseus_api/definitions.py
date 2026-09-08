"""Immutable assessment definitions bound to an attempt.

Editable Scenario/Assessment/AiProvider rows are authoring state. An attempt reads a canonical JSON
snapshot captured at start, so later edits cannot change the problem, grading rules, model choice, or
sampling limits of a historical/in-progress candidate.
"""

from __future__ import annotations

import copy
import hashlib
import json
import uuid
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from .desktop import allowed_desktop_apps
from .models import AiProvider, Assessment, AssessmentScenario, Attempt, Scenario
from .requirements_graph import build_requirement_graph

DEFINITION_KEY = "_definition"
DEFINITION_HASH_KEY = "_definition_hash"
DEFINITION_VERSION = 3


def _json_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False, default=str))


def canonical_hash(value: dict) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def scenario_to_spec(scenario: Scenario, *, ordinal: int, points: int) -> dict:
    characters = _json_copy(scenario.characters or [])
    checks = _json_copy(scenario.checks or [])
    rubric = _json_copy(scenario.rubric or {})
    return {
        "scenario_id": str(scenario.id),
        "ordinal": int(ordinal),
        "points": int(points),
        "title": scenario.title,
        "summary": scenario.summary,
        "difficulty": scenario.difficulty,
        "briefing_md": scenario.briefing_md,
        "characters": characters,
        "opening_messages": _json_copy(scenario.opening_messages or []),
        "initial_files": _json_copy(scenario.initial_files or []),
        "objectives_md": scenario.objectives_md,
        "npc_base_prompt": scenario.npc_base_prompt,
        "checks": checks,
        "rubric": rubric,
        "desktop_apps": allowed_desktop_apps(scenario.desktop_apps or []),
        "requirement_graph": build_requirement_graph(
            objectives_md=scenario.objectives_md,
            characters=characters,
            checks=checks,
            rubric=rubric,
        ),
        "agent_enabled": bool(scenario.agent_enabled),
    }


async def _provider_profile(db: AsyncSession, provider_id_value: uuid.UUID | None) -> dict | None:
    """Freeze non-secret behavior. Credentials stay in encrypted AiProvider storage and are read live."""
    if not provider_id_value:
        return None
    row = await db.get(AiProvider, provider_id_value)
    if not row:
        return None
    return {
        "id": str(row.id),
        "name": row.name,
        "provider": row.provider,
        "model": row.model,
        "base_url": row.base_url,
        "temperature": float(row.temperature),
        "max_tokens": int(row.max_tokens),
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
        "provider_profiles": {
            "npc": await _provider_profile(db, assessment.npc_provider_id),
            "agent": await _provider_profile(db, assessment.agent_provider_id),
        },
        "starts_at": assessment.starts_at.isoformat() if assessment.starts_at else None,
        "ends_at": assessment.ends_at.isoformat() if assessment.ends_at else None,
        "scenarios": [
            scenario_to_spec(link.scenario, ordinal=link.ordinal, points=link.points)
            for link in links
            if link.scenario is not None
        ],
    }
    spec["definition_hash"] = canonical_hash(spec)
    return spec


def bind_definition(attempt: Attempt, definition: dict) -> None:
    snap = dict(attempt.snapshot or {})
    snap[DEFINITION_KEY] = _json_copy(definition)
    snap[DEFINITION_HASH_KEY] = str(definition.get("definition_hash") or canonical_hash(definition))
    attempt.snapshot = snap


async def definition_for_attempt(
    db: AsyncSession, attempt: Attempt, *, persist_legacy: bool = True
) -> dict:
    snap = attempt.snapshot or {}
    frozen = snap.get(DEFINITION_KEY)
    if isinstance(frozen, dict) and frozen.get("scenarios") is not None:
        return _json_copy(frozen)
    assessment = await db.get(Assessment, attempt.assessment_id)
    if not assessment:
        raise LookupError("assessment not found for attempt")
    definition = await build_assessment_definition(db, assessment)
    bind_definition(attempt, definition)
    if persist_legacy:
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
    requirement_graph: dict
    agent_enabled: bool
    desktop_apps: list
    ordinal: int
    points: int


def scenario_from_definition(definition: dict, scenario_id: uuid.UUID | str) -> FrozenScenario | None:
    sid = str(scenario_id)
    for spec in definition.get("scenarios") or []:
        if str(spec.get("scenario_id")) != sid:
            continue
        characters = copy.deepcopy(spec.get("characters") or [])
        checks = copy.deepcopy(spec.get("checks") or [])
        rubric = copy.deepcopy(spec.get("rubric") or {})
        requirement_graph = copy.deepcopy(spec.get("requirement_graph") or {})
        # v1/v2 snapshots remain evaluable. Derive the graph deterministically from their frozen data,
        # never from the current editable Scenario row.
        if not requirement_graph:
            requirement_graph = build_requirement_graph(
                objectives_md=str(spec.get("objectives_md") or ""),
                characters=characters,
                checks=checks,
                rubric=rubric,
            )
        return FrozenScenario(
            id=uuid.UUID(sid),
            title=str(spec.get("title") or ""),
            summary=str(spec.get("summary") or ""),
            difficulty=str(spec.get("difficulty") or "medium"),
            briefing_md=str(spec.get("briefing_md") or ""),
            characters=characters,
            opening_messages=copy.deepcopy(spec.get("opening_messages") or []),
            initial_files=copy.deepcopy(spec.get("initial_files") or []),
            objectives_md=str(spec.get("objectives_md") or ""),
            npc_base_prompt=str(spec.get("npc_base_prompt") or ""),
            checks=checks,
            rubric=rubric,
            requirement_graph=requirement_graph,
            agent_enabled=bool(spec.get("agent_enabled", True)),
            # v1/v2 스냅샷에는 이 키가 없다 — 그때의 화면과 같도록 전부 제공한다.
            desktop_apps=allowed_desktop_apps(spec.get("desktop_apps") or []),
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


async def resolve_attempt_ai(db: AsyncSession, definition: dict, role: str):
    """Resolve credentials live but apply the non-secret model/runtime settings frozen at attempt start."""
    from .ai import provider as ai_provider

    id_key = "npc_provider_id" if role == "npc" else "agent_provider_id"
    frozen_id = provider_id(definition, id_key)
    if frozen_id:
        row = await db.get(AiProvider, frozen_id)
        if not row or not row.enabled:
            return None
        resolved = ai_provider.resolved_from_row(row)
    else:
        resolved = await ai_provider.resolve_ai(db, "chat")
    if resolved is None:
        return None
    profile = (definition.get("provider_profiles") or {}).get(role)
    if not isinstance(profile, dict):
        return resolved
    return replace(
        resolved,
        provider=str(profile.get("provider") or resolved.provider),
        model=str(profile.get("model") or resolved.model),
        base_url=profile.get("base_url") or resolved.base_url,
        temperature=float(profile.get("temperature", resolved.temperature)),
        max_tokens=int(profile.get("max_tokens", resolved.max_tokens)),
        name=str(profile.get("name") or resolved.name),
    )


def definition_summary(snapshot: dict | None) -> tuple[str | None, str | None]:
    snap = snapshot or {}
    definition = snap.get(DEFINITION_KEY)
    if not isinstance(definition, dict):
        return None, None
    return str(definition.get("title") or "") or None, str(snap.get(DEFINITION_HASH_KEY) or "") or None
