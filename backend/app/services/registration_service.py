
"""LabGear Backend Step 54: registration service with parent-first insertion.

INTERNAL SERVICE ONLY. Public registration must remain disabled until OTP
email delivery, resend/rate limiting, verification, and safe HTTP responses
are integrated and tested together.

The user row is flushed BEFORE dependent security answers, password history,
OTP, and audit records. This avoids PostgreSQL foreign-key SQLSTATE 23503
when mapped classes do not expose SQLAlchemy ORM relationships.

The method uses one database transaction, commits on success, and rolls back
on exceptions. Plaintext OTPs are internal delivery data, never API output.
"""

import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.auth_config import AuthSettings, load_auth_settings
from app.core.auth_security import (
    generate_email_otp,
    hash_email_otp,
    hash_password,
    hash_security_answer,
)
from app.models.auth import EmailOTP, PasswordHistory, UserSecurityAnswer
from app.models.security import ActivityLog
from app.models.user import User
from app.schemas.auth import RegistrationRequest
from app.services.captcha_service import verify_registration_captcha


REGISTRATION_OTP_PURPOSE = "register"


class RegistrationRejected(ValueError):
    """Registration was not permitted; avoid exposing internal details."""


class RegistrationConflict(RegistrationRejected):
    """An identifier, username, or email already belongs to an account."""


@dataclass(frozen=True, slots=True)
class PendingRegistration:
    """Trusted internal email-delivery data; never serialize to a browser."""

    user_id: str
    email_address: str
    otp_expires_at: datetime
    otp_code: str = field(repr=False)


@dataclass(slots=True)
class _RegistrationRecords:
    user: User = field(repr=False)
    answers: tuple[UserSecurityAnswer, ...] = field(repr=False)
    password_history: PasswordHistory = field(repr=False)
    otp: EmailOTP = field(repr=False)
    delivery: PendingRegistration = field(repr=False)


def encrypt_contact_number(
    contact_number: str, user_id: str, encryption_key: bytes
) -> tuple[bytes, bytes]:
    """Encrypt with AES-256-GCM; return (ciphertext+tag, unique 12-byte IV)."""
    if not isinstance(encryption_key, bytes) or len(encryption_key) != 32:
        raise ValueError("Contact encryption requires a separate 32-byte AES key.")
    if not isinstance(contact_number, str) or not contact_number.strip():
        raise ValueError("Contact number must not be empty.")
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(encryption_key).encrypt(
        nonce, contact_number.encode("utf-8"), user_id.encode("utf-8")
    )
    return ciphertext, nonce


def _verify_registration_gate(payload: RegistrationRequest) -> None:
    """Validate public registration restrictions and verify CAPTCHA once."""
    if not isinstance(payload, RegistrationRequest):
        raise TypeError("A validated RegistrationRequest is required.")
    if payload.role not in ("student", "instructor"):
        raise RegistrationRejected("Self-registration role is not allowed.")
    if payload.website.strip():
        raise RegistrationRejected("Registration request rejected.")
    if payload.privacy_consent is not True:
        raise RegistrationRejected("Privacy consent is required.")
    # Google CAPTCHA tokens can be verified only once. No bypass is available
    # to actual service callers; tests may mock network verification locally.
    if verify_registration_captcha(payload.captcha_token) is not True:
        raise RegistrationRejected("Registration verification failed.")


def _prepare_records(
    payload: RegistrationRequest, *, settings: AuthSettings
) -> _RegistrationRecords:
    """Prepare mapped objects in memory; does not execute SQL statements."""
    if not isinstance(payload, RegistrationRequest):
        raise TypeError("A validated RegistrationRequest is required.")
    if payload.role not in ("student", "instructor"):
        raise RegistrationRejected("Self-registration role is not allowed.")
    if payload.website.strip():
        raise RegistrationRejected("Registration request rejected.")
    if payload.privacy_consent is not True:
        raise RegistrationRejected("Privacy consent is required.")

    now = datetime.now(timezone.utc)
    encrypted_contact, iv = encrypt_contact_number(
        payload.contact_number, payload.id_number, settings.contact_aes_key
    )
    password_digest = hash_password(payload.password)
    otp_code = generate_email_otp()
    expiry = now + timedelta(seconds=settings.otp_expiry_seconds)
    otp_digest = hash_email_otp(
        otp_code,
        payload.id_number,
        REGISTRATION_OTP_PURPOSE,
        settings.otp_hmac_key,
    )

    user = User(
        id_number=payload.id_number,
        first_name=payload.first_name,
        middle_name=payload.middle_name,
        family_name=payload.family_name,
        name_extension=payload.name_extension,
        birthdate=payload.birthdate,
        purok_street=payload.purok_street,
        barangay=payload.barangay,
        municipality_city=payload.municipality_city,
        province=payload.province,
        country=payload.country,
        zip_code=payload.zip_code,
        email=str(payload.email).strip().lower(),
        username=payload.username,
        password_hash=password_digest,
        role=payload.role,
        department=payload.department,
        contact_number_encrypted=encrypted_contact,
        contact_number_iv=iv,
        class_section_or_unit=payload.class_section_or_unit,
        is_email_verified=False,
        account_status="inactive",
        failed_login_attempts=0,
        privacy_consent_at=now,
    )
    answers = tuple(
        UserSecurityAnswer(
            user_id=payload.id_number,
            question_code=code,
            answer_hash=hash_security_answer(answer),
        )
        for code, answer in (
            ("Q7", payload.security_answer_q7),
            ("Q2", payload.security_answer_q2),
            ("Q4", payload.security_answer_q4),
        )
    )
    history = PasswordHistory(
        user_id=payload.id_number, password_hash=password_digest
    )
    otp = EmailOTP(
        user_id=payload.id_number,
        purpose=REGISTRATION_OTP_PURPOSE,
        otp_hash=otp_digest,
        expires_at=expiry,
        failed_attempts=0,
        is_resend=False,
    )
    delivery = PendingRegistration(
        user_id=payload.id_number,
        email_address=str(payload.email).strip().lower(),
        otp_expires_at=expiry,
        otp_code=otp_code,
    )
    return _RegistrationRecords(user, answers, history, otp, delivery)


def register_pending_user(db: Session, payload: RegistrationRequest) -> PendingRegistration:
    """Create pending registration atomically after real server-side CAPTCHA.

    Not a FastAPI route. Requires an unused request Session and owns its
    transaction. The caller must not enable this publicly until OTP email
    delivery, verification, abuse limits, and error handling are integrated.
    """
    if not isinstance(db, Session):
        raise TypeError("A SQLAlchemy Session is required.")
    if not isinstance(payload, RegistrationRequest):
        raise TypeError("A validated RegistrationRequest is required.")
    if db.in_transaction():
        raise RuntimeError("Use an unused request database session for registration.")

    _verify_registration_gate(payload)
    settings = load_auth_settings()
    records = _prepare_records(payload, settings=settings)

    try:
        with db.begin():
            existing = db.execute(
                select(User.id_number)
                .where(
                    or_(
                        User.id_number == payload.id_number,
                        func.lower(User.email) == str(payload.email).lower(),
                        func.lower(User.username) == payload.username.lower(),
                    )
                )
                .limit(1)
            ).first()
            if existing is not None:
                raise RegistrationConflict("An account already exists.")

            # CRITICAL: parent User must exist in this transaction before
            # INSERTing FK-dependent rows when ORM relationships aren't mapped.
            db.add(records.user)
            db.flush()

            db.add_all(records.answers)
            db.add(records.password_history)
            db.add(records.otp)
            db.add(
                ActivityLog(
                    event_type="registration_pending",
                    user_id=payload.id_number,
                    details={"role": payload.role},
                )
            )
            db.flush()
    except IntegrityError as exc:
        # Uniqueness races are expected; unrelated constraints must be fixed,
        # not silently mislabeled as a duplicate-account conflict.
        if getattr(getattr(exc, "orig", None), "sqlstate", None) == "23505":
            raise RegistrationConflict("An account could not be registered.") from None
        raise

    return records.delivery
