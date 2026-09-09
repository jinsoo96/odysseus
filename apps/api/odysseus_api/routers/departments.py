"""부서 CRUD — 사무실의 방을 관리자가 직접 만들고 고친다.

이 목록이 곧 평면도다. 부서를 하나 더 만들면 층에 방이 하나 더 생기고, 순서를 바꾸면
방이 옮겨 간다. 화면에는 좌표를 적어 둔 곳이 없다.

읽기는 로그인한 사람이면 누구나 할 수 있다 — 응시자도 사무실을 그리려면 방 이름과
색과 순서를 알아야 하기 때문이다. 쓰기는 관리자만 한다.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_db
from ..departments import (
    MAX_DEPARTMENTS,
    normalize_accent,
    normalize_app_preset,
    normalize_slug,
)
from ..deps import get_current_user, require_admin
from ..models import Department, Scenario, User

router = APIRouter(prefix="/departments", tags=["departments"])


class DepartmentIn(BaseModel):
    slug: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=60)
    summary: str = Field(default="", max_length=300)
    accent: str = Field(default="#62A8C8", max_length=9)
    app_preset: str = Field(default="office", max_length=20)


class DepartmentOut(BaseModel):
    id: uuid.UUID
    slug: str
    label: str
    summary: str
    accent: str
    ordinal: int
    app_preset: str
    #: 이 방에 놓인 시나리오 수 — 빈 방을 만들어 두고 잊지 않도록 관리 화면에 보여 준다
    scenario_count: int = 0

    model_config = {"from_attributes": True}


class ReorderIn(BaseModel):
    #: 새 순서대로 나열한 id. 평면도의 배치 순서가 그대로 이 순서다.
    ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_DEPARTMENTS)


async def _counts(db: AsyncSession) -> dict[str, int]:
    rows = (
        await db.execute(
            select(Scenario.department, func.count(Scenario.id))
            .where(Scenario.is_archived.is_(False))
            .group_by(Scenario.department)
        )
    ).all()
    return {slug: int(n) for slug, n in rows if slug}


async def _all(db: AsyncSession) -> list[DepartmentOut]:
    rows = (
        await db.execute(select(Department).order_by(Department.ordinal, Department.slug))
    ).scalars().all()
    counts = await _counts(db)
    return [
        DepartmentOut(
            id=r.id,
            slug=r.slug,
            label=r.label,
            summary=r.summary,
            accent=r.accent,
            ordinal=r.ordinal,
            app_preset=r.app_preset,
            scenario_count=counts.get(r.slug, 0),
        )
        for r in rows
    ]


@router.get("", response_model=list[DepartmentOut])
async def list_departments(
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    """응시자도 읽는다 — 사무실을 그리려면 방 이름과 색과 순서가 필요하다."""
    return await _all(db)


def _apply(row: Department, body: DepartmentIn) -> None:
    slug = normalize_slug(body.slug)
    if not slug:
        raise HTTPException(
            400, "부서 키는 소문자 영문으로 시작하고 영문·숫자·하이픈만 쓸 수 있습니다"
        )
    row.slug = slug
    row.label = body.label.strip()
    row.summary = body.summary.strip()
    row.accent = normalize_accent(body.accent)
    row.app_preset = normalize_app_preset(body.app_preset)


@router.post("", response_model=DepartmentOut)
async def create_department(
    body: DepartmentIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    total = int((await db.execute(select(func.count(Department.id)))).scalar_one())
    if total >= MAX_DEPARTMENTS:
        raise HTTPException(
            400,
            f"방은 {MAX_DEPARTMENTS}개까지 만들 수 있습니다. "
            "그보다 많으면 한 화면에서 방 이름이 읽히지 않습니다.",
        )
    row = Department(ordinal=total)
    _apply(row, body)
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "이미 있는 부서 키입니다")
    await db.refresh(row)
    return DepartmentOut(**{**row.__dict__, "scenario_count": 0})


@router.put("/order", response_model=list[DepartmentOut])
async def reorder_departments(
    body: ReorderIn, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    """평면도의 배치 순서를 통째로 바꾼다.

    한 건씩 고치지 않는 이유는, 중간 상태에서 두 방이 같은 자리를 갖는 순간이
    생기기 때문이다. 순서는 목록 전체가 한 번에 정한다.
    """
    rows = (await db.execute(select(Department))).scalars().all()
    by_id = {r.id: r for r in rows}
    if set(by_id) != set(body.ids):
        raise HTTPException(400, "순서 목록이 현재 부서 목록과 다릅니다")
    for i, dept_id in enumerate(body.ids):
        by_id[dept_id].ordinal = i
    await db.commit()
    return await _all(db)


@router.put("/{department_id}", response_model=DepartmentOut)
async def update_department(
    department_id: uuid.UUID,
    body: DepartmentIn,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    row = await db.get(Department, department_id)
    if not row:
        raise HTTPException(404, "부서를 찾을 수 없습니다")
    previous = row.slug
    _apply(row, body)
    # 키를 바꾸면 그 방에 있던 시나리오가 통째로 갈 곳을 잃는다. 같이 옮겨 준다 —
    # 이름을 고쳤을 뿐인데 방이 비어 버리면 그건 고친 게 아니라 부순 것이다.
    if previous != row.slug:
        await db.execute(
            Scenario.__table__.update()
            .where(Scenario.department == previous)
            .values(department=row.slug)
        )
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "이미 있는 부서 키입니다")
    await db.refresh(row)
    counts = await _counts(db)
    return DepartmentOut(**{**row.__dict__, "scenario_count": counts.get(row.slug, 0)})


@router.delete("/{department_id}")
async def delete_department(
    department_id: uuid.UUID, db: AsyncSession = Depends(get_db), _=Depends(require_admin)
):
    row = await db.get(Department, department_id)
    if not row:
        raise HTTPException(404, "부서를 찾을 수 없습니다")
    counts = await _counts(db)
    used = counts.get(row.slug, 0)
    if used:
        raise HTTPException(
            409,
            f"이 방에 시나리오 {used}개가 있습니다. 먼저 다른 방으로 옮기세요 — "
            "방을 지운다고 시나리오가 사라지지는 않지만, 갈 곳을 잃고 로비에 쌓입니다.",
        )
    await db.delete(row)
    # 지운 자리를 메워 순서를 촘촘하게 다시 매긴다
    rows = (
        await db.execute(select(Department).order_by(Department.ordinal, Department.slug))
    ).scalars().all()
    for i, r in enumerate([r for r in rows if r.id != department_id]):
        r.ordinal = i
    await db.commit()
    return {"ok": True}
