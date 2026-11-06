
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Integer,
    LargeBinary,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class User(Base):
    __tablename__ = "users"

    # Primary key
    id_number: Mapped[str] = mapped_column(
        String(9),
        primary_key=True
    )

    # Personal information
    first_name: Mapped[str] = mapped_column(String(26))
    middle_name: Mapped[str | None] = mapped_column(String(26))
    family_name: Mapped[str] = mapped_column(String(26))
    name_extension: Mapped[str | None] = mapped_column(String(26))

    birthdate: Mapped[date] = mapped_column(Date)

    # Address
    purok_street: Mapped[str] = mapped_column(String(50))
    barangay: Mapped[str] = mapped_column(String(50))
    municipality_city: Mapped[str] = mapped_column(String(50))
    province: Mapped[str] = mapped_column(String(50))
    country: Mapped[str] = mapped_column(String(50))
    zip_code: Mapped[str] = mapped_column(String(4))

    # Credentials
    email: Mapped[str] = mapped_column(
        String(100),
        unique=True
    )
    username: Mapped[str] = mapped_column(String(17))
    password_hash: Mapped[str] = mapped_column(Text)

    # LabGear-specific fields
    role: Mapped[str] = mapped_column(
        String(20),
        server_default=text("'student'")
    )
    department: Mapped[str] = mapped_column(String(80))

    contact_number_encrypted: Mapped[bytes] = mapped_column(
        LargeBinary
    )
    contact_number_iv: Mapped[bytes] = mapped_column(
        LargeBinary
    )

    class_section_or_unit: Mapped[str] = mapped_column(
        String(100)
    )

    # Account verification
    is_email_verified: Mapped[bool] = mapped_column(
        Boolean,
        server_default=text("false")
    )
    account_status: Mapped[str] = mapped_column(
        String(20),
        server_default=text("'active'")
    )

    # Authentication security
    failed_login_attempts: Mapped[int] = mapped_column(
        Integer,
        server_default=text("0")
    )
    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True)
    )

    # Privacy consent
    privacy_consent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True)
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
