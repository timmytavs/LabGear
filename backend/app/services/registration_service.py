
"""LabGear Step 41: registration service foundation (NOT an API route).

Builds and atomically stores an inactive, unverified user, hashed Q7/Q2/Q4
security answers, initial password history, and a hashed registration OTP.

This is intentionally NOT mounted in FastAPI. Production use requires a real
CAPTCHA verifier, a separately configured AES-256 contact-encryption key, an
email delivery flow, rate limiting, and OTP verification before activation.
Never return the plaintext OTP or this service's internal result to a browser.
"""

import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

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


class RegistrationRejected(ValueError):
    """Registration was not permitted. Do not expose internal details."""


class RegistrationConflict(RegistrationRejected):
    """A user already exists with one of the supplied identifiers."""


@dataclass(frozen=True, slots=True)
class PendingRegistration:
    """Trusted internal delivery information; NEVER use as an HTTP response."""

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
    """Encrypt with AES-256-GCM; return (ciphertext+tag, unique 12-byte IV).

    Use a separate, persistent key from the future encrypted configuration;
    DO NOT reuse the JWT signing key or the email OTP HMAC key.
    """
    if not isinstance(encryption_key, bytes) or len(encryption_key) != 32:
        raise ValueError("Contact encryption requires a separate 32-byte AES key.")
    if not isinstance(contact_number, str) or not contact_number.strip():
        raise ValueError("Contact number must not be empty.")
    nonce = secrets.token_bytes(12)
    ciphertext = AESGCM(encryption_key).encrypt(
        nonce, contact_number.encode("utf-8"), user_id.encode("utf-8")
    )
    return ciphertext, nonce


def _prepare_records(
    payload: RegistrationRequest,
    *,
    encryption_key: bytes,
    otp_hmac_key: bytes,
) -> _RegistrationRecords:
    """Build mapped objects in memory only; does not write to PostgreSQL."""
    if payload.role not in ("student", "instructor"):
        raise RegistrationRejected("Self-registration role is not allowed.")
    if payload.website.strip():
        raise RegistrationRejected("Registration request rejected.")
    if not payload.privacy_consent:
        raise RegistrationRejected("Privacy consent is required.")

    now = datetime.now(timezone.utc)
    encrypted_contact, iv = encrypt_contact_number(
        payload.contact_number, payload.id_number, encryption_key
    )
    password_digest = hash_password(payload.password)
    otp_code = generate_email_otp()
    expiry = now + timedelta(minutes=3)
    otp_digest = hash_email_otp(
        otp_code, payload.id_number, "registration", otp_hmac_key
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
        purpose="registration",
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


def register_pending_user(
    db: Session,
    payload: RegistrationRequest,
    *,
    verify_captcha: Callable[[str], bool],
    encryption_key: bytes,
    otp_hmac_key: bytes,
) -> PendingRegistration:
    """Persist a pending registration atomically after real CAPTCHA verification.

    The caller MUST provide a real server-side CAPTCHA verification function.
    There is deliberately no bypass or development mode. Do not call until
    email delivery, cooldown/rate limits, and OTP verification are integrated.
    Use a fresh, exclusive SQLAlchemy session; this function owns its commit.
    """
    if not isinstance(payload, RegistrationRequest):
        raise TypeError("A validated RegistrationRequest is required.")
    if not callable(verify_captcha):
        raise TypeError("A server-side CAPTCHA verification function is required.")
    if db.in_transaction():
        raise RuntimeError("Use an unused request database session for registration.")
    if payload.website.strip():
        raise RegistrationRejected("Registration request rejected.")
    # Require an actual boolean True, not a truthy placeholder or coroutine.
    if verify_captcha(payload.captcha_token) is not True:
        raise RegistrationRejected("Registration verification failed.")

    records = _prepare_records(
        payload, encryption_key=encryption_key, otp_hmac_key=otp_hmac_key
    )
    try:
        with db.begin():
            existing = db.execute(
                select(User.id_number).where(
                    or_(
                        User.id_number == payload.id_number,
                        func.lower(User.email) == str(payload.email).lower(),
                        func.lower(User.username) == payload.username.lower(),
                    )
                ).limit(1)
            ).first()
            if existing is not None:
                raise RegistrationConflict("An account already exists.")

            db.add(records.user)
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
    except IntegrityError:
        # PostgreSQL's uniqueness constraints also protect concurrent requests.
        raise RegistrationConflict("An account could not be registered.") from None

    return records.delivery
