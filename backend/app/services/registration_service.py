
"""LabGear Backend File 140: registration service with selectable questions.

Supports the existing fixed Q7/Q2/Q4 registration fields and a future
security_questions collection (three distinct Q1-Q8 question/answer pairs).
The current API schema still sends fixed fields; schema/route/frontend changes
are required before users can choose questions in the interface.

The user row is flushed BEFORE dependent security answers, password history,
OTP, and audit records. This avoids PostgreSQL foreign-key SQLSTATE 23503
when mapped classes do not expose SQLAlchemy ORM relationships.

The method uses one database transaction, commits on success, and rolls back
on exceptions. Plaintext OTPs are internal delivery data, never API output.
"""

import re
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
SECURITY_QUESTION_CODES = frozenset(f"Q{i}" for i in range(1, 9))
SECURITY_ANSWER_PATTERN = re.compile(r"[A-Za-z]+(?: [A-Za-z]+)*\Z")


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


def _security_question_pairs(
    payload: RegistrationRequest, *, settings: AuthSettings
) -> tuple[tuple[str, str], ...]:
    """Validate three unique bank questions without exposing plaintext answers.

    Accept the existing fields until the other registration/recovery files are
    updated. A future schema may supply ``security_questions`` as a list of
    objects with ``question_code`` and ``answer`` attributes (or dictionaries).
    Exactly one representation is allowed, so the server cannot silently
    ignore supplied selections or mix new and legacy answers.
    """
    selected = getattr(payload, "security_questions", None)
    legacy_fields = (
        "security_answer_q7", "security_answer_q2", "security_answer_q4"
    )

    if selected is None:
        entries = (
            ("Q7", getattr(payload, "security_answer_q7", None)),
            ("Q2", getattr(payload, "security_answer_q2", None)),
            ("Q4", getattr(payload, "security_answer_q4", None)),
        )
    else:
        if any(getattr(payload, name, None) is not None for name in legacy_fields):
            raise RegistrationRejected("Choose one security-question format.")
        if not isinstance(selected, (list, tuple)):
            raise RegistrationRejected("Select three security questions.")
        entries = tuple(
            (
                item.get("question_code") if isinstance(item, dict)
                else getattr(item, "question_code", None),
                item.get("answer") if isinstance(item, dict)
                else getattr(item, "answer", None),
            )
            for item in selected
        )

    if len(entries) != settings.security_questions_required:
        raise RegistrationRejected("Select three different security questions.")

    codes: set[str] = set()
    for code, answer in entries:
        if not isinstance(code, str) or code not in SECURITY_QUESTION_CODES:
            raise RegistrationRejected("Invalid security question selection.")
        if code in codes:
            raise RegistrationRejected("Security questions must be different.")
        codes.add(code)
        if (
            not isinstance(answer, str)
            or not 2 <= len(answer) <= 50
            or SECURITY_ANSWER_PATTERN.fullmatch(answer) is None
        ):
            raise RegistrationRejected("Invalid security question answer.")

    return entries


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
        for code, answer in _security_question_pairs(payload, settings=settings)
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
    transaction. Existing API protections (CAPTCHA, CSRF, rate limits, OTP
    verification, and safe HTTP errors) remain the router's responsibility.
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
