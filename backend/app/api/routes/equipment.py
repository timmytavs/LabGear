
"""LabGear Frontend/Backend Integration — File 70: read-only equipment API.

Destination: backend/app/api/routes/equipment.py (CREATE)

Mount in app/main.py in File 71:
    from app.api.routes.equipment import router as equipment_router
    app.include_router(equipment_router)

All routes require a valid server-side session cookie; the nine-minute idle
limit and active-account check are enforced by the existing session service.
The routes read existing PostgreSQL inventory and the stock-summary VIEW.
They do not create records, use fictitious counts, or change inventory state.

GET /api/equipment                  catalog with search/filter/pagination
GET /api/equipment/categories       available catalog categories
GET /api/equipment/stats            real inventory totals for the dashboard
GET /api/equipment/{equipment_id}   one active equipment type

Stock numbers represent the *current* database view, not guaranteed future
availability for a reservation date. Reserving equipment will require a
separate authorized transaction and availability recheck.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.db.dependencies import DbSession
from app.models.inventory import (
    Equipment,
    EquipmentCategory,
    equipment_stock_summary,
)
from app.services.session_service import (
    SESSION_COOKIE_NAME,
    SessionUnavailable,
    require_authenticated_session,
)

router = APIRouter(prefix="/api/equipment", tags=["Equipment Catalog"])


class EquipmentItem(BaseModel):
    id: int
    category_id: int
    category_name: str
    equipment_code: str
    equipment_name: str
    description: str | None
    manufacturer: str | None
    model_number: str | None
    total_units: int = Field(ge=0)
    available_units: int = Field(ge=0)
    reserved_units: int = Field(ge=0)
    issued_units: int = Field(ge=0)
    damaged_units: int = Field(ge=0)
    maintenance_units: int = Field(ge=0)


class EquipmentListResponse(BaseModel):
    items: list[EquipmentItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    pages: int = Field(ge=0)


class EquipmentCategoryItem(BaseModel):
    id: int
    category_name: str
    description: str | None
    active_equipment: int = Field(ge=0)


class EquipmentStats(BaseModel):
    total_equipment_types: int = Field(ge=0)
    equipment_types_in_stock: int = Field(ge=0)
    total_units: int = Field(ge=0)
    available_units: int = Field(ge=0)
    reserved_units: int = Field(ge=0)
    issued_units: int = Field(ge=0)


def _authorize(request: Request, db: Session) -> None:
    """Use the same DB-backed session check as GET /api/auth/me."""
    try:
        require_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            method="GET",
        )
    except SessionUnavailable:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in again.",
        ) from None


def _equipment_columns():
    """Explicit public fields; never expose asset tags or unit serials."""
    summary = equipment_stock_summary.c
    return (
        Equipment.id.label("id"),
        Equipment.category_id.label("category_id"),
        EquipmentCategory.category_name.label("category_name"),
        Equipment.equipment_code.label("equipment_code"),
        Equipment.equipment_name.label("equipment_name"),
        Equipment.description.label("description"),
        Equipment.manufacturer.label("manufacturer"),
        Equipment.model_number.label("model_number"),
        func.coalesce(summary.total_units, 0).label("total_units"),
        func.coalesce(summary.available_units, 0).label("available_units"),
        func.coalesce(summary.reserved_units, 0).label("reserved_units"),
        func.coalesce(summary.issued_units, 0).label("issued_units"),
        func.coalesce(summary.damaged_units, 0).label("damaged_units"),
        func.coalesce(summary.maintenance_units, 0).label("maintenance_units"),
    )


def _equipment_query():
    """Include active equipment with zero physical units via LEFT JOIN."""
    return (
        select(*_equipment_columns())
        .select_from(Equipment)
        .join(EquipmentCategory, Equipment.category_id == EquipmentCategory.id)
        .outerjoin(
            equipment_stock_summary,
            equipment_stock_summary.c.equipment_id == Equipment.id,
        )
        .where(Equipment.is_active.is_(True))
    )


def _filters(
    *, search: str | None, category_id: int | None, available_only: bool
):
    filters = []
    if category_id is not None:
        filters.append(Equipment.category_id == category_id)
    if available_only:
        filters.append(
            func.coalesce(equipment_stock_summary.c.available_units, 0) > 0
        )
    if search:
        term = search.strip()
        if term:
            pattern = f"%{term}%"
            filters.append(
                or_(
                    Equipment.equipment_name.ilike(pattern),
                    Equipment.equipment_code.ilike(pattern),
                    EquipmentCategory.category_name.ilike(pattern),
                )
            )
    return filters


@router.get("", response_model=EquipmentListResponse)
def list_equipment(
    request: Request,
    response: Response,
    db: DbSession,
    search: str | None = Query(default=None, max_length=100),
    category_id: int | None = Query(default=None, ge=1),
    available_only: bool = False,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=20, ge=1, le=50),
) -> EquipmentListResponse:
    """Return active equipment types; supports SQL-side filtering and paging."""
    _authorize(request, db)
    filters = _filters(
        search=search, category_id=category_id, available_only=available_only
    )
    base_query = _equipment_query().where(*filters)
    total = db.execute(
        select(func.count()).select_from(base_query.subquery())
    ).scalar_one()
    rows = db.execute(
        base_query.order_by(
            Equipment.equipment_name.asc(),
            Equipment.id.asc(),
        )
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return EquipmentListResponse(
        items=[EquipmentItem.model_validate(dict(row)) for row in rows],
        total=int(total),
        page=page,
        page_size=page_size,
        pages=(int(total) + page_size - 1) // page_size,
    )


@router.get("/categories", response_model=list[EquipmentCategoryItem])
def list_categories(
    request: Request, response: Response, db: DbSession
) -> list[EquipmentCategoryItem]:
    """Return category labels and counts of active equipment types."""
    _authorize(request, db)
    rows = db.execute(
        select(
            EquipmentCategory.id.label("id"),
            EquipmentCategory.category_name.label("category_name"),
            EquipmentCategory.description.label("description"),
            func.count(Equipment.id).label("active_equipment"),
        )
        .select_from(EquipmentCategory)
        .outerjoin(
            Equipment,
            and_(
                Equipment.category_id == EquipmentCategory.id,
                Equipment.is_active.is_(True),
            ),
        )
        .group_by(
            EquipmentCategory.id,
            EquipmentCategory.category_name,
            EquipmentCategory.description,
        )
        .order_by(EquipmentCategory.category_name.asc())
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return [
        EquipmentCategoryItem.model_validate(dict(row))
        for row in rows
    ]


@router.get("/stats", response_model=EquipmentStats)
def equipment_stats(
    request: Request, response: Response, db: DbSession
) -> EquipmentStats:
    """Current inventory totals (not reservation-date availability)."""
    _authorize(request, db)

    summary = equipment_stock_summary.c
    total_units = func.coalesce(summary.total_units, 0)
    available_units = func.coalesce(summary.available_units, 0)

    row = db.execute(
        select(
            func.count(Equipment.id).label("total_equipment_types"),
            func.count(Equipment.id)
            .filter(available_units > 0)
            .label("equipment_types_in_stock"),
            func.coalesce(func.sum(total_units), 0).label("total_units"),
            func.coalesce(func.sum(available_units), 0).label("available_units"),
            func.coalesce(
                func.sum(func.coalesce(summary.reserved_units, 0)), 0
            ).label("reserved_units"),
            func.coalesce(
                func.sum(func.coalesce(summary.issued_units, 0)), 0
            ).label("issued_units"),
        )
        .select_from(Equipment)
        .outerjoin(
            equipment_stock_summary,
            summary.equipment_id == Equipment.id,
        )
        .where(Equipment.is_active.is_(True))
    ).mappings().one()

    response.headers["Cache-Control"] = "no-store"
    return EquipmentStats.model_validate(dict(row))


@router.get("/{equipment_id}", response_model=EquipmentItem)
def get_equipment(
    equipment_id: int,
    request: Request,
    response: Response,
    db: DbSession,
) -> EquipmentItem:
    """Return one active equipment type; never expose internal unit details."""
    _authorize(request, db)

    if equipment_id < 1:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found.",
        )

    row = db.execute(
        _equipment_query().where(Equipment.id == equipment_id)
    ).mappings().one_or_none()

    if row is None:
        raise HTTPException(
            status_code=404,
            detail="Equipment not found.",
        )

    response.headers["Cache-Control"] = "no-store"
    return EquipmentItem.model_validate(dict(row))
