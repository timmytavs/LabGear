"""LabGear File 125: technician inventory, unit condition and repair history API.

REPLACE: backend/app/api/routes/equipment_management.py

This router is deliberately separate from the existing read-only equipment.py
so the working catalog, reservations, approvals, issuance and returns stay intact.

New endpoints (mount this router in app/main.py in File 117):
  GET   /api/technician/inventory
  POST  /api/technician/inventory
  PATCH /api/technician/inventory/{equipment_id}
  GET   /api/technician/inventory/{equipment_id}/units
  POST  /api/technician/inventory/{equipment_id}/units
  PATCH /api/technician/inventory/{equipment_id}/units/{unit_id}/condition
  GET   /api/technician/inventory/{equipment_id}/condition-history

Only verified technician sessions may access these endpoints; all mutations
require the existing session CSRF token. The history endpoint reads existing
activity_logs events; no schema migrations are performed.
"""

from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from app.db.dependencies import DbSession
from app.models.inventory import Equipment, EquipmentCategory, EquipmentUnit
from app.models.reservations import Reservation, ReservationUnit
from app.models.security import ActivityLog
from app.models.user import User
from app.services.session_service import (
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    SessionCSRFRejected,
    SessionUnavailable,
    require_authenticated_session,
)

router = APIRouter(prefix="/api/technician/inventory", tags=["Technician Inventory"])

_ALLOWED_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)
_EQUIPMENT_CODE_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,39}$")
_ACTIVE_RESERVATION_STATUSES = (
    "pending", "approved", "partially_issued", "issued"
)


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


class EquipmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    category_id: int = Field(gt=0)
    equipment_code: str = Field(min_length=3, max_length=40)
    equipment_name: str = Field(min_length=3, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    manufacturer: str | None = Field(default=None, max_length=150)
    model_number: str | None = Field(default=None, max_length=100)
    unit_count: int = Field(default=1, ge=1, le=50)
    storage_location: str | None = Field(default=None, max_length=150)

    @field_validator("equipment_code")
    @classmethod
    def valid_code(cls, value: str) -> str:
        value = value.strip().upper()
        if not _EQUIPMENT_CODE_PATTERN.fullmatch(value):
            raise ValueError("Use 3–40 uppercase letters, numbers, or hyphens for the equipment code.")
        return value

    @field_validator("description", "manufacturer", "model_number", "storage_location")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        return _optional_text(value)


class EquipmentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    category_id: int | None = Field(default=None, gt=0)
    equipment_name: str | None = Field(default=None, min_length=3, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    manufacturer: str | None = Field(default=None, max_length=150)
    model_number: str | None = Field(default=None, max_length=100)
    is_active: bool | None = None

    @model_validator(mode="after")
    def require_any_change(self) -> "EquipmentEdit":
        if not self.model_fields_set:
            raise ValueError("Provide at least one equipment field to update.")
        return self

    @field_validator("description", "manufacturer", "model_number")
    @classmethod
    def clean_optional(cls, value: str | None) -> str | None:
        return _optional_text(value)


class UnitAddition(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    quantity: int = Field(ge=1, le=50)
    storage_location: str | None = Field(default=None, max_length=150)

    @field_validator("storage_location")
    @classmethod
    def clean_location(cls, value: str | None) -> str | None:
        return _optional_text(value)


class EquipmentSummary(BaseModel):
    id: int
    category_id: int
    category_name: str
    equipment_code: str
    equipment_name: str
    description: str | None
    manufacturer: str | None
    model_number: str | None
    is_active: bool
    total_units: int
    available_units: int


class EquipmentSummaryList(BaseModel):
    items: list[EquipmentSummary]
    total: int
    page: int
    page_size: int
    pages: int


class UnitItem(BaseModel):
    id: int
    equipment_id: int
    asset_tag: str
    serial_number: str | None
    storage_location: str | None
    unit_status: str
    notes: str | None


class UnitsResponse(BaseModel):
    equipment_id: int
    equipment_code: str
    items: list[UnitItem]


class InventoryOperationResponse(BaseModel):
    equipment: EquipmentSummary
    added_asset_tags: list[str] = Field(default_factory=list)
    message: str


def _technician(request: Request, db: DbSession, method: str):
    host = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None

    if (
        address is None
        or not address.is_loopback
        or request.url.hostname not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise HTTPException(status_code=403, detail="Inventory API is limited to local development hosts.")
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(status_code=403, detail="Origin not permitted.")
    origin = request.headers.get("origin")
    if origin is not None and origin not in _ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Origin not permitted.")

    method = method.upper()
    csrf_token = request.headers.get(CSRF_HEADER_NAME) if method != "GET" else None
    try:
        principal = require_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            method=method,
            csrf_token=csrf_token,
        )
    except SessionCSRFRejected:
        raise HTTPException(status_code=403, detail="CSRF verification failed.") from None
    except SessionUnavailable:
        raise HTTPException(status_code=401, detail="Sign in again to manage equipment.") from None

    if principal.role != "technician":
        raise HTTPException(status_code=403, detail="Only laboratory technicians may manage inventory.")
    return principal


def _category_or_404(db: DbSession, category_id: int) -> EquipmentCategory:
    item = db.get(EquipmentCategory, category_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Equipment category not found.")
    return item


def _equipment_or_404(db: DbSession, equipment_id: int, *, lock: bool = False) -> Equipment:
    statement = select(Equipment).where(Equipment.id == equipment_id)
    if lock:
        statement = statement.with_for_update()
    item = db.execute(statement).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="Equipment not found.")
    return item


def _summary(db: DbSession, item: Equipment) -> EquipmentSummary:
    category = _category_or_404(db, item.category_id)
    total, available = db.execute(
        select(
            func.count(EquipmentUnit.id),
            func.count(EquipmentUnit.id).filter(EquipmentUnit.unit_status == "available"),
        ).where(EquipmentUnit.equipment_id == item.id)
    ).one()
    return EquipmentSummary(
        id=item.id,
        category_id=item.category_id,
        category_name=category.category_name,
        equipment_code=item.equipment_code,
        equipment_name=item.equipment_name,
        description=item.description,
        manufacturer=item.manufacturer,
        model_number=item.model_number,
        is_active=bool(item.is_active),
        total_units=int(total),
        available_units=int(available),
    )


def _audit(db: DbSession, principal, request: Request, event: str, details: dict) -> None:
    db.add(
        ActivityLog(
            event_type=event,
            user_id=principal.user_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:1000],
            details=details,
        )
    )


def _add_units(
    db: DbSession, item: Equipment, quantity: int, storage_location: str | None
) -> list[str]:
    """The equipment row is locked by the caller to serialize asset tag creation."""
    existing = {
        tag.upper()
        for tag in db.execute(
            select(EquipmentUnit.asset_tag).where(EquipmentUnit.equipment_id == item.id)
        ).scalars().all()
    }
    created: list[str] = []
    sequence = 1
    while len(created) < quantity:
        if sequence > 99999:
            raise HTTPException(status_code=409, detail="No available asset tag numbers for this equipment.")
        tag = f"{item.equipment_code}-U{sequence:02d}"
        sequence += 1
        if tag.upper() in existing:
            continue
        existing.add(tag.upper())
        db.add(
            EquipmentUnit(
                equipment_id=item.id,
                asset_tag=tag,
                unit_status="available",
                storage_location=storage_location,
            )
        )
        created.append(tag)
    db.flush()
    return created


@router.get("", response_model=EquipmentSummaryList)
def list_inventory(
    request: Request,
    response: Response,
    db: DbSession,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=20, ge=1, le=50),
) -> EquipmentSummaryList:
    _technician(request, db, "GET")
    total = int(db.execute(select(func.count(Equipment.id))).scalar_one())
    equipments = db.execute(
        select(Equipment)
        .order_by(Equipment.equipment_name, Equipment.id)
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).scalars().all()
    response.headers["Cache-Control"] = "no-store"
    return EquipmentSummaryList(
        items=[_summary(db, item) for item in equipments],
        total=total,
        page=page,
        page_size=page_size,
        pages=ceil(total / page_size) if total else 0,
    )


@router.post("", response_model=InventoryOperationResponse, status_code=status.HTTP_201_CREATED)
def create_equipment(
    payload: EquipmentCreate, request: Request, response: Response, db: DbSession
) -> InventoryOperationResponse:
    principal = _technician(request, db, "POST")
    try:
        if db.execute(
            select(Equipment.id).where(Equipment.equipment_code == payload.equipment_code)
        ).first():
            raise HTTPException(status_code=409, detail="Equipment code already exists.")
        _category_or_404(db, payload.category_id)
        equipment = Equipment(
            category_id=payload.category_id,
            equipment_code=payload.equipment_code,
            equipment_name=payload.equipment_name,
            description=payload.description,
            manufacturer=payload.manufacturer,
            model_number=payload.model_number,
            is_active=True,
        )
        db.add(equipment)
        db.flush()
        tags = _add_units(db, equipment, payload.unit_count, payload.storage_location)
        _audit(db, principal, request, "equipment_created", {
            "equipment_id": equipment.id,
            "equipment_code": equipment.equipment_code,
            "added_units": len(tags),
        })
        result = InventoryOperationResponse(
            equipment=_summary(db, equipment),
            added_asset_tags=tags,
            message="Equipment and physical units added to inventory.",
        )
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return result
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Equipment code or asset tag already exists.") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Inventory service is temporarily unavailable.") from None


@router.patch("/{equipment_id}", response_model=InventoryOperationResponse)
def update_equipment(
    equipment_id: int,
    payload: EquipmentEdit,
    request: Request,
    response: Response,
    db: DbSession,
) -> InventoryOperationResponse:
    principal = _technician(request, db, "PATCH")
    try:
        equipment = _equipment_or_404(db, equipment_id, lock=True)
        changes = payload.model_dump(exclude_unset=True)
        if "category_id" in changes:
            _category_or_404(db, changes["category_id"])
        if changes.get("is_active") is False and equipment.is_active:
            active_count = int(db.execute(
                select(func.count(Reservation.id)).where(
                    Reservation.equipment_id == equipment.id,
                    Reservation.status.in_(_ACTIVE_RESERVATION_STATUSES),
                )
            ).scalar_one())
            if active_count:
                raise HTTPException(
                    status_code=409,
                    detail="Finish or reject the equipment's active reservations before deactivating it.",
                )
        for name, value in changes.items():
            setattr(equipment, name, value)
        equipment.updated_at = datetime.now(timezone.utc)
        db.flush()
        _audit(db, principal, request, "equipment_updated", {
            "equipment_id": equipment.id, "fields": sorted(changes)
        })
        result = InventoryOperationResponse(
            equipment=_summary(db, equipment),
            message="Equipment information updated.",
        )
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return result
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Equipment update violates a database constraint.") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Inventory service is temporarily unavailable.") from None


@router.get("/{equipment_id}/units", response_model=UnitsResponse)
def list_units(
    equipment_id: int, request: Request, response: Response, db: DbSession
) -> UnitsResponse:
    _technician(request, db, "GET")
    equipment = _equipment_or_404(db, equipment_id)
    units = db.execute(
        select(EquipmentUnit)
        .where(EquipmentUnit.equipment_id == equipment_id)
        .order_by(EquipmentUnit.asset_tag)
    ).scalars().all()
    response.headers["Cache-Control"] = "no-store"
    return UnitsResponse(
        equipment_id=equipment.id,
        equipment_code=equipment.equipment_code,
        items=[
            UnitItem(
                id=unit.id,
                equipment_id=unit.equipment_id,
                asset_tag=unit.asset_tag,
                serial_number=unit.serial_number,
                storage_location=unit.storage_location,
                unit_status=unit.unit_status,
                notes=unit.notes,
            )
            for unit in units
        ],
    )


@router.post("/{equipment_id}/units", response_model=InventoryOperationResponse, status_code=status.HTTP_201_CREATED)
def add_equipment_units(
    equipment_id: int,
    payload: UnitAddition,
    request: Request,
    response: Response,
    db: DbSession,
) -> InventoryOperationResponse:
    principal = _technician(request, db, "POST")
    try:
        equipment = _equipment_or_404(db, equipment_id, lock=True)
        if not equipment.is_active:
            raise HTTPException(status_code=409, detail="Reactivate this equipment before adding new units.")
        tags = _add_units(db, equipment, payload.quantity, payload.storage_location)
        equipment.updated_at = datetime.now(timezone.utc)
        _audit(db, principal, request, "equipment_units_added", {
            "equipment_id": equipment.id,
            "added_units": len(tags),
        })
        result = InventoryOperationResponse(
            equipment=_summary(db, equipment),
            added_asset_tags=tags,
            message="Physical equipment units added to inventory.",
        )
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return result
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="An asset tag already exists.") from None
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=503, detail="Inventory service is temporarily unavailable.") from None


# File 123 — unit condition management. Existing File 116 routes remain intact.
# Damage is recorded separately from reservation returns, and repaired units
# must be explicitly restored before they can be reserved again.
class UnitConditionChange(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    condition: str = Field(pattern=r"^(damaged|available)$")
    notes: str = Field(min_length=5, max_length=500)

    @field_validator("notes")
    @classmethod
    def meaningful_notes(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 5:
            raise ValueError("Give at least five characters describing the damage or repair.")
        return cleaned


class UnitConditionResult(BaseModel):
    unit: UnitItem
    equipment: EquipmentSummary
    previous_status: str
    changed: bool
    message: str


@router.patch(
    "/{equipment_id}/units/{unit_id}/condition",
    response_model=UnitConditionResult,
)
def update_unit_condition(
    equipment_id: int,
    unit_id: int,
    payload: UnitConditionChange,
    request: Request,
    response: Response,
    db: DbSession,
) -> UnitConditionResult:
    """Flag an available unit damaged or restore a damaged unit after repair.

    Do not modify reserved/issued units. A technician must complete the
    original check-in workflow before repairing a borrowed unit. Changes and
    the activity-log entry are committed together.
    """
    principal = _technician(request, db, "PATCH")
    if equipment_id <= 0 or unit_id <= 0:
        raise HTTPException(status_code=422, detail="Invalid equipment or unit ID.")

    try:
        # Match the reservation approval lock order: equipment before unit.
        equipment = _equipment_or_404(db, equipment_id, lock=True)
        unit = db.execute(
            select(EquipmentUnit)
            .where(
                EquipmentUnit.id == unit_id,
                EquipmentUnit.equipment_id == equipment.id,
            )
            .with_for_update()
        ).scalar_one_or_none()
        if unit is None:
            raise HTTPException(status_code=404, detail="Physical equipment unit not found.")

        previous_status = unit.unit_status
        if previous_status == payload.condition:
            raise HTTPException(
                status_code=409,
                detail="This unit already has the requested condition.",
            )
        if (previous_status, payload.condition) not in {
            ("available", "damaged"),
            ("damaged", "available"),
        }:
            raise HTTPException(
                status_code=409,
                detail="Only available units can be flagged damaged, and only damaged units can be restored. Complete any active handover first.",
            )

        # Defensive guard: even if an inconsistent row reports available,
        # never override an ongoing reservation's physical allocation.
        actively_allocated = db.execute(
            select(ReservationUnit.equipment_unit_id)
            .join(Reservation, Reservation.id == ReservationUnit.reservation_id)
            .where(
                ReservationUnit.equipment_unit_id == unit.id,
                ReservationUnit.allocation_status.in_(("reserved", "issued")),
                Reservation.status.in_(_ACTIVE_RESERVATION_STATUSES),
            )
            .limit(1)
        ).first()
        if actively_allocated is not None:
            raise HTTPException(
                status_code=409,
                detail="This unit is assigned to an active reservation; finish the handover first.",
            )

        now = datetime.now(timezone.utc)
        unit.unit_status = payload.condition
        unit.notes = payload.notes
        unit.updated_at = now
        equipment.updated_at = now
        _audit(
            db,
            principal,
            request,
            (
                "equipment_unit_marked_damaged"
                if payload.condition == "damaged"
                else "equipment_unit_restored"
            ),
            {
                "equipment_id": equipment.id,
                "equipment_unit_id": unit.id,
                "asset_tag": unit.asset_tag,
                "previous_status": previous_status,
                "new_status": payload.condition,
                "notes": payload.notes,
            },
        )
        result = UnitConditionResult(
            unit=UnitItem(
                id=unit.id,
                equipment_id=unit.equipment_id,
                asset_tag=unit.asset_tag,
                serial_number=unit.serial_number,
                storage_location=unit.storage_location,
                unit_status=unit.unit_status,
                notes=unit.notes,
            ),
            equipment=_summary(db, equipment),
            previous_status=previous_status,
            changed=True,
            message=(
                "Unit flagged as damaged and removed from available stock."
                if payload.condition == "damaged"
                else "Unit restored to available stock after repair or inspection."
            ),
        )
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return result
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Unit condition update is temporarily unavailable.",
        ) from None


# File 125 — read-only damage/repair history, sourced from the audit events
# already generated by File 123. No new table is needed, and these records
# remain available after a unit is restored to service.
class UnitConditionHistoryEntry(BaseModel):
    event_id: int
    changed_at: datetime
    event_type: str
    equipment_unit_id: int | None
    asset_tag: str | None
    previous_status: str | None
    new_status: str | None
    notes: str | None
    technician_username: str | None


class UnitConditionHistoryPage(BaseModel):
    equipment_id: int
    equipment_code: str
    items: list[UnitConditionHistoryEntry]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    pages: int = Field(ge=0)


@router.get(
    "/{equipment_id}/condition-history",
    response_model=UnitConditionHistoryPage,
)
def get_condition_history(
    equipment_id: int,
    request: Request,
    response: Response,
    db: DbSession,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=20, ge=1, le=50),
    unit_id: int | None = Query(default=None, gt=0),
) -> UnitConditionHistoryPage:
    """Show past damaged/restored events for one equipment type or one unit.

    Authenticated technician only. Pagination prevents unbounded audit-log
    disclosure; only the two existing condition-change event types are read.
    The notes and technician name are available to this privileged workspace,
    not to the public equipment catalog.
    """
    _technician(request, db, "GET")
    if equipment_id <= 0:
        raise HTTPException(status_code=422, detail="Invalid equipment ID.")
    try:
        equipment = _equipment_or_404(db, equipment_id)
        if unit_id is not None:
            owned = db.execute(
                select(EquipmentUnit.id).where(
                    EquipmentUnit.id == unit_id,
                    EquipmentUnit.equipment_id == equipment_id,
                )
            ).scalar_one_or_none()
            if owned is None:
                raise HTTPException(
                    status_code=404,
                    detail="Physical equipment unit not found.",
                )

        conditions = [
            ActivityLog.event_type.in_((
                "equipment_unit_marked_damaged",
                "equipment_unit_restored",
            )),
            ActivityLog.details.contains({"equipment_id": equipment_id}),
        ]
        if unit_id is not None:
            conditions.append(
                ActivityLog.details.contains({"equipment_unit_id": unit_id})
            )

        total = int(db.execute(
            select(func.count(ActivityLog.id)).where(*conditions)
        ).scalar_one())
        records = db.execute(
            select(ActivityLog, User.username)
            .outerjoin(User, User.id_number == ActivityLog.user_id)
            .where(*conditions)
            .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        items: list[UnitConditionHistoryEntry] = []
        for event, technician_username in records:
            details = event.details if isinstance(event.details, dict) else {}
            items.append(UnitConditionHistoryEntry(
                event_id=event.id,
                changed_at=event.created_at,
                event_type=event.event_type,
                equipment_unit_id=details.get("equipment_unit_id"),
                asset_tag=details.get("asset_tag"),
                previous_status=details.get("previous_status"),
                new_status=details.get("new_status"),
                notes=details.get("notes"),
                technician_username=technician_username,
            ))
        response.headers["Cache-Control"] = "no-store"
        return UnitConditionHistoryPage(
            equipment_id=equipment.id,
            equipment_code=equipment.equipment_code,
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=ceil(total / page_size) if total else 0,
        )
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=503,
            detail="Equipment condition history is temporarily unavailable.",
        ) from None
