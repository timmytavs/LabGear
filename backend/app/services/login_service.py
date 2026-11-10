
"""LabGear Backend File 106 — security lockout email alerts (preserves File 105).

Destination: backend/app/services/login_service.py (REPLACE)

This INTERNAL service provides:
  - Login CAPTCHA + username/password verification (Argon2id)
  - Progressive 24/48/96-second account lockouts at 3/6/9 failed passwords
  - IP blocking after 14 failed password/OTP attempts in 10 minutes
  - Purpose-bound, single-use email login OTP (3-minute expiry; 3 guesses)
  - Login OTP cooldown (60 seconds) and three reissues/15-minute window
  - SMTP_SSL Gmail delivery using the EXISTING secure SMTP settings
  - Security audit records and per-IP transaction serialization

The login verification function returns a principal, NOT a session or JWT.
The FastAPI route must create a protected server-side session AFTER a valid OTP,
never after only the username/password step. This module does not mount routes,
create tables, or send emails until send_login_otp_email() is explicitly called.

No test-only bypass of CAPTCHA, password, or OTP exists in production code.

File 105 records CAPTCHA_FAILED after a rejected login CAPTCHA, using the
existing activity_logs table.

File 106 sends one SMTP alert after each of lockout thresholds 3, 6, and 9
for verified active accounts; records alert_email_sent only after SMTP
acceptance. All login/OTP response behavior stays unchanged.
"""

from __future__ import annotations

import ipaddress
import logging
import math
import re
import smtplib
import ssl
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from functools import lru_cache

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.auth_config import AuthSettings, load_auth_settings
from app.core.auth_security import (
    generate_email_otp,
    hash_email_otp,
    hash_password,
    verify_email_otp,
    verify_password,
)
from app.models.auth import EmailOTP
from app.models.security import ActivityLog, IPBlock
from app.models.user import User
from app.services.captcha_service import verify_registration_captcha
from app.services.email_delivery_service import (
    EmailConfigurationError,
    EmailDeliveryError,
    SMTP_TIMEOUT_SECONDS,
    load_smtp_settings,
)

logger = logging.getLogger("labgear.login")

LOGIN_OTP_PURPOSE = "login"
IP_BLOCK_SECONDS = 10 * 60
OTP_RESEND_WINDOW_SECONDS = 15 * 60
FAILED_LOGIN_EVENTS = ("login_password_failed", "login_otp_failed")
USERNAME_PATTERN = re.compile(r"[A-Za-z][A-Za-z0-9]{5,16}\Z")
OTP_PATTERN = re.compile(r"[0-9]{6}\Z")
LOCKOUT_ALERT_THRESHOLDS = (3, 6, 9)
PHILIPPINE_TIME = timezone(timedelta(hours=8), "PHT")


class LoginUnavailable(ValueError):
    """Generic failed login or OTP; endpoints must not reveal account existence."""


class LoginThrottled(LoginUnavailable):
    """Temporary rate limit; endpoints should use a generic message."""

    def __init__(self, retry_after_seconds: int = 60):
        self.retry_after_seconds = max(1, int(retry_after_seconds))
        super().__init__("Login temporarily unavailable. Try again later.")


@dataclass(frozen=True, slots=True)
class PendingLoginOTP:
    """Trusted backend-only email delivery data. Never return to a browser."""

    user_id: str
    email_address: str
    expires_at: datetime
    otp_code: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class VerifiedLoginPrincipal:
    """Verified identity only; NOT a login session or authentication token."""

    user_id: str
    username: str
    role: str


@dataclass(frozen=True, slots=True)
class PendingLockoutAlert:
    """A confirmed tier event to notify the account owner, never the caller."""

    user_id: str
    email_address: str = field(repr=False)
    failed_attempts: int
    lockout_seconds: int
    occurred_at: datetime
    ip_address: str
    user_agent: str


@lru_cache(maxsize=1)
def _dummy_password_hash() -> str:
    # A non-secret, syntactically valid Argon2id digest for unknown usernames.
    # Avoid skipping password hashing and immediately revealing unknown users.
    return hash_password("DummyCredential#2026_OnlyForTiming")


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise RuntimeError("Database authentication timestamp must include timezone.")
    return value.astimezone(timezone.utc)


def _ip(value: str) -> str:
    try:
        return str(ipaddress.ip_address(value))
    except (TypeError, ValueError):
        raise LoginUnavailable("Unable to verify login request.") from None


def _ua(user_agent: str) -> str:
    return user_agent[:500] if isinstance(user_agent, str) else ""


def _lock_ip(db: Session, address: str) -> None:
    """Serialize rate-limit writes from this IP across Uvicorn workers."""
    db.execute(
        select(func.pg_advisory_xact_lock(func.hashtext("labgear:login:" + address)))
    ).scalar_one()


def _ip_blocked(db: Session, address: str, now: datetime) -> bool:
    blocked_until = db.execute(
        select(IPBlock.blocked_until)
        .where(IPBlock.ip_address == address)
        .order_by(IPBlock.blocked_until.desc())
        .limit(1)
    ).scalar_one_or_none()
    return blocked_until is not None and _utc(blocked_until) > now


def _failed_ip_attempt(
    db: Session, *, address: str, user_id: str | None,
    identifier: str | None, user_agent: str, event_type: str,
    now: datetime, settings: AuthSettings,
) -> None:
    """Audit a failed attempt and block the IP on the configured threshold."""
    prior = db.execute(
        select(func.count()).select_from(ActivityLog).where(
            ActivityLog.ip_address == address,
            ActivityLog.event_type.in_(FAILED_LOGIN_EVENTS),
            ActivityLog.created_at >= now - timedelta(seconds=settings.ip_failure_window_seconds),
        )
    ).scalar_one()

    db.add(ActivityLog(
        event_type=event_type,
        username_typed=identifier,
        user_id=user_id,
        ip_address=address,
        user_agent=_ua(user_agent),
        details={"source": "login"},
    ))

    if prior + 1 >= settings.ip_block_threshold:
        db.add(IPBlock(
            ip_address=address,
            reason="Too many failed login attempts within ten minutes",
            failure_count=prior + 1,
            blocked_at=now,
            blocked_until=now + timedelta(seconds=IP_BLOCK_SECONDS),
        ))
        db.add(ActivityLog(
            event_type="login_ip_blocked",
            user_id=user_id,
            ip_address=address,
            user_agent=_ua(user_agent),
            details={"failure_count": prior + 1, "block_seconds": IP_BLOCK_SECONDS},
        ))


def _account_locked(db: Session, user_id: str, now: datetime) -> bool:
    latest = db.execute(
        select(ActivityLog).where(
            ActivityLog.user_id == user_id,
            ActivityLog.event_type == "login_account_lockout",
        ).order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(1)
    ).scalar_one_or_none()
    if latest is None:
        return False
    duration = latest.details.get("duration_seconds", 0)
    if not isinstance(duration, int) or duration <= 0:
        return False
    return _utc(latest.created_at) + timedelta(seconds=duration) > now


def _lockout_duration(failed_count: int, settings: AuthSettings) -> int:
    """At 3, 6, 9 and every third later failed password, apply a lockout."""
    if failed_count < 3 or failed_count % 3 != 0:
        return 0
    tier = min(failed_count // 3, len(settings.login_lockout_seconds)) - 1
    return settings.login_lockout_seconds[tier]


def _login_otp_wait(db: Session, *, user_id: str, now: datetime, settings: AuthSettings) -> tuple[int, bool]:
    """Return (retry_after_seconds, is_resend) for issuing a new login OTP."""
    latest = db.execute(
        select(EmailOTP).where(
            EmailOTP.user_id == user_id,
            EmailOTP.purpose == LOGIN_OTP_PURPOSE,
        ).order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc()).limit(1)
    ).scalar_one_or_none()
    if latest is None:
        return 0, False

    last_time = _utc(latest.created_at)
    cooldown = math.ceil((last_time + timedelta(seconds=settings.otp_resend_cooldown_seconds) - now).total_seconds())
    if cooldown > 0:
        return cooldown, True

    since = now - timedelta(seconds=OTP_RESEND_WINDOW_SECONDS)
    recent_resends = db.execute(
        select(EmailOTP.created_at).where(
            EmailOTP.user_id == user_id,
            EmailOTP.purpose == LOGIN_OTP_PURPOSE,
            EmailOTP.is_resend.is_(True),
            EmailOTP.created_at >= since,
        ).order_by(EmailOTP.created_at.asc())
    ).scalars().all()
    if len(recent_resends) >= settings.otp_max_resends_in_15_minutes:
        blocking = _utc(recent_resends[-settings.otp_max_resends_in_15_minutes])
        wait = math.ceil((blocking + timedelta(seconds=OTP_RESEND_WINDOW_SECONDS) - now).total_seconds())
        return max(1, wait), True
    return 0, last_time > since


def _send_lockout_alert_email(alert: PendingLockoutAlert) -> None:
    """Email the owner after a committed lockout; success means SMTP accepted.

    The frontend currently opens Forgot Password through its login panel,
    not a dedicated /forgot-password route. Link to the working landing page
    and tell the user which action to select rather than inventing a route.
    """
    try:
        recipient = validate_email(
            alert.email_address, check_deliverability=False
        ).normalized
    except (EmailNotValidError, TypeError, ValueError):
        raise EmailDeliveryError("Security alert could not be sent.") from None

    smtp_settings = load_smtp_settings()
    event_time = alert.occurred_at.astimezone(PHILIPPINE_TIME).strftime(
        "%d %B %Y, %I:%M:%S %p PHT"
    )
    browser = "".join(c for c in alert.user_agent if c.isprintable())[:255]
    if not browser:
        browser = "Not provided"

    message = EmailMessage()
    message["From"] = smtp_settings.from_email
    message["To"] = recipient
    message["Subject"] = "Failed sign-in attempts on your account"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        "LabGear security alert\n\n"
        "Your account reached a temporary sign-in lockout.\n"
        f"Failed sign-in attempts: {alert.failed_attempts}\n"
        f"Lockout duration: {alert.lockout_seconds} seconds\n"
        f"Date and time: {event_time}\n"
        f"IP address: {alert.ip_address}\n"
        f"Browser/device (reported User-Agent): {browser}\n\n"
        "If this was not you, reset your password now:\n"
        "http://localhost:5173/\n"
        "Open Log-in and select 'Forgot Password? Reset Here'.\n\n"
        "LabGear will never ask for your password or verification code.\n"
    )
    try:
        with smtplib.SMTP_SSL(
            smtp_settings.host,
            smtp_settings.port,
            timeout=SMTP_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        ) as smtp:
            smtp.login(smtp_settings.username, smtp_settings.password)
            smtp.send_message(message)
    except (smtplib.SMTPException, OSError, TimeoutError):
        raise EmailDeliveryError("Security alert could not be sent.") from None


def begin_login(
    db: Session, *, username: str, password: str, captcha_token: str,
    ip_address: str, user_agent: str = "",
) -> PendingLoginOTP:
    """Verify login credentials and persist an email OTP in PostgreSQL.

    Requires a fresh Session and returns only backend-internal delivery data.
    Does not send SMTP mail or create an authenticated session. Caller sends
    the email AFTER this function commits, using send_login_otp_email().
    """
    if not isinstance(db, Session) or db.in_transaction():
        raise RuntimeError("begin_login requires a fresh SQLAlchemy Session.")
    address = _ip(ip_address)
    identifier = username.strip() if isinstance(username, str) else ""
    if not identifier or len(identifier) > 100 or not isinstance(password, str) or not password:
        raise LoginUnavailable("Unable to verify login credentials.")
    if not isinstance(captcha_token, str) or not verify_registration_captcha(captcha_token):
        # The verifier is called only once. Keep the failed login response
        # generic, and never persist the CAPTCHA token or the password.
        try:
            with db.begin():
                db.add(ActivityLog(
                    event_type="CAPTCHA_FAILED",
                    username_typed=identifier[:100],
                    ip_address=address,
                    user_agent=_ua(user_agent),
                    details={"source": "login", "reason": "captcha_rejected"},
                ))
        except SQLAlchemyError:
            # A logging failure must not make a rejected CAPTCHA acceptable
            # or reveal database errors to the browser.
            db.rollback()
            logger.error("Login CAPTCHA failure audit insertion failed.")
        raise LoginUnavailable("Unable to verify login credentials.")

    settings = load_auth_settings()
    result: PendingLoginOTP | None = None
    pending_lockout_alert: PendingLockoutAlert | None = None
    rejected = False
    throttled = 0
    with db.begin():
        _lock_ip(db, address)
        now = datetime.now(timezone.utc)
        if _ip_blocked(db, address, now):
            throttled = 60
        else:
            user = db.execute(
                select(User).where(func.lower(User.username) == identifier.lower()).with_for_update()
            ).scalar_one_or_none() if USERNAME_PATTERN.fullmatch(identifier) else None

            # Check a comparable Argon2id hash for unknown identifiers.
            password_ok = verify_password(password, user.password_hash if user is not None else _dummy_password_hash())
            eligible = (
                user is not None and password_ok and
                user.account_status == "active" and user.is_email_verified is True
            )
            if user is not None and _account_locked(db, user.id_number, now):
                # No further account failures while a lockout is active.
                rejected = True
            elif not eligible:
                user_id = user.id_number if user is not None else None
                if user is not None:
                    user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
                    duration = _lockout_duration(user.failed_login_attempts, settings)
                    if duration:
                        db.add(ActivityLog(
                            event_type="login_account_lockout", user_id=user.id_number,
                            ip_address=address, user_agent=_ua(user_agent),
                            details={
                                "failed_attempts": user.failed_login_attempts,
                                "duration_seconds": duration,
                                "alert_email_pending": True,
                            },
                        ))
                        # Notify only at the first occurrence of each seeded
                        # tier. Repeated later lockouts must not resend tier 3.
                        if (
                            user.failed_login_attempts in LOCKOUT_ALERT_THRESHOLDS
                            and user.account_status == "active"
                            and user.is_email_verified is True
                        ):
                            pending_lockout_alert = PendingLockoutAlert(
                                user_id=user.id_number,
                                email_address=user.email,
                                failed_attempts=user.failed_login_attempts,
                                lockout_seconds=duration,
                                occurred_at=now,
                                ip_address=address,
                                user_agent=_ua(user_agent),
                            )
                _failed_ip_attempt(
                    db, address=address, user_id=user_id,
                    identifier=identifier[:100], user_agent=user_agent,
                    event_type="login_password_failed", now=now, settings=settings,
                )
                rejected = True
            else:
                wait, is_resend = _login_otp_wait(
                    db, user_id=user.id_number, now=now, settings=settings
                )
                if wait:
                    throttled = wait
                else:
                    otp_code = generate_email_otp()
                    db.execute(
                        update(EmailOTP).where(
                            EmailOTP.user_id == user.id_number,
                            EmailOTP.purpose == LOGIN_OTP_PURPOSE,
                            EmailOTP.used_at.is_(None),
                            EmailOTP.revoked_at.is_(None),
                        ).values(revoked_at=now)
                    )
                    expiry = now + timedelta(seconds=settings.otp_expiry_seconds)
                    db.add(EmailOTP(
                        user_id=user.id_number, otp_hash=hash_email_otp(
                            otp_code, user.id_number, LOGIN_OTP_PURPOSE, settings.otp_hmac_key,
                        ),
                        purpose=LOGIN_OTP_PURPOSE,
                        is_resend=is_resend,
                        failed_attempts=0,
                        created_at=now,
                        expires_at=expiry,
                    ))
                    db.add(ActivityLog(
                        event_type="login_otp_issued", user_id=user.id_number,
                        ip_address=address, user_agent=_ua(user_agent),
                        details={"is_resend": is_resend},
                    ))
                    result = PendingLoginOTP(
                        user_id=user.id_number, email_address=user.email,
                        expires_at=expiry, otp_code=otp_code,
                    )
    # The lockout has already committed. Sending SMTP here leaves the account
    # lockout and its generic HTTP response intact if email delivery fails.
    if pending_lockout_alert is not None:
        try:
            _send_lockout_alert_email(pending_lockout_alert)
        except (EmailConfigurationError, EmailDeliveryError):
            logger.warning("LabGear lockout alert was not accepted by SMTP.")
        else:
            # Only SMTP acceptance is counted, not guaranteed inbox delivery.
            try:
                with db.begin():
                    db.add(ActivityLog(
                        event_type="alert_email_sent",
                        user_id=pending_lockout_alert.user_id,
                        ip_address=pending_lockout_alert.ip_address,
                        user_agent=pending_lockout_alert.user_agent,
                        details={
                            "source": "login",
                            "alert": "account_lockout",
                            "failed_attempts": pending_lockout_alert.failed_attempts,
                            "lockout_seconds": pending_lockout_alert.lockout_seconds,
                            "delivery_status": "smtp_accepted",
                        },
                    ))
            except SQLAlchemyError:
                db.rollback()
                logger.error("LabGear lockout alert acceptance audit failed.")

    if throttled:
        raise LoginThrottled(throttled)
    if rejected or result is None:
        raise LoginUnavailable("Unable to verify login credentials.")
    return result


def verify_login_otp_code(
    db: Session, *, user_id: str, otp_code: str, ip_address: str,
    user_agent: str = "",
) -> VerifiedLoginPrincipal:
    """Consume an OTP and return principal data, NOT a session or token.

    The caller MUST create a server-side authenticated session and enforce
    session expiry, anti-CSRF controls, and logout. Until then, the user is
    NOT logged in even if this function returns successfully.
    """
    if not isinstance(db, Session) or db.in_transaction():
        raise RuntimeError("verify_login_otp_code requires a fresh SQLAlchemy Session.")
    address = _ip(ip_address)
    if not isinstance(user_id, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{4}", user_id):
        raise LoginUnavailable("Invalid or expired verification code.")
    if not isinstance(otp_code, str) or OTP_PATTERN.fullmatch(otp_code) is None:
        raise LoginUnavailable("Invalid or expired verification code.")

    settings = load_auth_settings()
    principal: VerifiedLoginPrincipal | None = None
    rejected = False
    throttled = False
    with db.begin():
        _lock_ip(db, address)
        now = datetime.now(timezone.utc)
        if _ip_blocked(db, address, now):
            throttled = True
        else:
            user = db.execute(
                select(User).where(User.id_number == user_id).with_for_update()
            ).scalar_one_or_none()
            otp = None
            if user is not None:
                otp = db.execute(
                    select(EmailOTP).where(
                        EmailOTP.user_id == user_id,
                        EmailOTP.purpose == LOGIN_OTP_PURPOSE,
                    ).order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
                    .limit(1).with_for_update()
                ).scalar_one_or_none()
            eligible = user is not None and user.account_status == "active" and user.is_email_verified is True
            if (
                not eligible or (user is not None and _account_locked(db, user_id, now))
                or otp is None or otp.used_at is not None
                or otp.revoked_at is not None
                or otp.failed_attempts >= settings.otp_max_failed_attempts
                or _utc(otp.expires_at) <= now
                or _utc(otp.created_at) + timedelta(seconds=settings.otp_expiry_seconds) <= now
            ):
                _failed_ip_attempt(
                    db, address=address,
                    user_id=user_id if user is not None else None,
                    identifier=None, user_agent=user_agent,
                    event_type="login_otp_failed", now=now, settings=settings,
                )
                rejected = True
            elif not verify_email_otp(
                otp_code, otp.otp_hash, user_id, LOGIN_OTP_PURPOSE, settings.otp_hmac_key
            ):
                otp.failed_attempts += 1
                if otp.failed_attempts >= settings.otp_max_failed_attempts:
                    otp.revoked_at = now
                _failed_ip_attempt(
                    db, address=address, user_id=user_id, identifier=None,
                    user_agent=user_agent, event_type="login_otp_failed",
                    now=now, settings=settings,
                )
                rejected = True
            else:
                otp.used_at = now
                db.execute(
                    update(EmailOTP).where(
                        EmailOTP.user_id == user_id,
                        EmailOTP.purpose == LOGIN_OTP_PURPOSE,
                        EmailOTP.id != otp.id,
                        EmailOTP.used_at.is_(None),
                        EmailOTP.revoked_at.is_(None),
                    ).values(revoked_at=now)
                )
                # Reset failed_login_attempts ONLY when the upcoming session
                # creation step commits successfully, not before.
                db.add(ActivityLog(
                    event_type="login_otp_verified", user_id=user_id,
                    ip_address=address, user_agent=_ua(user_agent),
                    details={"session_pending": True},
                ))
                principal = VerifiedLoginPrincipal(
                    user_id=user.id_number, username=user.username, role=user.role
                )
    if throttled:
        raise LoginThrottled(60)
    if rejected or principal is None:
        raise LoginUnavailable("Invalid or expired verification code.")
    return principal


def send_login_otp_email(delivery: PendingLoginOTP) -> None:
    """Send a generated login OTP through the existing Gmail SMTP_SSL config."""
    if not isinstance(delivery, PendingLoginOTP):
        raise TypeError("Expected a trusted PendingLoginOTP delivery object.")
    if OTP_PATTERN.fullmatch(delivery.otp_code) is None:
        raise EmailDeliveryError("Login verification email unavailable.")
    if (_utc(delivery.expires_at) - datetime.now(timezone.utc)).total_seconds() < 15:
        raise EmailDeliveryError("Login verification email unavailable.")
    try:
        recipient = validate_email(delivery.email_address, check_deliverability=False).normalized
    except (EmailNotValidError, TypeError, ValueError):
        raise EmailDeliveryError("Login verification email unavailable.") from None

    settings = load_smtp_settings()
    message = EmailMessage()
    message["From"] = settings.from_email
    message["To"] = recipient
    message["Subject"] = "LabGear - Your login verification code"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        "Your LabGear login verification code is:\n\n"
        f"{delivery.otp_code}\n\n"
        "It expires three minutes after issuance. Never share this code. "
        "If you did not attempt to log in, please secure your account.\n"
    )
    try:
        with smtplib.SMTP_SSL(
            settings.host, settings.port, timeout=SMTP_TIMEOUT_SECONDS,
            context=ssl.create_default_context(),
        ) as smtp:
            smtp.login(settings.username, settings.password)
            smtp.send_message(message)
    except (smtplib.SMTPException, OSError, TimeoutError):
        raise EmailDeliveryError("Login verification email could not be sent.") from None
