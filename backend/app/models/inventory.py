"""SQLAlchemy mappings for LabGear's existing inventory schema.

The three ORM classes describe existing PostgreSQL tables. The stock
summary is a PostgreSQL VIEW, represented as a read-only query target in
separate metadata so ``Base.metadata.create_all`` never treats it as a table.

This module does not create or alter database objects.
"""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    MetaData,
    String,
    Table,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class EquipmentCategory(Base):
    __tablename__ = "equipment_categories"

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    category_name: Mapped[str] = mapped_column(
        String(80), nullable=False
    )
    description: Mapped[str | None] = mapped_column(
        Text, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


# PostgreSQL enforces case-insensitive category-name uniqueness.
Index(
    "idx_category_name",
    func.lower(EquipmentCategory.__table__.c.category_name),
    unique=True,
)


class Equipment(Base):
    __tablename__ = "equipment"

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    category_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "equipment_categories.id",
            name="fk_equipment_category",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    equipment_code: Mapped[str] = mapped_column(
        String(30), nullable=False, unique=True
    )
    equipment_name: Mapped[str] = mapped_column(
        String(120), nullable=False
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    manufacturer: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    model_number: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


Index("idx_equipment_category", Equipment.__table__.c.category_id)
Index("idx_equipment_name", Equipment.__table__.c.equipment_name)


class EquipmentUnit(Base):
    __tablename__ = "equipment_units"
    __table_args__ = (
        CheckConstraint(
            "unit_status IN ('available', 'reserved', 'issued', "
            "'returned', 'damaged', 'maintenance', 'retired')",
            name="valid_unit_status",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    equipment_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey(
            "equipment.id",
            name="fk_equipment_unit",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    asset_tag: Mapped[str] = mapped_column(
        String(50), nullable=False, unique=True
    )
    serial_number: Mapped[str | None] = mapped_column(
        String(100), nullable=True, unique=True
    )
    storage_location: Mapped[str | None] = mapped_column(
        String(100), nullable=True
    )
    unit_status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default=text("'available'")
    )
    acquired_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


Index("idx_equipment_units_equipment", EquipmentUnit.__table__.c.equipment_id)
Index("idx_equipment_units_status", EquipmentUnit.__table__.c.unit_status)


# The stock summary is a PostgreSQL VIEW, not a writable inventory table.
# Its metadata is intentionally separate from the application's Base.
_inventory_view_metadata = MetaData()

equipment_stock_summary = Table(
    "equipment_stock_summary",
    _inventory_view_metadata,
    Column("equipment_id", BigInteger, primary_key=True),
    Column("equipment_code", String(30)),
    Column("equipment_name", String(120)),
    Column("category_name", String(80)),
    Column("total_units", BigInteger),
    Column("available_units", BigInteger),
    Column("reserved_units", BigInteger),
    Column("issued_units", BigInteger),
    Column("damaged_units", BigInteger),
    Column("maintenance_units", BigInteger),
    schema="public",
)
