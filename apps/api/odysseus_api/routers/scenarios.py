"""시나리오 CRUD — 관리자 스튜디오의 최신 authoring state.

응시자는 시작 시 고정된 definition snapshot을 사용하므로, 과거 응시를 바꾸지 않고도
시나리오를 계속 개선할 수 있다. 실제 응시 흔적이 존재하는 시나리오는 삭제 대신 보관한다.
"""

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai.autoeval import default_rubric
from ..ai.errors import describe_error
from ..checks import as_number
from ..db import get_db
from ..departments import normalize_slug
from ..deps import require_admin, require_staff
from ..models import AssessmentScenario, Execution, MessengerMessage, Scenario, User, WorkspaceFile
from ..schemas import ScenarioIn, ScenarioOut, ScenarioSummary


class AuthorChatIn(BaseModel):
    messages: list[dict] = Field(min_length=1, max_length=60)
    draft: ScenarioIn | None = None
    provider_id: uuid.UUID | None = None


class AuthorIn(BaseModel):
    brief: str = Field(default="", max_length=6000)
    draft: ScenarioIn | None = None
    instruction: str | None = Field(default=None, max_length=4000)
    provider_id: uuid.UUID | None = None


router = APIRouter(prefix="/scenarios", tags=["scenarios"])


def _validate(body: ScenarioIn) -> None:
    keys = [c.key for c in body.characters]
    if len(keys) != len(set(keys)):
        raise HTTPException(400, "등장인물 key가 중복됩니다")
    key_set = set(keys)
    for om in body.opening_messages:
        if om.character_key not in key_set:
            raise HTTPException(400, f"오프닝 메시지의 등장인물이 없습니다: {om.character_key}")
    paths = [f.path for f in body.initial_files]
    if len(paths) != len(set(paths)):
        raise HTTPException(400, "초기 파일 경로가 중복됩니다")
    for c in body.checks:
        if c.type != "command" and not (c.path or "").strip():
            raise HTTPException(400, f"체크 '{c.label}': path가 필요합니다")
        if c.type in ("file_contains", "file_not_contains"):
            if not (c.pattern or "").strip():
                raise HTTPException(400, f"체크 '{c.label}': pattern이 필요합니다")
            try:
                re.compile(c.pattern or "")
            except re.error as exc:
                raise HTTPException(400, f"체크 '{c.label}': 정규식 오류 — {exc}") from exc
        if c.type == "file_min_words" and not (c.min_count or 0):
            raise HTTPException(400, f"체크 '{c.label}': 최소 단어 수(min_count)가 필요합니다")
        if c.type == "file_max_words" and not (c.max_count or 0):
            raise HTTPException(400, f"체크 '{c.label}': 최대 단어 수(max_count)가 필요합니다")
        if c.type in ("csv_cell", "csv_column_sum", "csv_column_unique") and not (c.column or "").strip():
            raise HTTPException(400, f"체크 '{c.label}': column이 필요합니다")
        if c.type in ("csv_cell", "csv_row_count", "csv_column_sum"):
            if c.expected is None or not str(c.expected).strip():
                raise HTTPException(400, f"체크 '{c.label}': expected(기대값)가 필요합니다")
        if c.type in ("csv_row_count", "csv_column_sum") and as_number(str(c.expected or "")) is None:
            raise HTTPException(400, f"체크 '{c.label}': expected는 숫자여야 합니다")
        if c.type.startswith("csv_") and (c.row_match or "").strip() and "=" not in str(c.row_match):
            raise HTTPException(400, f"체크 '{c.label}': row_match는 '열이름=값' 형식이어야 합니다")
        if c.type == "command" and not (c.command or "").strip():
            raise HTTPException(400, f"체크 '{c.label}': command가 필요합니다")


def _apply(row: Scenario, body: ScenarioIn) -> None:
    row.title = body.title
    row.summary = body.summary
    row.difficulty = body.difficulty
    row.briefing_md = body.briefing_md
    row.characters = [c.model_dump() for c in body.characters]
    row.opening_messages = [m.model_dump() for m in body.opening_messages]
    row.initial_files = [f.model_dump() for f in body.initial_files]
    row.objectives_md = body.objectives_md
    row.npc_base_prompt = body.npc_base_prompt.strip()
    row.checks = [c.model_dump() for c in body.checks]
    row.rubric = body.rubric or default_rubric()
    row.agent_enabled = body.agent_enabled
    row.desktop_apps = list(body.desktop_apps or [])
    # 부서를 보내지 않은 요청은 부서를 건드리지 않는다. 저장은 전체 교체라, 이 필드를
    # 모르는 클라이언트가 시나리오를 한 번 저장할 때마다 방에서 로비로 내려가 버린다.
    if body.department is not None:
        row.department = body.department


async def _has_history(scenario_id: uuid.UUID, db: AsyncSession) -> bool:
    """Any persisted candidate evidence makes the scenario historical and therefore archive-only."""
    for model in (WorkspaceFile, MessengerMessage, Execution):
        row = (
            await db.execute(
                select(model.id).where(model.scenario_id == scenario_id).limit(1)
            )
        ).scalar_one_or_none()
        if row is not None:
            return True
    return False


@router.get("", response_model=list[ScenarioSummary])
async def list_scenarios(db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    rows = (await db.execute(select(Scenario).order_by(Scenario.updated_at.desc()))).scalars().all()
    return [
        ScenarioSummary(
            id=r.id,
            title=r.title,
            summary=r.summary,
            difficulty=r.difficulty,
            character_count=len(r.characters or []),
            check_count=len(r.checks or []),
            agent_enabled=r.agent_enabled,
            department=r.department or "",
            is_archived=r.is_archived,
            updated_at=r.updated_at,
        )
        for r in rows
    ]


@router.post("/author")
async def author_with_ai(
    body: AuthorIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    from ..ai import provider as ai_provider
    from ..ai.scenario_author import author_scenario

    if not body.brief.strip() and body.draft is None:
        raise HTTPException(400, "어떤 시나리오를 만들지 한 줄이라도 적어 주세요")
    res = await ai_provider.resolve_ai(db, "chat", override_provider_id=body.provider_id)
    if not res:
        raise HTTPException(503, "LLM 공급자가 설정되어 있지 않습니다 — [설정]에서 먼저 등록하세요")
    try:
        scenario, notes, warnings = await author_scenario(
            res,
            brief=body.brief,
            draft=body.draft.model_dump() if body.draft else None,
            instruction=body.instruction,
        )
    except ValueError as e:
        info = describe_error(e, where="author")
        raise HTTPException(502, f"{info['message']} (참조: {info['correlation_id']})")
    except Exception as e:  # noqa: BLE001
        info = describe_error(e, where="author")
        raise HTTPException(502, f"{info['message']} (참조: {info['correlation_id']})")
    return {"scenario": scenario, "notes": notes, "warnings": warnings, "provider": res.name}


@router.post("/author/stream")
async def author_chat(body: AuthorChatIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)):
    import json as _json

    from ..ai import provider as ai_provider
    from ..ai.scenario_author import author_chat_stream

    res = await ai_provider.resolve_ai(db, "chat", override_provider_id=body.provider_id)
    if not res:
        raise HTTPException(503, "LLM 공급자가 설정되어 있지 않습니다 — [설정]에서 먼저 등록하세요")
    draft = body.draft.model_dump() if body.draft else None

    async def gen():
        try:
            async for event in author_chat_stream(res, history=body.messages, draft=draft):
                yield f"data: {_json.dumps(event, ensure_ascii=False)}\n\n"
        except ValueError as e:
            info = describe_error(e, where="author-stream")
            yield f"data: {_json.dumps({'error': info['message'], 'code': info['code'], 'correlation_id': info['correlation_id']}, ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class DepartmentMoveIn(BaseModel):
    #: 옮길 부서의 키. 빈 문자열이면 로비(미배치)로 내린다.
    department: str = Field(default="", max_length=40)


@router.put("/{scenario_id}/department", response_model=ScenarioSummary)
async def move_scenario(
    scenario_id: uuid.UUID,
    body: DepartmentMoveIn,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """시나리오를 다른 방으로 옮긴다 — 부서만 바꾸고 나머지는 건드리지 않는다.

    전체 저장(`PUT /scenarios/{id}`)으로도 같은 일을 할 수 있지만, 그건 시나리오
    한 벌을 통째로 덮어쓰는 요청이다. 사무실을 재편성하려고 스물다섯 개를 옮기는데
    그때마다 인물과 초기 파일과 채점 기준을 왕복시킬 이유가 없다. 실수로 무언가를
    지울 여지도 그만큼 생긴다.

    진행 중인 응시에는 영향이 없다. 부서는 문제의 내용이 아니라 길찾기 정보라
    응시 시작 시 고정되는 스냅샷에 들어 있지 않다.
    """
    row = await db.get(Scenario, scenario_id)
    if not row:
        raise HTTPException(404, "시나리오를 찾을 수 없습니다")
    row.department = normalize_slug(body.department)
    await db.commit()
    await db.refresh(row)
    return ScenarioSummary(
        id=row.id,
        title=row.title,
        summary=row.summary,
        difficulty=row.difficulty,
        character_count=len(row.characters or []),
        check_count=len(row.checks or []),
        agent_enabled=row.agent_enabled,
        department=row.department or "",
        is_archived=row.is_archived,
        updated_at=row.updated_at,
    )


@router.get("/rubric-default")
async def rubric_default(_=Depends(require_staff)):
    return default_rubric()


@router.get("/npc-default-prompt")
async def npc_default_prompt(_=Depends(require_staff)):
    from ..ai.npc_prompt import BASE_RULES

    return {"prompt": BASE_RULES}


@router.post("", response_model=ScenarioOut)
async def create_scenario(
    body: ScenarioIn, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)
):
    _validate(body)
    row = Scenario(created_by=user.id)
    _apply(row, body)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.get("/{scenario_id}", response_model=ScenarioOut)
async def get_scenario(scenario_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_staff)):
    row = await db.get(Scenario, scenario_id)
    if not row:
        raise HTTPException(404, "시나리오를 찾을 수 없습니다")
    return row


@router.put("/{scenario_id}", response_model=ScenarioOut)
async def update_scenario(
    scenario_id: uuid.UUID, body: ScenarioIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    row = await db.get(Scenario, scenario_id)
    if not row:
        raise HTTPException(404, "시나리오를 찾을 수 없습니다")
    _validate(body)
    _apply(row, body)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{scenario_id}")
async def delete_scenario(
    scenario_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    row = await db.get(Scenario, scenario_id)
    if not row:
        raise HTTPException(404, "시나리오를 찾을 수 없습니다")
    linked = (
        await db.execute(
            select(func.count(AssessmentScenario.id)).where(AssessmentScenario.scenario_id == scenario_id)
        )
    ).scalar() or 0
    if linked or await _has_history(scenario_id, db):
        row.is_archived = True
        await db.commit()
        return {"ok": True, "archived": True}
    await db.delete(row)
    await db.commit()
    return {"ok": True, "archived": False}
