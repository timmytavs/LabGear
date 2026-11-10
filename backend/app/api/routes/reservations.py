"""
LabGear Backend File 113 — reservation, technician decision, issue and return API.

Destination: backend/app/api/routes/reservations.py (REPLACE existing file).

Existing endpoints preserved:
    POST /api/reservations
    GET  /api/reservations/my

New technician endpoints:
    GET  /api/reservations/pending
    POST /api/reservations/{reservation_id}/decision

New File 113 technician endpoints:
    GET  /api/reservations/active
    POST /api/reservations/{reservation_id}/issue
    POST /api/reservations/{reservation_id}/return

Business rules:
    * Students and instructors may submit reservation requests.
    * Requester identity comes only from the authenticated server-side session.
    * Technician-only access is required to view pending requests or decide them.
    * Mutating POST requests require the existing session CSRF token.
    * Browser requests remain restricted to the existing local development hosts.
    * Reservation dates must be timezone-aware and in the future at submission.
    * Quantity is limited to 1..50.
    * Equipment must be active when requested and when approved.
    * Equipment-row FOR UPDATE serializes reservation submissions and approvals.
    * Pending, approved, partially-issued, and issued requests count against
      capacity while their reservation time ranges overlap.
    * Approval allocates exact physical units only when enough non-conflicting
      units can be locked.
    * Rejection requires a recorded reason.
    * Reservation, decision, unit allocation, inventory status, and activity
      log changes commit in one transaction.
    * Issue requires approved status and already allocated units.
    * Return requires issued status; notes and condition are logged.
    * The issue/return feature operates on ALL allocated units in this first
      academic prototype; partial returns can be added separately later.

Uses existing PostgreSQL models. No schema changes or migrations.
"""

from __future__ import annotations

import ipaddress
import secrets
from datetime import datetime, timezone
from math import ceil
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from app.db.dependencies import DbSession
from app.models.inventory import Equipment, EquipmentUnit
from app.models.reservations import (
    Reservation,
    ReservationDecision,
    ReservationUnit,
)
from app.models.security import ActivityLog
from app.models.user import User
from app.services.session_service import (
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    SessionCSRFRejected,
    SessionUnavailable,
    require_authenticated_session,
)

router = APIRouter(prefix="/api/reservations", tags=["Reservations"])

_ALLOWED_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)

_ALLOWED_REQUEST_ROLES = frozenset({"student", "instructor"})
_TECHNICIAN_ROLE = "technician"

_BLOCKING_RESERVATION_STATUSES = (
    "pending",
    "approved",
    "partially_issued",
    "issued",
)

# A unit can be allocated if it is available, already reserved for a
# non-overlapping period, or returned from a previous borrowing.
# An issued unit is deliberately excluded until it has been checked back in.
_ALLOCATABLE_UNIT_STATUSES = (
    "available",
    "reserved",
    "returned",
)

_ACTIVE_ALLOCATION_STATUSES = (
    "reserved",
    "issued",
)


class ReservationCreateRequest(BaseModel):
    """Client-supplied details; requester ID is never accepted."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        hide_input_in_errors=True,
    )

    equipment_id: int = Field(gt=0)
    quantity: int = Field(ge=1, le=50)
    purpose: str = Field(min_length=5, max_length=1000)
    reservation_start: datetime
    reservation_end: datetime

    @field_validator("reservation_start", "reservation_end")
    @classmethod
    def require_timezone_aware_datetime(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError(
                "Reservation dates must include a timezone offset."
            )
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def validate_reservation_window(self) -> "ReservationCreateRequest":
        now = datetime.now(timezone.utc)

        if self.reservation_start <= now:
            raise ValueError("Reservation start must be in the future.")

        if self.reservation_end <= self.reservation_start:
            raise ValueError("Reservation end must be after the start.")

        return self


class ReservationItemResponse(BaseModel):
    id: int
    reservation_code: str
    equipment_id: int
    equipment_code: str
    equipment_name: str
    quantity: int
    purpose: str
    reservation_start: datetime
    reservation_end: datetime
    status: str
    created_at: datetime
    updated_at: datetime


class ReservationListResponse(BaseModel):
    items: list[ReservationItemResponse]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    pages: int = Field(ge=0)


class ReservationCreatedResponse(ReservationItemResponse):
    message: str


class PendingReservationItemResponse(ReservationItemResponse):
    requester_id: str
    requester_name: str
    requester_username: str
    requester_department: str
    requester_class_section_or_unit: str


class PendingReservationListResponse(BaseModel):
    items: list[PendingReservationItemResponse]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    pages: int = Field(ge=0)


class ReservationDecisionRequest(BaseModel):
    """A technician's decision; technician identity is never client-supplied."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        hide_input_in_errors=True,
    )

    decision: Literal["approved", "rejected"]
    remarks: str | None = Field(default=None, max_length=1000)

    @field_validator("remarks")
    @classmethod
    def normalize_remarks(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.strip()
        return cleaned or None

    @model_validator(mode="after")
    def require_rejection_reason(self) -> "ReservationDecisionRequest":
        if self.decision == "rejected" and (
            self.remarks is None or len(self.remarks) < 5
        ):
            raise ValueError(
                "Provide a rejection reason containing at least 5 characters."
            )
        return self


class AllocatedUnitResponse(BaseModel):
    unit_id: int
    asset_tag: str
    storage_location: str | None


class ReservationDecisionResponse(BaseModel):
    reservation_id: int
    reservation_code: str
    equipment_id: int
    equipment_code: str
    equipment_name: str
    decision: Literal["approved", "rejected"]
    status: str
    remarks: str | None
    decided_at: datetime
    allocated_units: list[AllocatedUnitResponse]
    message: str


def _require_local_browser_request(request: Request) -> str:
    """Match the existing local-only login API's host and origin restrictions."""

    client_host = request.client.host if request.client else ""

    try:
        client_address = ipaddress.ip_address(client_host)
    except ValueError:
        client_address = None

    if (
        client_address is None
        or not client_address.is_loopback
        or request.url.hostname not in {"localhost", "127.0.0.1", "::1"}
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Reservation API is currently limited to localhost.",
        )

    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Origin not permitted.",
        )

    origin = request.headers.get("origin")

    if origin is not None and origin not in _ALLOWED_ORIGINS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Origin not permitted.",
        )

    return str(client_address)


def _authenticated_session(request: Request, db: DbSession, *, method: str):
    """Validate the existing HttpOnly session and CSRF token for unsafe methods."""

    _require_local_browser_request(request)

    csrf_token = (
        request.headers.get(CSRF_HEADER_NAME)
        if method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
        else None
    )

    try:
        return require_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            method=method.upper(),
            csrf_token=csrf_token,
        )

    except SessionCSRFRejected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF verification failed.",
        ) from None

    except SessionUnavailable:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in again.",
        ) from None


def _require_technician(principal) -> None:
    """Keep reservation decisions exclusive to the Lab Technician role."""

    if principal.role != _TECHNICIAN_ROLE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only laboratory technicians may access this operation.",
        )


def _new_reservation_code() -> str:
    """Generate an opaque, non-sequential public reference code."""

    date_part = datetime.now(timezone.utc).strftime("%Y%m%d")
    return f"LG-{date_part}-{secrets.token_hex(5).upper()}"


def _reservation_item(
    reservation: Reservation,
    *,
    equipment_code: str,
    equipment_name: str,
) -> ReservationItemResponse:
    return ReservationItemResponse(
        id=reservation.id,
        reservation_code=reservation.reservation_code,
        equipment_id=reservation.equipment_id,
        equipment_code=equipment_code,
        equipment_name=equipment_name,
        quantity=reservation.quantity,
        purpose=reservation.purpose,
        reservation_start=reservation.reservation_start,
        reservation_end=reservation.reservation_end,
        status=reservation.status,
        created_at=reservation.created_at,
        updated_at=reservation.updated_at,
    )


def _requester_display_name(user: User) -> str:
    """Build a display name without exposing unrelated account information."""

    parts = (
        user.first_name,
        user.middle_name,
        user.family_name,
        user.name_extension,
    )
    return " ".join(part.strip() for part in parts if part and part.strip())


@router.post(
    "",
    response_model=ReservationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_reservation(
    payload: ReservationCreateRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> ReservationCreatedResponse:
    """Create one pending request after a locked, overlap-aware stock check."""

    principal = _authenticated_session(
        request,
        db,
        method="POST",
    )

    if principal.role not in _ALLOWED_REQUEST_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only students and instructors may submit reservations.",
        )

    try:
        # Serialize all reservation submissions and technician approvals for
        # this equipment item. The same lock order is used by both operations.
        equipment = db.execute(
            select(Equipment)
            .where(
                Equipment.id == payload.equipment_id,
                Equipment.is_active.is_(True),
            )
            .with_for_update()
        ).scalar_one_or_none()

        if equipment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Equipment not found or is no longer active.",
            )

        # Count units that are not damaged, under maintenance, or retired.
        usable_units = db.execute(
            select(func.count(EquipmentUnit.id)).where(
                EquipmentUnit.equipment_id == equipment.id,
                EquipmentUnit.unit_status.in_(
                    (
                        "available",
                        "reserved",
                        "issued",
                        "returned",
                    )
                ),
            )
        ).scalar_one()

        usable_units = int(usable_units or 0)

        # Standard half-open interval overlap:
        # existing.start < requested.end AND existing.end > requested.start.
        overlapping_quantity = db.execute(
            select(
                func.coalesce(
                    func.sum(Reservation.quantity),
                    0,
                )
            ).where(
                Reservation.equipment_id == equipment.id,
                Reservation.status.in_(_BLOCKING_RESERVATION_STATUSES),
                Reservation.reservation_start < payload.reservation_end,
                Reservation.reservation_end > payload.reservation_start,
            )
        ).scalar_one()

        overlapping_quantity = int(overlapping_quantity or 0)

        if usable_units <= 0:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This equipment currently has no reservable units.",
            )

        if overlapping_quantity + payload.quantity > usable_units:
            remaining = max(0, usable_units - overlapping_quantity)

            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "The requested quantity is not available for the "
                    "selected date range. Maximum currently requestable "
                    f"quantity: {remaining}."
                ),
            )

        # New reservation starts as pending.
        # ReservationUnit records are created only after technician approval.
        reservation = Reservation(
            reservation_code=_new_reservation_code(),
            requester_id=principal.user_id,
            equipment_id=equipment.id,
            quantity=payload.quantity,
            purpose=payload.purpose,
            reservation_start=payload.reservation_start,
            reservation_end=payload.reservation_end,
            status="pending",
        )

        db.add(reservation)
        db.flush()

        client_ip = request.client.host if request.client else None

        # Append-only audit event in the same transaction.
        db.add(
            ActivityLog(
                event_type="reservation_created",
                user_id=principal.user_id,
                ip_address=client_ip,
                user_agent=request.headers.get("user-agent", "")[:1000],
                details={
                    "reservation_id": reservation.id,
                    "reservation_code": reservation.reservation_code,
                    "equipment_id": equipment.id,
                    "quantity": payload.quantity,
                    "status": "pending",
                },
            )
        )

        result = ReservationCreatedResponse(
            **_reservation_item(
                reservation,
                equipment_code=equipment.equipment_code,
                equipment_name=equipment.equipment_name,
            ).model_dump(),
            message=(
                "Reservation request submitted and is pending "
                "technician review."
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
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reservation service is temporarily unavailable.",
        ) from None


@router.get(
    "/my",
    response_model=ReservationListResponse,
)
def list_my_reservations(
    request: Request,
    response: Response,
    db: DbSession,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=10, ge=1, le=50),
) -> ReservationListResponse:
    """List only the authenticated user's reservation requests."""

    principal = _authenticated_session(
        request,
        db,
        method="GET",
    )

    base_query = (
        select(
            Reservation,
            Equipment.equipment_code,
            Equipment.equipment_name,
        )
        .join(
            Equipment,
            Equipment.id == Reservation.equipment_id,
        )
        .where(
            Reservation.requester_id == principal.user_id,
        )
    )

    total = db.execute(
        select(func.count()).select_from(
            select(Reservation.id)
            .where(
                Reservation.requester_id == principal.user_id,
            )
            .subquery()
        )
    ).scalar_one()

    rows = db.execute(
        base_query.order_by(
            Reservation.created_at.desc(),
            Reservation.id.desc(),
        )
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()

    items = [
        _reservation_item(
            reservation,
            equipment_code=equipment_code,
            equipment_name=equipment_name,
        )
        for reservation, equipment_code, equipment_name in rows
    ]

    response.headers["Cache-Control"] = "no-store"

    return ReservationListResponse(
        items=items,
        total=int(total),
        page=page,
        page_size=page_size,
        pages=ceil(int(total) / page_size) if total else 0,
    )


@router.get(
    "/pending",
    response_model=PendingReservationListResponse,
)
def list_pending_reservations(
    request: Request,
    response: Response,
    db: DbSession,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=10, ge=1, le=50),
) -> PendingReservationListResponse:
    """Return pending requests to authenticated laboratory technicians only."""

    principal = _authenticated_session(
        request,
        db,
        method="GET",
    )
    _require_technician(principal)

    total = db.execute(
        select(func.count(Reservation.id)).where(
            Reservation.status == "pending"
        )
    ).scalar_one()

    rows = db.execute(
        select(
            Reservation,
            Equipment.equipment_code,
            Equipment.equipment_name,
            User,
        )
        .join(Equipment, Equipment.id == Reservation.equipment_id)
        .join(User, User.id_number == Reservation.requester_id)
        .where(Reservation.status == "pending")
        .order_by(
            Reservation.created_at.asc(),
            Reservation.id.asc(),
        )
        .limit(page_size)
        .offset((page - 1) * page_size)
    ).all()

    items = [
        PendingReservationItemResponse(
            **_reservation_item(
                reservation,
                equipment_code=equipment_code,
                equipment_name=equipment_name,
            ).model_dump(),
            requester_id=requester.id_number,
            requester_name=_requester_display_name(requester),
            requester_username=requester.username,
            requester_department=requester.department,
            requester_class_section_or_unit=requester.class_section_or_unit,
        )
        for reservation, equipment_code, equipment_name, requester in rows
    ]

    response.headers["Cache-Control"] = "no-store"

    return PendingReservationListResponse(
        items=items,
        total=int(total),
        page=page,
        page_size=page_size,
        pages=ceil(int(total) / page_size) if total else 0,
    )


@router.post(
    "/{reservation_id}/decision",
    response_model=ReservationDecisionResponse,
)
def decide_reservation(
    reservation_id: int,
    payload: ReservationDecisionRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> ReservationDecisionResponse:
    """Approve/reject one pending request and allocate physical units on approval."""

    if reservation_id <= 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid reservation ID.",
        )

    principal = _authenticated_session(
        request,
        db,
        method="POST",
    )
    _require_technician(principal)

    client_ip = _require_local_browser_request(request)
    now = datetime.now(timezone.utc)

    try:
        # Lock the request first so two technicians cannot decide it at once.
        reservation = db.execute(
            select(Reservation)
            .where(Reservation.id == reservation_id)
            .with_for_update()
        ).scalar_one_or_none()

        if reservation is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Reservation request not found.",
            )

        if reservation.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This reservation has already been processed.",
            )

        existing_decision = db.execute(
            select(ReservationDecision.id).where(
                ReservationDecision.reservation_id == reservation.id
            )
        ).scalar_one_or_none()

        if existing_decision is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A decision has already been recorded for this request.",
            )

        equipment = None
        allocated_units: list[EquipmentUnit] = []

        if payload.decision == "approved":
            # Use the same equipment lock as request creation. This serializes
            # approval against new requests and other approvals for this item.
            equipment = db.execute(
                select(Equipment)
                .where(Equipment.id == reservation.equipment_id)
                .with_for_update()
            ).scalar_one_or_none()

            if equipment is None or not equipment.is_active:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "This equipment is no longer active and the "
                        "reservation cannot be approved."
                    ),
                )

            # Units already allocated to another overlapping reservation
            # cannot be assigned to this request. Non-overlapping reservations
            # may use the same physical unit at different times.
            conflicting_allocations = (
                select(ReservationUnit.equipment_unit_id)
                .join(
                    Reservation,
                    Reservation.id == ReservationUnit.reservation_id,
                )
                .where(
                    Reservation.id != reservation.id,
                    Reservation.equipment_id == reservation.equipment_id,
                    Reservation.status.in_(_BLOCKING_RESERVATION_STATUSES),
                    ReservationUnit.allocation_status.in_(
                        _ACTIVE_ALLOCATION_STATUSES
                    ),
                    Reservation.reservation_start < reservation.reservation_end,
                    Reservation.reservation_end > reservation.reservation_start,
                )
            )

            allocated_units = db.execute(
                select(EquipmentUnit)
                .where(
                    EquipmentUnit.equipment_id == reservation.equipment_id,
                    EquipmentUnit.unit_status.in_(
                        _ALLOCATABLE_UNIT_STATUSES
                    ),
                    ~EquipmentUnit.id.in_(conflicting_allocations),
                )
                .order_by(EquipmentUnit.id.asc())
                .limit(reservation.quantity)
                .with_for_update()
            ).scalars().all()

            if len(allocated_units) < reservation.quantity:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=(
                        "There are not enough available physical units for "
                        "this reservation period. The request remains pending."
                    ),
                )

            # Create exactly the requested number of unit allocations.
            for unit in allocated_units:
                unit.unit_status = "reserved"
                unit.updated_at = now
                db.add(
                    ReservationUnit(
                        reservation_id=reservation.id,
                        equipment_unit_id=unit.id,
                        allocation_status="reserved",
                    )
                )

            reservation.status = "approved"

        else:
            reservation.status = "rejected"

        reservation.updated_at = now

        decision_record = ReservationDecision(
            reservation_id=reservation.id,
            decided_by=principal.user_id,
            decision=payload.decision,
            remarks=payload.remarks,
        )
        db.add(decision_record)
        db.flush()

        # Audit the decision in the same transaction as the status and
        # allocation changes. The ActivityLog table is append-only by policy.
        db.add(
            ActivityLog(
                event_type=f"reservation_{payload.decision}",
                user_id=principal.user_id,
                ip_address=client_ip,
                user_agent=request.headers.get("user-agent", "")[:1000],
                details={
                    "reservation_id": reservation.id,
                    "reservation_code": reservation.reservation_code,
                    "equipment_id": reservation.equipment_id,
                    "decision": payload.decision,
                    "status": reservation.status,
                    "quantity": reservation.quantity,
                    "allocated_unit_ids": [
                        unit.id for unit in allocated_units
                    ],
                },
            )
        )

        if equipment is None:
            # A rejection does not need an equipment lock, but the referenced
            # equipment row still exists because of the reservation FK.
            equipment = db.execute(
                select(Equipment).where(
                    Equipment.id == reservation.equipment_id
                )
            ).scalar_one()

        result = ReservationDecisionResponse(
            reservation_id=reservation.id,
            reservation_code=reservation.reservation_code,
            equipment_id=reservation.equipment_id,
            equipment_code=equipment.equipment_code,
            equipment_name=equipment.equipment_name,
            decision=payload.decision,
            status=reservation.status,
            remarks=decision_record.remarks,
            decided_at=decision_record.decided_at or now,
            allocated_units=[
                AllocatedUnitResponse(
                    unit_id=unit.id,
                    asset_tag=unit.asset_tag,
                    storage_location=unit.storage_location,
                )
                for unit in allocated_units
            ],
            message=(
                "Reservation approved and physical units allocated."
                if payload.decision == "approved"
                else "Reservation rejected. The decision has been recorded."
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
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reservation decision service is temporarily unavailable.",
        ) from None


# ================================================================
# File 113 — Equipment issuance and check-in for technicians
# ================================================================
# These routes reuse the existing reservations, reservation_units,
# equipment_units and activity_logs tables; no new tables are needed.

class EquipmentReturnRequest(BaseModel):
    """Condition is applied to all units in this simple issue/return flow."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        hide_input_in_errors=True,
    )

    condition: Literal["good", "damaged"] = "good"
    remarks: str | None = Field(default=None, max_length=1000)

    @field_validator("remarks")
    @classmethod
    def clean_return_remarks(cls, value: str | None) -> str | None:
        return value.strip() or None if value is not None else None

    @model_validator(mode="after")
    def require_damage_notes(self) -> "EquipmentReturnRequest":
        if self.condition == "damaged" and (
            self.remarks is None or len(self.remarks) < 5
        ):
            raise ValueError(
                "Describe the damage using at least 5 characters."
            )
        return self


class EquipmentHandoverResponse(BaseModel):
    reservation_id: int
    reservation_code: str
    equipment_name: str
    status: str
    quantity: int
    asset_tags: list[str]
    condition: str | None = None
    message: str


@router.get("/active", response_model=PendingReservationListResponse)
def list_active_reservations(
    request: Request,
    response: Response,
    db: DbSession,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=10, ge=1, le=50),
) -> PendingReservationListResponse:
    """Technician queue for approved bookings awaiting issue or issued items awaiting return."""
    principal = _authenticated_session(request, db, method="GET")
    _require_technician(principal)

    statuses = ("approved", "issued")
    try:
        total = int(db.execute(
            select(func.count(Reservation.id)).where(
                Reservation.status.in_(statuses)
            )
        ).scalar_one() or 0)

        rows = db.execute(
            select(
                Reservation,
                Equipment.equipment_code,
                Equipment.equipment_name,
                User,
            )
            .join(Equipment, Equipment.id == Reservation.equipment_id)
            .join(User, User.id_number == Reservation.requester_id)
            .where(Reservation.status.in_(statuses))
            .order_by(Reservation.created_at.desc(), Reservation.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        ).all()

        items = [
            PendingReservationItemResponse(
                **_reservation_item(
                    reservation,
                    equipment_code=code,
                    equipment_name=name,
                ).model_dump(),
                requester_id=requester.id_number,
                requester_name=_requester_display_name(requester),
                requester_username=requester.username,
                requester_department=requester.department,
                requester_class_section_or_unit=requester.class_section_or_unit,
            )
            for reservation, code, name, requester in rows
        ]

        response.headers["Cache-Control"] = "no-store"
        return PendingReservationListResponse(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=ceil(total / page_size) if total else 0,
        )
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not load approved and issued reservations.",
        ) from None


def _locked_allocation_rows(db: DbSession, reservation_id: int):
    """Read the exact units assigned at approval, locking all rows in stable order."""
    return db.execute(
        select(ReservationUnit, EquipmentUnit)
        .join(
            EquipmentUnit,
            EquipmentUnit.id == ReservationUnit.equipment_unit_id,
        )
        .where(ReservationUnit.reservation_id == reservation_id)
        .order_by(EquipmentUnit.id.asc())
        .with_for_update(of=(ReservationUnit, EquipmentUnit))
    ).all()


@router.post(
    "/{reservation_id}/issue", response_model=EquipmentHandoverResponse
)
def issue_reservation(
    reservation_id: int,
    request: Request,
    response: Response,
    db: DbSession,
) -> EquipmentHandoverResponse:
    """Mark all approved allocated units as physically handed over."""
    principal = _authenticated_session(request, db, method="POST")
    _require_technician(principal)
    if reservation_id <= 0:
        raise HTTPException(status_code=422, detail="Invalid reservation ID.")

    now = datetime.now(timezone.utc)
    try:
        reservation = db.execute(
            select(Reservation)
            .where(Reservation.id == reservation_id)
            .with_for_update()
        ).scalar_one_or_none()
        if reservation is None:
            raise HTTPException(status_code=404, detail="Reservation not found.")
        if reservation.status != "approved":
            raise HTTPException(
                status_code=409,
                detail="Only approved reservations can be issued.",
            )

        # Lock in the same Reservation -> Equipment -> Units order every time.
        equipment = db.execute(
            select(Equipment)
            .where(Equipment.id == reservation.equipment_id)
            .with_for_update()
        ).scalar_one()
        allocation_rows = _locked_allocation_rows(db, reservation_id)
        if len(allocation_rows) != reservation.quantity:
            raise HTTPException(
                status_code=409,
                detail="The allocated unit count does not match this reservation.",
            )
        for allocated, unit in allocation_rows:
            if allocated.allocation_status != "reserved" or unit.unit_status != "reserved":
                raise HTTPException(
                    status_code=409,
                    detail="One or more allocated units are not ready for issue.",
                )

        asset_tags = []
        for allocated, unit in allocation_rows:
            allocated.allocation_status = "issued"
            unit.unit_status = "issued"
            unit.updated_at = now
            asset_tags.append(unit.asset_tag)
        reservation.status = "issued"
        reservation.updated_at = now

        db.add(ActivityLog(
            event_type="reservation_issued",
            user_id=principal.user_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:1000],
            details={
                "reservation_id": reservation.id,
                "reservation_code": reservation.reservation_code,
                "unit_ids": [unit.id for _, unit in allocation_rows],
                "status": "issued",
            },
        ))
        result = EquipmentHandoverResponse(
            reservation_id=reservation.id,
            reservation_code=reservation.reservation_code,
            equipment_name=equipment.equipment_name,
            status="issued",
            quantity=reservation.quantity,
            asset_tags=asset_tags,
            message="Equipment issued successfully.",
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
            detail="Equipment issuance service is temporarily unavailable.",
        ) from None


@router.post(
    "/{reservation_id}/return", response_model=EquipmentHandoverResponse
)
def return_reservation(
    reservation_id: int,
    payload: EquipmentReturnRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> EquipmentHandoverResponse:
    """Check in all issued units and record their condition in the activity log."""
    principal = _authenticated_session(request, db, method="POST")
    _require_technician(principal)
    if reservation_id <= 0:
        raise HTTPException(status_code=422, detail="Invalid reservation ID.")

    now = datetime.now(timezone.utc)
    try:
        reservation = db.execute(
            select(Reservation)
            .where(Reservation.id == reservation_id)
            .with_for_update()
        ).scalar_one_or_none()
        if reservation is None:
            raise HTTPException(status_code=404, detail="Reservation not found.")
        if reservation.status != "issued":
            raise HTTPException(
                status_code=409,
                detail="Only issued reservations can be checked in.",
            )

        equipment = db.execute(
            select(Equipment)
            .where(Equipment.id == reservation.equipment_id)
            .with_for_update()
        ).scalar_one()
        allocation_rows = _locked_allocation_rows(db, reservation_id)
        if len(allocation_rows) != reservation.quantity:
            raise HTTPException(
                status_code=409,
                detail="Issued equipment unit records are incomplete.",
            )
        for allocated, unit in allocation_rows:
            if allocated.allocation_status != "issued" or unit.unit_status != "issued":
                raise HTTPException(
                    status_code=409,
                    detail="One or more units have already been checked in or are inconsistent.",
                )

        asset_tags = []
        for allocated, unit in allocation_rows:
            allocated.allocation_status = "returned"
            unit.unit_status = (
                "damaged" if payload.condition == "damaged" else "available"
            )
            unit.updated_at = now
            asset_tags.append(unit.asset_tag)
        # The PostgreSQL reservation status constraint uses "completed" for
        # a finished return; "returned" is only a unit allocation status.
        reservation.status = "completed"
        reservation.updated_at = now

        db.add(ActivityLog(
            event_type="reservation_returned",
            user_id=principal.user_id,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent", "")[:1000],
            details={
                "reservation_id": reservation.id,
                "reservation_code": reservation.reservation_code,
                "unit_ids": [unit.id for _, unit in allocation_rows],
                "condition": payload.condition,
                "remarks": payload.remarks,
                "unit_status": "damaged" if payload.condition == "damaged" else "available",
                "status": "completed",
            },
        ))
        result = EquipmentHandoverResponse(
            reservation_id=reservation.id,
            reservation_code=reservation.reservation_code,
            equipment_name=equipment.equipment_name,
            # File 114 expects "returned" as the handover action result.
            # The persisted reservation status is "completed" and is exposed
            # by GET /api/reservations/my. Keep the action response compatible.
            status="returned",
            quantity=reservation.quantity,
            asset_tags=asset_tags,
            condition=payload.condition,
            message="Equipment return recorded successfully.",
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
            detail="Equipment return service is temporarily unavailable.",
        ) from None
