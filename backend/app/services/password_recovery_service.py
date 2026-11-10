
"""LabGear Backend File 84 — password recovery service.

Fix: security-answer verification is read-only and no longer requests SELECT FOR UPDATE, which requires unnecessary UPDATE privilege.

Destination: backend/app/services/password_recovery_service.py (REPLACE EXISTING FILE)

Recovery order:
    username + CAPTCHA
    -> one of the user's assigned security questions
    -> email OTP
    -> short-lived, signed password-reset grant
    -> new password

This service reuses the existing User, UserSecurityAnswer, EmailOTP,
PasswordHistory, ActivityLog, and IPBlock tables. It does not create tables
or perform schema migrations.

The API router must keep the OTP challenge and reset grant in HttpOnly,
SameSite=Lax cookies. Never return either signed token or a plaintext OTP
to browser JavaScript. The caller must send OTP email only after the
database transaction commits.
"""

from __future__ import annotations

import base64
import hmac
import ipaddress
import json
import math
import re
import smtplib
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import lru_cache

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.auth_config import AuthSettings, load_auth_settings
from app.core.auth_security import (
    generate_email_otp,
    hash_email_otp,
    hash_password,
    password_errors,
    password_was_used,
    verify_email_otp,
    verify_security_answer,
)
from app.models.auth import EmailOTP, PasswordHistory, UserSecurityAnswer
from app.models.security import ActivityLog, IPBlock
from app.models.user import User
from app.services.captcha_service import (
    CaptchaConfigurationError,
    verify_registration_captcha,
)
from app.services.email_delivery_service import (
    EmailConfigurationError,
    EmailDeliveryError,
    SMTP_TIMEOUT_SECONDS,
    load_smtp_settings,
)


PASSWORD_RECOVERY_OTP_PURPOSE = "reset"

RECOVERY_QUESTION_CODES = frozenset({"Q7", "Q2", "Q4"})
RECOVERY_QUESTIONS = {
    "Q7": "What was the name of your elementary school?",
    "Q2": "Who was your best friend in elementary school?",
    "Q4": "What is your mother's maiden first name?",
}

USERNAME_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]{5,16}\Z")
USER_ID_PATTERN = re.compile(r"[0-9]{4}-[0-9]{4}\Z")
ANSWER_PATTERN = re.compile(r"[A-Za-z]+(?: [A-Za-z]+)*\Z")
OTP_PATTERN = re.compile(r"[0-9]{6}\Z")
TOKEN_HASH_PATTERN = re.compile(r"[0-9a-f]{64}\Z")

RECOVERY_FLOW_SECONDS = 15 * 60
RESET_GRANT_SECONDS = 10 * 60
MIN_OTP_REMAINING_SECONDS = 15
FAILED_IP_EVENTS = ("login_password_failed", "login_otp_failed")


class PasswordRecoveryUnavailable(ValueError):
    """Generic recovery failure; do not disclose whether an account exists."""


class PasswordRecoveryRateLimited(PasswordRecoveryUnavailable):
    """A recovery, resend, or IP rate limit was reached."""

    def __init__(self, retry_after_seconds: int = 60):
        self.retry_after_seconds = max(1, int(retry_after_seconds))
        super().__init__(
            "Password recovery is temporarily unavailable. Try again later."
        )


class PasswordRecoveryCaptchaRejected(PasswordRecoveryUnavailable):
    """The submitted CAPTCHA was not accepted."""


class PasswordRecoveryPasswordRejected(ValueError):
    """The new password did not satisfy policy or confirmation rules."""


class PasswordRecoveryPasswordReused(PasswordRecoveryPasswordRejected):
    """The proposed password matches one of the last three passwords."""

    def __init__(self):
        super().__init__("You cannot reuse a recent password.")


@dataclass(frozen=True, slots=True)
class PendingPasswordRecoveryOTP:
    """Internal email-delivery data; never serialize this object to the browser."""

    user_id: str
    otp_id: int
    email_address: str = field(repr=False)
    otp_code: str = field(repr=False)
    otp_expires_at: datetime
    challenge_token: str = field(repr=False)
    challenge_expires_at: datetime


@dataclass(frozen=True, slots=True)
class PasswordResetGrant:
    """Short-lived proof that the recovery OTP was verified."""

    user_id: str
    reset_token: str = field(repr=False)
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class PasswordRecoveryCompleted:
    """Safe internal notification data after a committed password reset."""

    user_id: str
    username: str
    email_address: str = field(repr=False)


def _require_fresh_session(db: Session, function_name: str) -> None:
    if not isinstance(db, Session) or db.in_transaction():
        raise RuntimeError(
            f"{function_name} requires an unused SQLAlchemy Session."
        )


def _utc(value: datetime) -> datetime:
    if (
        not isinstance(value, datetime)
        or value.tzinfo is None
        or value.utcoffset() is None
    ):
        raise RuntimeError(
            "Database authentication timestamp must include timezone."
        )
    return value.astimezone(timezone.utc)


def _trusted_ip(value: str) -> str:
    try:
        return str(ipaddress.ip_address(value))
    except (TypeError, ValueError):
        raise PasswordRecoveryUnavailable(
            "Password recovery is temporarily unavailable."
        ) from None


def _safe_user_agent(value: str | None) -> str:
    return value[:500] if isinstance(value, str) else ""


def _lock_ip(db: Session, address: str) -> None:
    """Serialize recovery failure counters across PostgreSQL workers."""
    db.execute(
        select(
            func.pg_advisory_xact_lock(
                func.hashtext("labgear:password-recovery:" + address)
            )
        )
    ).scalar_one()


def _blocked_until(db: Session, address: str) -> datetime | None:
    value = db.execute(
        select(IPBlock.blocked_until)
        .where(IPBlock.ip_address == address)
        .order_by(IPBlock.blocked_until.desc())
        .limit(1)
    ).scalar_one_or_none()
    return _utc(value) if value is not None else None


def _check_ip_block(db: Session, address: str, now: datetime) -> None:
    blocked = _blocked_until(db, address)
    if blocked is not None and blocked > now:
        wait = math.ceil((blocked - now).total_seconds())
        raise PasswordRecoveryRateLimited(wait)


def _record_failed_ip_attempt(
    db: Session,
    *,
    address: str,
    user_id: str | None,
    username: str | None,
    user_agent: str,
    event_type: str,
    now: datetime,
    settings: AuthSettings,
) -> None:
    """Record a failed recovery action using the existing login IP threshold."""
    prior = db.execute(
        select(func.count())
        .select_from(ActivityLog)
        .where(
            ActivityLog.ip_address == address,
            ActivityLog.event_type.in_(FAILED_IP_EVENTS),
            ActivityLog.created_at
            >= now - timedelta(seconds=settings.ip_failure_window_seconds),
        )
    ).scalar_one()

    db.add(
        ActivityLog(
            event_type=event_type,
            username_typed=username,
            user_id=user_id,
            ip_address=address,
            user_agent=_safe_user_agent(user_agent),
            details={"source": "password_recovery"},
        )
    )

    if prior + 1 >= settings.ip_block_threshold:
        db.add(
            IPBlock(
                ip_address=address,
                reason="Too many failed authentication or recovery attempts",
                failure_count=prior + 1,
                blocked_at=now,
                blocked_until=now + timedelta(minutes=10),
            )
        )
        db.add(
            ActivityLog(
                event_type="login_ip_blocked",
                user_id=user_id,
                ip_address=address,
                user_agent=_safe_user_agent(user_agent),
                details={
                    "failure_count": prior + 1,
                    "block_seconds": 600,
                    "source": "password_recovery",
                },
            )
        )


def _account_locked(db: Session, user_id: str, now: datetime) -> bool:
    latest = db.execute(
        select(ActivityLog)
        .where(
            ActivityLog.user_id == user_id,
            ActivityLog.event_type == "login_account_lockout",
        )
        .order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc())
        .limit(1)
    ).scalar_one_or_none()

    if latest is None:
        return False

    details = latest.details if isinstance(latest.details, dict) else {}
    duration = details.get("duration_seconds", 0)
    if not isinstance(duration, int) or duration <= 0:
        return False

    return _utc(latest.created_at) + timedelta(seconds=duration) > now


def _lockout_duration(failed_count: int, settings: AuthSettings) -> int:
    """Use the same seeded 3/6/9-failure lockout tiers as login."""
    if failed_count < 3 or failed_count % 3 != 0:
        return 0

    tier = min(failed_count // 3, len(settings.login_lockout_seconds)) - 1
    return settings.login_lockout_seconds[tier]


def _record_wrong_security_answer(
    db: Session,
    *,
    user: User,
    address: str,
    user_agent: str,
    now: datetime,
    settings: AuthSettings,
) -> None:
    """Wrong recovery answers count toward the same account lockout as login."""
    user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
    duration = _lockout_duration(user.failed_login_attempts, settings)

    if duration:
        db.add(
            ActivityLog(
                event_type="login_account_lockout",
                user_id=user.id_number,
                ip_address=address,
                user_agent=_safe_user_agent(user_agent),
                details={
                    "failed_attempts": user.failed_login_attempts,
                    "duration_seconds": duration,
                    "source": "password_recovery",
                },
            )
        )

    _record_failed_ip_attempt(
        db,
        address=address,
        user_id=user.id_number,
        username=user.username,
        user_agent=user_agent,
        event_type="login_password_failed",
        now=now,
        settings=settings,
    )


@lru_cache(maxsize=1)
def _dummy_security_answer_hash() -> str:
    """Provide comparable Argon2 work for unknown or ineligible usernames."""
    from app.core.auth_security import hash_security_answer

    return hash_security_answer("LabGear dummy recovery answer 2026")


def _valid_answer(value: object) -> bool:
    return (
        isinstance(value, str)
        and 2 <= len(value) <= 50
        and ANSWER_PATTERN.fullmatch(value) is not None
    )


def _sign_recovery_token(claims: dict, *, token_kind: str) -> str:
    settings = load_auth_settings()
    encoded = (
        base64.urlsafe_b64encode(
            json.dumps(
                claims,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("utf-8")
        )
        .decode("ascii")
        .rstrip("=")
    )
    message = (
        "labgear:password-recovery:v1:"
        + token_kind
        + ":"
        + encoded
    ).encode("ascii")
    signature = hmac.new(
        settings.jwt_signing_key,
        message,
        digestmod="sha256",
    ).hexdigest()
    return encoded + "." + signature


def _read_recovery_token(
    token: str | None,
    *,
    expected_kind: str,
) -> dict | None:
    """Validate a signed, short-lived OTP challenge or reset grant."""
    if not isinstance(token, str) or len(token) > 2048 or "." not in token:
        return None

    try:
        encoded, supplied_signature = token.rsplit(".", 1)
        if TOKEN_HASH_PATTERN.fullmatch(supplied_signature) is None:
            return None

        settings = load_auth_settings()
        message = (
            "labgear:password-recovery:v1:"
            + expected_kind
            + ":"
            + encoded
        ).encode("ascii")
        expected_signature = hmac.new(
            settings.jwt_signing_key,
            message,
            digestmod="sha256",
        ).hexdigest()

        if not hmac.compare_digest(supplied_signature, expected_signature):
            return None

        padded = encoded + ("=" * (-len(encoded) % 4))
        decoded = base64.urlsafe_b64decode(padded.encode("ascii"))
        claims = json.loads(decoded.decode("utf-8"))

        if not isinstance(claims, dict):
            return None
        if claims.get("v") != 1 or claims.get("kind") != expected_kind:
            return None

        user_id = claims.get("user_id")
        otp_id = claims.get("otp_id")
        issued_at = claims.get("iat")
        expires_at = claims.get("exp")
        now = int(datetime.now(timezone.utc).timestamp())

        if (
            not isinstance(user_id, str)
            or USER_ID_PATTERN.fullmatch(user_id) is None
            or type(otp_id) is not int
            or otp_id <= 0
            or type(issued_at) is not int
            or type(expires_at) is not int
            or issued_at > now + 5
            or expires_at <= now
            or expires_at <= issued_at
        ):
            return None

        maximum_lifetime = (
            RECOVERY_FLOW_SECONDS
            if expected_kind == "otp"
            else RESET_GRANT_SECONDS
        )
        if expires_at - issued_at > maximum_lifetime:
            return None

        return claims
    except (
        ValueError,
        TypeError,
        UnicodeError,
        OverflowError,
        json.JSONDecodeError,
    ):
        return None


def _make_otp_challenge(
    *,
    user_id: str,
    otp_id: int,
    issued_at: int,
    expires_at: datetime,
) -> str:
    return _sign_recovery_token(
        {
            "v": 1,
            "kind": "otp",
            "user_id": user_id,
            "otp_id": otp_id,
            "iat": issued_at,
            "exp": int(expires_at.timestamp()),
        },
        token_kind="otp",
    )


def _make_reset_grant(
    *,
    user_id: str,
    otp_id: int,
    now: datetime,
) -> PasswordResetGrant:
    expires_at = now + timedelta(seconds=RESET_GRANT_SECONDS)
    token = _sign_recovery_token(
        {
            "v": 1,
            "kind": "reset",
            "user_id": user_id,
            "otp_id": otp_id,
            "iat": int(now.timestamp()),
            "exp": int(expires_at.timestamp()),
        },
        token_kind="reset",
    )
    return PasswordResetGrant(
        user_id=user_id,
        reset_token=token,
        expires_at=expires_at,
    )


def _issue_recovery_otp(
    db: Session,
    *,
    user: User,
    now: datetime,
    settings: AuthSettings,
    flow_claims: dict | None = None,
) -> PendingPasswordRecoveryOTP:
    """Create a purpose-bound OTP and replace every older recovery challenge."""
    latest = db.execute(
        select(EmailOTP)
        .where(
            EmailOTP.user_id == user.id_number,
            EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
        )
        .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
        .limit(1)
        .with_for_update()
    ).scalar_one_or_none()

    is_resend = False
    if latest is not None:
        latest_created = _utc(latest.created_at)
        within_window = latest_created >= now - timedelta(minutes=15)

        if within_window:
            cooldown_end = latest_created + timedelta(
                seconds=settings.otp_resend_cooldown_seconds
            )
            if cooldown_end > now:
                raise PasswordRecoveryRateLimited(
                    math.ceil((cooldown_end - now).total_seconds())
                )

            window_start = now - timedelta(minutes=15)
            recent_resends = db.execute(
                select(EmailOTP.created_at)
                .where(
                    EmailOTP.user_id == user.id_number,
                    EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
                    EmailOTP.is_resend.is_(True),
                    EmailOTP.created_at >= window_start,
                )
                .order_by(EmailOTP.created_at.asc())
            ).scalars().all()

            if len(recent_resends) >= settings.otp_max_resends_in_15_minutes:
                blocking_time = _utc(
                    recent_resends[-settings.otp_max_resends_in_15_minutes]
                )
                retry_after = math.ceil(
                    (
                        blocking_time
                        + timedelta(minutes=15)
                        - now
                    ).total_seconds()
                )
                raise PasswordRecoveryRateLimited(max(1, retry_after))

            is_resend = True

    if flow_claims is None:
        flow_issued_at = int(now.timestamp())
        flow_expires_at = now + timedelta(seconds=RECOVERY_FLOW_SECONDS)
    else:
        flow_issued_at = flow_claims["iat"]
        flow_expires_at = datetime.fromtimestamp(
            flow_claims["exp"],
            tz=timezone.utc,
        )

    if flow_expires_at <= now:
        raise PasswordRecoveryUnavailable(
            "Password recovery has expired. Start again."
        )

    # Replacing a code also invalidates any unconsumed reset grant.
    db.execute(
        update(EmailOTP)
        .where(
            EmailOTP.user_id == user.id_number,
            EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
            EmailOTP.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )

    otp_code = generate_email_otp()
    otp_expires_at = now + timedelta(seconds=settings.otp_expiry_seconds)
    otp_hash = hash_email_otp(
        otp_code,
        user.id_number,
        PASSWORD_RECOVERY_OTP_PURPOSE,
        settings.otp_hmac_key,
    )

    otp = EmailOTP(
        user_id=user.id_number,
        purpose=PASSWORD_RECOVERY_OTP_PURPOSE,
        otp_hash=otp_hash,
        failed_attempts=0,
        is_resend=is_resend,
        created_at=now,
        expires_at=otp_expires_at,
    )
    db.add(otp)
    db.flush()

    challenge_token = _make_otp_challenge(
        user_id=user.id_number,
        otp_id=otp.id,
        issued_at=flow_issued_at,
        expires_at=flow_expires_at,
    )

    db.add(
        ActivityLog(
            event_type="password_recovery_otp_issued",
            user_id=user.id_number,
            details={"is_resend": is_resend},
        )
    )

    return PendingPasswordRecoveryOTP(
        user_id=user.id_number,
        otp_id=otp.id,
        email_address=user.email,
        otp_code=otp_code,
        otp_expires_at=otp_expires_at,
        challenge_token=challenge_token,
        challenge_expires_at=flow_expires_at,
    )


def begin_password_recovery(
    db: Session,
    *,
    username: str,
    question_code: str,
    answer: str,
    answer_confirmation: str,
    captcha_token: str,
    ip_address: str,
    user_agent: str = "",
) -> PendingPasswordRecoveryOTP | None:
    """Verify username, CAPTCHA, and one assigned security answer.

    Returns internal OTP delivery data only when the answer is correct.
    Returns None for unknown, inactive, unverified, locked, or incorrect
    accounts so the public route can always return the same generic response.

    The answer and confirmation are compared before CAPTCHA or database
    account lookup, as required by the IT 107 recovery workflow.
    """
    _require_fresh_session(db, "begin_password_recovery")

    identifier = username.strip() if isinstance(username, str) else ""
    if (
        USERNAME_PATTERN.fullmatch(identifier) is None
        or question_code not in RECOVERY_QUESTION_CODES
        or not _valid_answer(answer)
        or not _valid_answer(answer_confirmation)
        or not hmac.compare_digest(
            answer.encode("utf-8"),
            answer_confirmation.encode("utf-8"),
        )
    ):
        raise PasswordRecoveryUnavailable(
            "If the recovery details are valid, a verification code will be sent."
        )

    if not isinstance(captcha_token, str) or not captcha_token.strip():
        raise PasswordRecoveryCaptchaRejected(
            "Complete CAPTCHA verification and try again."
        )

    if not verify_registration_captcha(captcha_token):
        raise PasswordRecoveryCaptchaRejected(
            "Complete CAPTCHA verification and try again."
        )

    address = _trusted_ip(ip_address)
    settings = load_auth_settings()
    pending: PendingPasswordRecoveryOTP | None = None

    with db.begin():
        _lock_ip(db, address)
        now = datetime.now(timezone.utc)
        _check_ip_block(db, address, now)

        user = db.execute(
            select(User)
            .where(func.lower(User.username) == identifier.lower())
            .with_for_update()
        ).scalar_one_or_none()

        if (
            user is None
            or user.account_status != "active"
            or user.is_email_verified is not True
        ):
            verify_security_answer(answer, _dummy_security_answer_hash())
        elif _account_locked(db, user.id_number, now):
            verify_security_answer(answer, _dummy_security_answer_hash())
        else:
            stored_answer = db.execute(
                select(UserSecurityAnswer)
                .where(
                    UserSecurityAnswer.user_id == user.id_number,
                    UserSecurityAnswer.question_code == question_code,
                )
            ).scalar_one_or_none()

            if (
                stored_answer is None
                or not verify_security_answer(answer, stored_answer.answer_hash)
            ):
                if stored_answer is None:
                    verify_security_answer(answer, _dummy_security_answer_hash())

                _record_wrong_security_answer(
                    db,
                    user=user,
                    address=address,
                    user_agent=user_agent,
                    now=now,
                    settings=settings,
                )
            else:
                pending = _issue_recovery_otp(
                    db,
                    user=user,
                    now=now,
                    settings=settings,
                )

    return pending


def resend_password_recovery_otp(
    db: Session,
    *,
    challenge_token: str,
) -> PendingPasswordRecoveryOTP:
    """Resend only when the signed OTP-stage challenge cookie is valid."""
    _require_fresh_session(db, "resend_password_recovery_otp")

    claims = _read_recovery_token(challenge_token, expected_kind="otp")
    if claims is None:
        raise PasswordRecoveryUnavailable(
            "Password recovery is invalid or expired. Start again."
        )

    settings = load_auth_settings()
    now = datetime.now(timezone.utc)
    user_id = claims["user_id"]
    otp_id = claims["otp_id"]

    with db.begin():
        user = db.execute(
            select(User)
            .where(User.id_number == user_id)
            .with_for_update()
        ).scalar_one_or_none()

        current_otp = db.execute(
            select(EmailOTP)
            .where(
                EmailOTP.id == otp_id,
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
            )
            .with_for_update()
        ).scalar_one_or_none()

        if (
            user is None
            or user.account_status != "active"
            or user.is_email_verified is not True
            or current_otp is None
            or current_otp.revoked_at is not None
            or current_otp.used_at is not None
            or _account_locked(db, user_id, now)
        ):
            raise PasswordRecoveryUnavailable(
                "Password recovery is invalid or expired. Start again."
            )

        latest_id = db.execute(
            select(EmailOTP.id)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
            )
            .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
            .limit(1)
        ).scalar_one_or_none()

        if latest_id != otp_id:
            raise PasswordRecoveryUnavailable(
                "Password recovery is invalid or expired. Start again."
            )

        pending = _issue_recovery_otp(
            db,
            user=user,
            now=now,
            settings=settings,
            flow_claims=claims,
        )

    return pending


def verify_password_recovery_otp(
    db: Session,
    *,
    challenge_token: str,
    otp_code: str,
    ip_address: str,
    user_agent: str = "",
) -> PasswordResetGrant:
    """Consume the latest valid reset OTP and issue a short-lived reset grant."""
    _require_fresh_session(db, "verify_password_recovery_otp")

    claims = _read_recovery_token(challenge_token, expected_kind="otp")
    if (
        claims is None
        or not isinstance(otp_code, str)
        or OTP_PATTERN.fullmatch(otp_code) is None
    ):
        raise PasswordRecoveryUnavailable(
            "The verification code is invalid, expired, or unavailable."
        )

    address = _trusted_ip(ip_address)
    settings = load_auth_settings()
    user_id = claims["user_id"]
    otp_id = claims["otp_id"]
    now = datetime.now(timezone.utc)

    rejected = False
    throttled = False

    with db.begin():
        _lock_ip(db, address)
        blocked = _blocked_until(db, address)
        if blocked is not None and blocked > now:
            throttled = True
        else:
            user = db.execute(
                select(User)
                .where(User.id_number == user_id)
                .with_for_update()
            ).scalar_one_or_none()

            otp = db.execute(
                select(EmailOTP)
                .where(
                    EmailOTP.id == otp_id,
                    EmailOTP.user_id == user_id,
                    EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
                )
                .with_for_update()
            ).scalar_one_or_none()

            eligible = (
                user is not None
                and user.account_status == "active"
                and user.is_email_verified is True
                and not _account_locked(db, user_id, now)
            )

            if (
                not eligible
                or otp is None
                or otp.used_at is not None
                or otp.revoked_at is not None
                or otp.failed_attempts >= settings.otp_max_failed_attempts
                or _utc(otp.expires_at) <= now
                or int(claims["exp"]) <= int(now.timestamp())
            ):
                rejected = True
            elif not verify_email_otp(
                otp_code,
                otp.otp_hash,
                user_id,
                PASSWORD_RECOVERY_OTP_PURPOSE,
                settings.otp_hmac_key,
            ):
                otp.failed_attempts += 1
                if otp.failed_attempts >= settings.otp_max_failed_attempts:
                    otp.revoked_at = now

                _record_failed_ip_attempt(
                    db,
                    address=address,
                    user_id=user_id,
                    username=user.username if user is not None else None,
                    user_agent=user_agent,
                    event_type="login_otp_failed",
                    now=now,
                    settings=settings,
                )
                rejected = True
            else:
                otp.used_at = now

                db.execute(
                    update(EmailOTP)
                    .where(
                        EmailOTP.user_id == user_id,
                        EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
                        EmailOTP.id != otp.id,
                        EmailOTP.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )

                db.add(
                    ActivityLog(
                        event_type="password_recovery_otp_verified",
                        user_id=user_id,
                        ip_address=address,
                        user_agent=_safe_user_agent(user_agent),
                        details={"reset_grant_pending": True},
                    )
                )

    if throttled:
        raise PasswordRecoveryRateLimited(60)
    if rejected:
        raise PasswordRecoveryUnavailable(
            "The verification code is invalid, expired, or unavailable."
        )

    return _make_reset_grant(
        user_id=user_id,
        otp_id=otp_id,
        now=now,
    )


def complete_password_recovery(
    db: Session,
    *,
    reset_token: str,
    new_password: str,
    password_confirmation: str,
) -> PasswordRecoveryCompleted:
    """Change the password once, only with a valid OTP-stage reset grant."""
    _require_fresh_session(db, "complete_password_recovery")

    claims = _read_recovery_token(reset_token, expected_kind="reset")
    if claims is None:
        raise PasswordRecoveryUnavailable(
            "Password reset is invalid or expired. Start recovery again."
        )

    if (
        not isinstance(new_password, str)
        or not isinstance(password_confirmation, str)
        or not hmac.compare_digest(
            new_password.encode("utf-8"),
            password_confirmation.encode("utf-8"),
        )
    ):
        raise PasswordRecoveryPasswordRejected("Mismatch Password.")

    errors = password_errors(new_password)
    if errors:
        raise PasswordRecoveryPasswordRejected(" ".join(errors))

    user_id = claims["user_id"]
    otp_id = claims["otp_id"]
    now = datetime.now(timezone.utc)
    completed: PasswordRecoveryCompleted | None = None

    with db.begin():
        user = db.execute(
            select(User)
            .where(User.id_number == user_id)
            .with_for_update()
        ).scalar_one_or_none()

        otp = db.execute(
            select(EmailOTP)
            .where(
                EmailOTP.id == otp_id,
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
            )
            .with_for_update()
        ).scalar_one_or_none()

        if (
            user is None
            or user.account_status != "active"
            or user.is_email_verified is not True
            or otp is None
            or otp.used_at is None
            or otp.revoked_at is not None
            or int(claims["exp"]) <= int(now.timestamp())
        ):
            raise PasswordRecoveryUnavailable(
                "Password reset is invalid or expired. Start recovery again."
            )

        recent_history = db.execute(
            select(PasswordHistory.password_hash)
            .where(PasswordHistory.user_id == user_id)
            .order_by(
                PasswordHistory.created_at.desc(),
                PasswordHistory.id.desc(),
            )
            .limit(3)
        ).scalars().all()

        history_hashes = list(recent_history)
        if user.password_hash not in history_hashes:
            history_hashes = [user.password_hash, *history_hashes[:2]]

        if password_was_used(new_password, history_hashes):
            raise PasswordRecoveryPasswordReused()

        new_hash = hash_password(new_password)
        user.password_hash = new_hash
        user.failed_login_attempts = 0

        db.add(
            PasswordHistory(
                user_id=user_id,
                password_hash=new_hash,
            )
        )

        # Revoking the verified OTP consumes the signed reset grant as well.
        otp.revoked_at = now

        db.execute(
            update(EmailOTP)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
                EmailOTP.id != otp_id,
                EmailOTP.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )

        db.add(
            ActivityLog(
                event_type="password_recovery_completed",
                user_id=user_id,
                details={"password_history_enforced": True},
            )
        )

        completed = PasswordRecoveryCompleted(
            user_id=user.id_number,
            username=user.username,
            email_address=user.email,
        )

    if completed is None:
        raise PasswordRecoveryUnavailable(
            "Password reset could not be completed. Start recovery again."
        )

    return completed


def revoke_password_recovery_otp(
    db: Session,
    *,
    user_id: str,
    otp_id: int,
) -> bool:
    """Revoke a code when SMTP delivery fails; safe to call from the API route."""
    _require_fresh_session(db, "revoke_password_recovery_otp")

    if (
        USER_ID_PATTERN.fullmatch(user_id) is None
        or type(otp_id) is not int
        or otp_id <= 0
    ):
        return False

    with db.begin():
        otp = db.execute(
            select(EmailOTP)
            .where(
                EmailOTP.id == otp_id,
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == PASSWORD_RECOVERY_OTP_PURPOSE,
            )
            .with_for_update()
        ).scalar_one_or_none()

        if otp is None or otp.used_at is not None or otp.revoked_at is not None:
            return False

        otp.revoked_at = datetime.now(timezone.utc)

    return True


def send_password_recovery_otp_email(
    delivery: PendingPasswordRecoveryOTP,
) -> None:
    """Send a reset-purpose OTP using the existing Gmail SMTP_SSL settings."""
    if not isinstance(delivery, PendingPasswordRecoveryOTP):
        raise TypeError("A PendingPasswordRecoveryOTP object is required.")

    if OTP_PATTERN.fullmatch(delivery.otp_code) is None:
        raise EmailDeliveryError("Password recovery code has an invalid format.")

    expiry = delivery.otp_expires_at
    if not isinstance(expiry, datetime) or expiry.tzinfo is None:
        raise EmailDeliveryError("Password recovery expiry is invalid.")

    remaining = (_utc(expiry) - datetime.now(timezone.utc)).total_seconds()
    if remaining < MIN_OTP_REMAINING_SECONDS:
        raise EmailDeliveryError(
            "Password recovery code is expired or near expiry."
        )

    smtp = load_smtp_settings()
    message = EmailMessage()
    message["From"] = smtp.from_email
    message["To"] = delivery.email_address
    message["Subject"] = "LabGear - Your password reset code"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        "A password recovery request was made for your LabGear account.\n\n"
        "Your password reset verification code is:\n\n"
        f"{delivery.otp_code}\n\n"
        "This code expires in three minutes and can be used only once. "
        "Enter it only on the LabGear website. Never share this code.\n\n"
        "If you did not request a password reset, ignore this email.\n"
    )

    try:
        with smtplib.SMTP_SSL(
            smtp.host,
            smtp.port,
            timeout=SMTP_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        ) as server:
            server.login(smtp.username, smtp.password)
            server.send_message(message)
    except (EmailConfigurationError, EmailDeliveryError):
        raise
    except (smtplib.SMTPException, OSError, TimeoutError):
        raise EmailDeliveryError(
            "Password recovery email could not be sent."
        ) from None


def send_password_changed_email(
    completed: PasswordRecoveryCompleted,
) -> None:
    """Send the required password-changed notification after a successful reset."""
    if not isinstance(completed, PasswordRecoveryCompleted):
        raise TypeError("A PasswordRecoveryCompleted object is required.")

    smtp = load_smtp_settings()
    message = EmailMessage()
    message["From"] = smtp.from_email
    message["To"] = completed.email_address
    message["Subject"] = "LabGear - Your password was changed"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        f"Hello {completed.username},\n\n"
        "Your LabGear account password was changed successfully.\n\n"
        "If you did not make this change, contact your laboratory "
        "administrator immediately.\n\n"
        "LabGear Security Team\n"
    )

    try:
        with smtplib.SMTP_SSL(
            smtp.host,
            smtp.port,
            timeout=SMTP_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        ) as server:
            server.login(smtp.username, smtp.password)
            server.send_message(message)
    except (EmailConfigurationError, EmailDeliveryError):
        raise
    except (smtplib.SMTPException, OSError, TimeoutError):
        raise EmailDeliveryError(
            "Password change notification could not be sent."
        ) from None
