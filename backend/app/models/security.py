
"""SQLAlchemy models for LabGear's existing security-monitoring tables.

Maps tables already created by database/003_create_security_tables.sql.
No migrations or table creation are performed by importing this module.
"""

from datetime import date, datetime
from ipaddress import IPv4Address, IPv4Interface, IPv6Address, IPv6Interface
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import INET, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


IPAddress = str | IPv4Address | IPv6Address | IPv4Interface | IPv6Interface


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    event_type: Mapped[str] = mapped_column(String(50), nullable=False)
    username_typed: Mapped[str | None] = mapped_column(Text, nullable=True)
    user_id: Mapped[str | None] = mapped_column(
        String(9), ForeignKey("users.id_number", ondelete="SET NULL"), nullable=True
    )
    ip_address: Mapped[IPAddress | None] = mapped_column(INET, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class IPBlock(Base):
    __tablename__ = "ip_blocks"
    __table_args__ = (
        CheckConstraint("failure_count >= 0", name="valid_failure_count"),
        CheckConstraint("blocked_until > blocked_at", name="valid_block_duration"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    ip_address: Mapped[IPAddress] = mapped_column(INET, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), nullable=False)
    failure_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    blocked_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    blocked_until: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )


class SecurityFlag(Base):
    __tablename__ = "security_flags"
    __table_args__ = (
        CheckConstraint(
            "pattern_type IN ('IP_OVER_THRESHOLD', 'ACCOUNT_TARGETED', "
            "'OTP_GUESSING', 'OFF_HOURS_LOGIN')",
            name="valid_security_pattern",
        ),
        CheckConstraint(
            "severity IN ('LOW', 'MEDIUM', 'HIGH')",
            name="valid_flag_severity",
        ),
        UniqueConstraint(
            "pattern_type", "target_value", "flag_date",
            name="unique_daily_security_flag",
        ),
    )

    id: Mapped[int] = mapped_column(
        BigInteger, Identity(always=True), primary_key=True
    )
    pattern_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_value: Mapped[str] = mapped_column(String(255), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    flag_date: Mapped[date] = mapped_column(
        Date, nullable=False,
        server_default=text("((NOW() AT TIME ZONE 'Asia/Manila')::date)"),
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
