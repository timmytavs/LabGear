
"""LabGear SQLAlchemy mappings for existing reservation/transaction tables.

These models correspond to database/005_create_reservation_tables.sql.
Importing this module does not create tables or modify PostgreSQL data.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Reservation(Base):
    __tablename__ = "reservations"
    __table_args__ = (
        CheckConstraint(
            "quantity BETWEEN 1 AND 50",
            name="valid_reservation_quantity",
        ),
        CheckConstraint(
            "reservation_end > reservation_start",
            name="valid_reservation_dates",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', "
            "'cancelled', 'partially_issued', 'issued', 'completed')",
            name="valid_reservation_status",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    reservation_code: Mapped[str] = mapped_column(
        String(30), unique=True, nullable=False
    )
    requester_id: Mapped[str] = mapped_column(
        String(9),
        ForeignKey(
            "users.id_number",
            name="fk_reservation_requester",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    equipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "equipment.id",
            name="fk_reservation_equipment",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    purpose: Mapped[str] = mapped_column(
        Text, nullable=False
    )
    reservation_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    reservation_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(25),
        nullable=False,
        server_default=text("'pending'"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


Index(
    "idx_reservations_requester",
    Reservation.__table__.c.requester_id,
)
Index(
    "idx_reservations_equipment_dates",
    Reservation.__table__.c.equipment_id,
    Reservation.__table__.c.reservation_start,
    Reservation.__table__.c.reservation_end,
)
Index(
    "idx_reservations_status",
    Reservation.__table__.c.status,
)


class ReservationDecision(Base):
    __tablename__ = "reservation_decisions"
    __table_args__ = (
        CheckConstraint(
            "decision IN ('approved', 'rejected')",
            name="valid_reservation_decision",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    reservation_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "reservations.id",
            name="fk_decision_reservation",
            ondelete="RESTRICT",
        ),
        unique=True,
        nullable=False,
    )
    decided_by: Mapped[str] = mapped_column(
        String(9),
        ForeignKey(
            "users.id_number",
            name="fk_decision_technician",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    decision: Mapped[str] = mapped_column(
        String(15), nullable=False
    )
    remarks: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    decided_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


class ReservationUnit(Base):
    __tablename__ = "reservation_units"
    __table_args__ = (
        UniqueConstraint(
            "reservation_id",
            "equipment_unit_id",
            name="unique_reservation_unit",
        ),
        CheckConstraint(
            "allocation_status IN ('reserved', 'issued', "
            "'returned', 'cancelled')",
            name="valid_allocation_status",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    reservation_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "reservations.id",
            name="fk_allocation_reservation",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    equipment_unit_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "equipment_units.id",
            name="fk_allocation_unit",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    allocation_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'reserved'"),
    )
    allocated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )


Index(
    "idx_allocation_unit",
    ReservationUnit.__table__.c.equipment_unit_id,
)


class EquipmentIssuance(Base):
    __tablename__ = "equipment_issuances"
    __table_args__ = (
        CheckConstraint(
            "condition_on_issue IN ('good', 'fair', 'worn')",
            name="valid_issue_condition",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    reservation_unit_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "reservation_units.id",
            name="fk_issuance_allocation",
            ondelete="RESTRICT",
        ),
        unique=True,
        nullable=False,
    )
    issued_by: Mapped[str] = mapped_column(
        String(9),
        ForeignKey(
            "users.id_number",
            name="fk_issuance_technician",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    due_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    condition_on_issue: Mapped[str] = mapped_column(
        String(20), nullable=False
    )
    issuance_notes: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )


Index(
    "idx_issuance_due",
    EquipmentIssuance.__table__.c.due_at,
)


class EquipmentReturn(Base):
    __tablename__ = "equipment_returns"
    __table_args__ = (
        CheckConstraint(
            "return_condition IN "
            "('good', 'damaged', 'needs_maintenance')",
            name="valid_return_condition",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    issuance_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "equipment_issuances.id",
            name="fk_return_issuance",
            ondelete="RESTRICT",
        ),
        unique=True,
        nullable=False,
    )
    received_by: Mapped[str] = mapped_column(
        String(9),
        ForeignKey(
            "users.id_number",
            name="fk_return_technician",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    returned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    return_condition: Mapped[str] = mapped_column(
        String(25), nullable=False
    )
    return_notes: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )


class DamageReport(Base):
    __tablename__ = "damage_reports"
    __table_args__ = (
        CheckConstraint(
            "severity IN ('minor', 'moderate', 'severe')",
            name="valid_damage_severity",
        ),
        CheckConstraint(
            "resolution_status IN "
            "('open', 'in_review', 'resolved')",
            name="valid_damage_resolution",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    return_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "equipment_returns.id",
            name="fk_damage_return",
            ondelete="RESTRICT",
        ),
        unique=True,
        nullable=False,
    )
    reported_by: Mapped[str] = mapped_column(
        String(9),
        ForeignKey(
            "users.id_number",
            name="fk_damage_reporter",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    damage_description: Mapped[str] = mapped_column(
        Text, nullable=False
    )
    severity: Mapped[str] = mapped_column(
        String(20), nullable=False
    )
    resolution_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        server_default=text("'open'"),
    )
    reported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    resolved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolution_notes: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )


Index(
    "idx_damage_status",
    DamageReport.__table__.c.resolution_status,
)
