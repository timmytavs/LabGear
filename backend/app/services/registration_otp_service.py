
"""LabGear Backend Step 52: transaction-safe registration OTP verification.

INTERNAL SERVICE ONLY; no HTTP endpoint is registered by this module.

For the existing PostgreSQL schema:
  users.id_number, users.role, users.account_status, users.is_email_verified
  email_otps.user_id, purpose, otp_hash, failed_attempts, expires_at,
             created_at, used_at, revoked_at, id
  activity_logs.event_type, user_id, details

A verified six-digit registration OTP activates an eligible pending account.
The latest registration OTP is the only one accepted. Every valid-format
incorrect guess is counted, including the third, which revokes the OTP.
All account/OTP modifications and audit records use one DB transaction.

This is NOT safe to expose as a public route until initial OTP delivery,
resending/revocation, IP/account abuse limits, and HTTP error handling are
integrated. Callers must never expose detailed results to unauthenticated
clients or log submitted OTP codes.
"""

import re
from datetime import datetime, timedelta, timezone
from enum import Enum

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.auth_config import AuthSettings, load_auth_settings
from app.core.auth_security import verify_email_otp
from app.models.auth import EmailOTP
from app.models.security import ActivityLog
from app.models.user import User
from app.services.registration_service import REGISTRATION_OTP_PURPOSE


class RegistrationOtpResult(str, Enum):
    """Internal outcomes. Public APIs must use uniform failure responses."""

    VERIFIED = "verified"
    INVALID = "invalid"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"
    UNAVAILABLE = "unavailable"


def _valid_user_id(user_id: object) -> bool:
    return isinstance(user_id, str) and re.fullmatch(r"[0-9]{4}-[0-9]{4}", user_id) is not None


def _valid_otp(otp_code: object) -> bool:
    return isinstance(otp_code, str) and re.fullmatch(r"[0-9]{6}", otp_code) is not None


def _utc(value: datetime | None) -> datetime | None:
    """Require timezone-aware database timestamps, avoiding ambiguous clocks."""
    if value is None:
        return None
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise RuntimeError("OTP timestamp must be timezone-aware.")
    return value.astimezone(timezone.utc)


def _otp_state(
    otp_record: EmailOTP,
    *,
    now: datetime,
    max_failed_attempts: int,
    expiry_seconds: int,
) -> RegistrationOtpResult | None:
    """Pure lifecycle check. None means the code may be compared."""
    if (
        otp_record.purpose != REGISTRATION_OTP_PURPOSE
        or otp_record.used_at is not None
        or otp_record.revoked_at is not None
    ):
        return RegistrationOtpResult.UNAVAILABLE
    if otp_record.failed_attempts >= max_failed_attempts:
        return RegistrationOtpResult.EXHAUSTED

    created_at = _utc(otp_record.created_at)
    expires_at = _utc(otp_record.expires_at)
    checked_at = _utc(now)
    if created_at is None or expires_at is None or checked_at is None:
        raise RuntimeError("OTP timestamps are required.")
    if (
        checked_at >= expires_at
        or checked_at >= created_at + timedelta(seconds=expiry_seconds)
        or expires_at <= created_at
        or created_at > checked_at + timedelta(seconds=30)
    ):
        return RegistrationOtpResult.EXPIRED
    return None


def verify_pending_registration_otp(
    db: Session,
    *,
    user_id: str,
    otp_code: str,
) -> RegistrationOtpResult:
    """Verify and consume the latest registration OTP, activating its user.

    Requires a new/unused SQLAlchemy Session; owns its transaction/commit.
    Locks the user row first, then the latest registration OTP row. Any future
    OTP-issuing service MUST also lock the user row and revoke earlier OTPs to
    make issuance/verification concurrency-safe.

    Only student/instructor accounts with inactive status and an unverified
    email are eligible. No sessions/tokens are issued here.
    """
    if not isinstance(db, Session):
        raise TypeError("A SQLAlchemy Session is required.")
    if db.in_transaction():
        raise RuntimeError("Use an unused request database session for OTP verification.")
    if not _valid_user_id(user_id) or not _valid_otp(otp_code):
        return RegistrationOtpResult.INVALID

    settings: AuthSettings = load_auth_settings()

    with db.begin():
        # All concurrent verification attempts for this user serialize here.
        user = db.execute(
            select(User)
            .where(User.id_number == user_id)
            .with_for_update()
        ).scalar_one_or_none()

        if user is None or user.role not in ("student", "instructor"):
            return RegistrationOtpResult.UNAVAILABLE
        if user.is_email_verified is not False or user.account_status != "inactive":
            return RegistrationOtpResult.UNAVAILABLE

        # Do NOT filter out used/revoked OTPs before sorting: otherwise an
        # older code could become valid after the newest code is consumed.
        otp = db.execute(
            select(EmailOTP)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == REGISTRATION_OTP_PURPOSE,
            )
            .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
            .limit(1)
            .with_for_update()
        ).scalar_one_or_none()

        if otp is None:
            return RegistrationOtpResult.UNAVAILABLE

        now = datetime.now(timezone.utc)
        state = _otp_state(
            otp,
            now=now,
            max_failed_attempts=settings.otp_max_failed_attempts,
            expiry_seconds=settings.otp_expiry_seconds,
        )
        if state is not None:
            return state

        valid = verify_email_otp(
            otp_code,
            otp.otp_hash,
            user_id,
            REGISTRATION_OTP_PURPOSE,
            settings.otp_hmac_key,
        )
        if not valid:
            otp.failed_attempts += 1
            exhausted = otp.failed_attempts >= settings.otp_max_failed_attempts
            if exhausted:
                otp.revoked_at = now
            db.add(ActivityLog(
                event_type="registration_otp_failed",
                user_id=user_id,
                details={"attempt": otp.failed_attempts, "exhausted": exhausted},
            ))
            return (RegistrationOtpResult.EXHAUSTED if exhausted
                    else RegistrationOtpResult.INVALID)

        # Consume the code and activate the eligible account in one commit.
        otp.used_at = now
        user.is_email_verified = True
        user.account_status = "active"

        # Revoke other outstanding registration codes for this account.
        db.execute(
            update(EmailOTP)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == REGISTRATION_OTP_PURPOSE,
                EmailOTP.id != otp.id,
                EmailOTP.used_at.is_(None),
                EmailOTP.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        db.add(ActivityLog(
            event_type="registration_otp_verified",
            user_id=user_id,
            details={"verification": "registration_email"},
        ))
        return RegistrationOtpResult.VERIFIED
