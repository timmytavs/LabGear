
"""LabGear Backend Step 55: internal registration OTP resend service.

Not a public FastAPI endpoint. Do not expose this function to browser traffic
until a trusted coordinator handles CAPTCHA/rate-limiting, safe responses,
and SMTP delivery failures. It generates and persists a new OTP but does NOT
send email. The returned PendingRegistration is backend-only secret material.

Enforces a 60-second cooldown and at most 3 resends in any rolling 15 minutes.
The user row is locked first (matching registration OTP verification) so
concurrent resend/verification requests cannot issue/consume conflicting codes.
Earlier unconsumed registration OTPs are revoked in the same transaction that
inserts the replacement OTP and records a security audit event.
"""

import math
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.auth_config import AuthSettings, load_auth_settings
from app.core.auth_security import generate_email_otp, hash_email_otp
from app.models.auth import EmailOTP
from app.models.security import ActivityLog
from app.models.user import User
from app.services.registration_service import (
    PendingRegistration,
    REGISTRATION_OTP_PURPOSE,
)

RESEND_WINDOW_SECONDS = 15 * 60


class RegistrationResendUnavailable(ValueError):
    """No eligible pending registration; never expose details publicly."""


class RegistrationResendLimited(ValueError):
    """Internal rate-limit decision; do not expose account existence publicly."""

    def __init__(self, retry_after_seconds: int):
        self.retry_after_seconds = max(1, int(retry_after_seconds))
        super().__init__("Registration OTP resend temporarily unavailable.")


def _utc(value: datetime) -> datetime:
    """Reject naive timestamps rather than silently misinterpreting them."""
    if not isinstance(value, datetime) or value.tzinfo is None:
        raise RuntimeError("OTP timestamp must be timezone-aware.")
    if value.utcoffset() is None:
        raise RuntimeError("OTP timestamp must be timezone-aware.")
    return value.astimezone(timezone.utc)


def _resend_retry_seconds(
    *,
    latest_created_at: datetime,
    resend_created_at: list[datetime],
    now: datetime,
    settings: AuthSettings,
) -> int:
    """Pure policy checker. Return zero when eligible, else seconds to retry.

    The caller retrieves ALL resends in the rolling window, including already
    expired or revoked ones. Revoking a code does not reset the resend quota.
    """
    checked = _utc(now)
    latest = _utc(latest_created_at)

    # A future database timestamp can reflect clock skew or bad records.
    # Fail closed until server clocks/records are corrected.
    if latest > checked:
        return max(1, math.ceil((latest - checked).total_seconds()))

    cooldown_end = latest + timedelta(
        seconds=settings.otp_resend_cooldown_seconds
    )
    cooldown_wait = max(
        0, math.ceil((cooldown_end - checked).total_seconds())
    )

    cutoff = checked - timedelta(seconds=RESEND_WINDOW_SECONDS)
    recent = sorted(
        (
            _utc(created)
            for created in resend_created_at
            if cutoff <= _utc(created) <= checked
        )
    )

    quota_wait = 0
    if len(recent) >= settings.otp_max_resends_in_15_minutes:
        # The Nth most recent resend must leave the rolling window
        # before another resend is allowed.
        blocking = recent[-settings.otp_max_resends_in_15_minutes]
        quota_wait = max(
            1,
            math.ceil(
                (
                    blocking
                    + timedelta(seconds=RESEND_WINDOW_SECONDS)
                    - checked
                ).total_seconds()
            ),
        )

    return max(cooldown_wait, quota_wait)


def issue_registration_otp_resend(
    db: Session, *, user_id: str
) -> PendingRegistration:
    """Persist one replacement code for an eligible, pending registration.

    Requires a fresh SQLAlchemy Session and owns its transaction/commit.
    Returns an internal delivery object containing the raw OTP; do not send
    it to the frontend or log it. SMTP delivery is intentionally separate.

    Caller must handle delayed/failed delivery without bypassing quotas.
    This service must not be mounted until a full safe coordinator is ready.
    """
    if not isinstance(db, Session):
        raise TypeError("A SQLAlchemy Session is required.")
    if db.in_transaction():
        raise RuntimeError("Use an unused database session for OTP resend.")

    if (
        not isinstance(user_id, str)
        or re.fullmatch(r"[0-9]{4}-[0-9]{4}", user_id) is None
    ):
        raise RegistrationResendUnavailable(
            "Registration OTP resend unavailable."
        )

    settings = load_auth_settings()

    with db.begin():
        # Lock user first, just like Step 52's OTP verifier.
        user = db.execute(
            select(User)
            .where(User.id_number == user_id)
            .with_for_update()
        ).scalar_one_or_none()

        if (
            user is None
            or user.role not in ("student", "instructor")
            or user.account_status != "inactive"
            or user.is_email_verified is not False
        ):
            raise RegistrationResendUnavailable(
                "Registration OTP resend unavailable."
            )

        latest = db.execute(
            select(EmailOTP)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == REGISTRATION_OTP_PURPOSE,
            )
            .order_by(
                EmailOTP.created_at.desc(),
                EmailOTP.id.desc(),
            )
            .limit(1)
            .with_for_update()
        ).scalar_one_or_none()

        if latest is None or latest.used_at is not None:
            raise RegistrationResendUnavailable(
                "Registration OTP resend unavailable."
            )

        now = datetime.now(timezone.utc)
        window_start = now - timedelta(seconds=RESEND_WINDOW_SECONDS)

        recent_resends = db.execute(
            select(EmailOTP.created_at)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == REGISTRATION_OTP_PURPOSE,
                EmailOTP.is_resend.is_(True),
                EmailOTP.created_at >= window_start,
            )
            .order_by(EmailOTP.created_at.asc())
        ).scalars().all()

        retry_after = _resend_retry_seconds(
            latest_created_at=latest.created_at,
            resend_created_at=list(recent_resends),
            now=now,
            settings=settings,
        )

        if retry_after:
            raise RegistrationResendLimited(retry_after)

        code = generate_email_otp()
        expiry = now + timedelta(seconds=settings.otp_expiry_seconds)

        digest = hash_email_otp(
            code,
            user_id,
            REGISTRATION_OTP_PURPOSE,
            settings.otp_hmac_key,
        )

        # Revoke earlier unused registration OTPs.
        db.execute(
            update(EmailOTP)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == REGISTRATION_OTP_PURPOSE,
                EmailOTP.used_at.is_(None),
                EmailOTP.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )

        # Save the replacement OTP digest, never the plaintext code.
        db.add(
            EmailOTP(
                user_id=user_id,
                purpose=REGISTRATION_OTP_PURPOSE,
                otp_hash=digest,
                is_resend=True,
                failed_attempts=0,
                created_at=now,
                expires_at=expiry,
            )
        )

        db.add(
            ActivityLog(
                event_type="registration_otp_resend_issued",
                user_id=user_id,
                details={
                    "resends_in_window": len(recent_resends) + 1
                },
            )
        )

        db.flush()

        delivery = PendingRegistration(
            user_id=user_id,
            email_address=user.email.strip().lower(),
            otp_expires_at=expiry,
            otp_code=code,
        )

    return delivery
