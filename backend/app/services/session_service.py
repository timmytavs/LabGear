
"""LabGear Backend File 62 — PostgreSQL-backed authenticated sessions.

Destination: backend/app/services/session_service.py (CREATE)

This internal service creates a new session ONLY from a trusted
VerifiedLoginPrincipal produced by the successful login-OTP flow, then checks
that session for each protected request. It stores HMAC-SHA256 hashes of the
session cookie and CSRF token, never their plaintext values.

Policy:
  * 9-minute idle timeout, measured server-side using last_activity_at.
  * 12-hour maximum lifetime, regardless of activity.
  * CSRF token required for POST, PUT, PATCH, DELETE requests.
  * Account must remain active and email-verified on every request.
  * Logout revokes the session inside a transaction.

This file does not create tables, install routes, set cookies, or send email.
File 61 must have been applied to the existing labgear_db first. Route code
must set an HttpOnly cookie with SameSite=Lax and Secure on HTTPS, return the
CSRF token only to the authenticated client, and use credentials: 'include'.
Do not trust a principal constructed from HTTP request data. When integrating
login, issue it only after verify_login_otp_code has succeeded.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    MetaData,
    String,
    Table,
    Text,
    insert,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import INET
from sqlalchemy.orm import Session

from app.core.auth_config import load_auth_settings
from app.models.security import ActivityLog
from app.models.user import User
from app.services.login_service import VerifiedLoginPrincipal


SESSION_COOKIE_NAME = "labgear_session"
CSRF_HEADER_NAME = "X-CSRF-Token"
ABSOLUTE_LIFETIME_SECONDS = 12 * 60 * 60
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
ALLOWED_METHODS = SAFE_METHODS | frozenset({"POST", "PUT", "PATCH", "DELETE"})
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_-]{43}\Z")

# Use separate SQLAlchemy metadata: importing this module will not modify
# the existing ORM registry and never calls Base.metadata.create_all().
_session_metadata = MetaData()
auth_sessions = Table(
    "auth_sessions",
    _session_metadata,
    Column("id", BigInteger, primary_key=True),
    Column("user_id", String(9), nullable=False),
    Column("session_token_hash", String(64), nullable=False),
    Column("csrf_token_hash", String(64), nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("last_activity_at", DateTime(timezone=True), nullable=False),
    Column("expires_at", DateTime(timezone=True), nullable=False),
    Column("revoked_at", DateTime(timezone=True)),
    Column("ip_address", INET),
    Column("user_agent", Text),
    schema="public",
)


class SessionUnavailable(ValueError):
    """No current authenticated session; HTTP route should respond 401."""


class SessionCSRFRejected(SessionUnavailable):
    """Missing/mismatched CSRF token; HTTP route should respond 403."""


@dataclass(frozen=True, slots=True)
class IssuedSession:
    """Backend-only tokens; the API must not put session_token in JSON."""

    user_id: str
    expires_at: datetime
    session_token: str = field(repr=False)
    csrf_token: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    """Verified account context available to an authorized API handler."""

    user_id: str
    username: str
    role: str
    session_id: int
    expires_at: datetime


def _require_fresh_session(db: Session) -> None:
    if not isinstance(db, Session):
        raise TypeError("A SQLAlchemy Session is required.")
    if db.in_transaction():
        raise RuntimeError("Use a fresh request Session; this service owns its transaction.")


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise RuntimeError("Database session timestamps must be timezone-aware.")
    return value.astimezone(timezone.utc)


def _ip(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return str(ipaddress.ip_address(value))
    except ValueError:
        raise ValueError("Invalid client IP address.") from None


def _user_agent(value: str | None) -> str:
    return value[:500] if isinstance(value, str) else ""


def _is_token(value: str | None) -> bool:
    return isinstance(value, str) and _TOKEN_PATTERN.fullmatch(value) is not None


def _digest(token: str, *, purpose: str, key: bytes) -> str:
    """Domain-separated HMAC; the persistent JWT key is never printed."""
    if purpose not in ("session", "csrf"):
        raise ValueError("Invalid session token purpose.")
    return hmac.new(
        key,
        (f"labgear/{purpose}/v1:" + token).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def _active_user(user: User | None) -> bool:
    return (
        user is not None
        and user.account_status == "active"
        and user.is_email_verified is True
    )


def create_authenticated_session(
    db: Session,
    *,
    principal: VerifiedLoginPrincipal,
    ip_address: str | None,
    user_agent: str = "",
) -> IssuedSession:
    """Issue a fresh, random session after successful password + email OTP.

    The principal MUST come from verify_login_otp_code(), not request JSON.
    This function rechecks account state before committing, but does NOT by
    itself prove how the principal was obtained. Do not expose it as a route.
    """
    _require_fresh_session(db)
    if not isinstance(principal, VerifiedLoginPrincipal):
        raise TypeError("A verified login principal is required.")
    address = _ip(ip_address)
    settings = load_auth_settings()
    raw_session = secrets.token_urlsafe(32)
    raw_csrf = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    absolute_expiry = now + timedelta(seconds=ABSOLUTE_LIFETIME_SECONDS)

    with db.begin():
        user = db.execute(
            select(User)
            .where(User.id_number == principal.user_id)
            .with_for_update()
        ).scalar_one_or_none()
        if (
            not _active_user(user)
            or user.username != principal.username
            or user.role != principal.role
        ):
            raise SessionUnavailable("Authentication is required.")

        db.execute(insert(auth_sessions).values(
            user_id=user.id_number,
            session_token_hash=_digest(
                raw_session, purpose="session", key=settings.jwt_signing_key,
            ),
            csrf_token_hash=_digest(
                raw_csrf, purpose="csrf", key=settings.jwt_signing_key,
            ),
            created_at=now,
            last_activity_at=now,
            expires_at=absolute_expiry,
            ip_address=address,
            user_agent=_user_agent(user_agent),
        ))
        # Reset password failures after full 2FA and successful session insert.
        user.failed_login_attempts = 0
        db.add(ActivityLog(
            event_type="login_session_created",
            user_id=user.id_number,
            ip_address=address,
            user_agent=_user_agent(user_agent),
            details={"method": "password_email_otp"},
        ))

    return IssuedSession(
        user_id=principal.user_id,
        expires_at=absolute_expiry,
        session_token=raw_session,
        csrf_token=raw_csrf,
    )


def require_authenticated_session(
    db: Session,
    *,
    session_token: str | None,
    method: str,
    csrf_token: str | None = None,
) -> AuthenticatedSession:
    """Validate cookie, idle/absolute expiry, account status, and CSRF.

    Pass the REAL HTTP method for EVERY protected request. Unsafe methods
    require a valid X-CSRF-Token value; the cookie alone is insufficient.
    Each successful request refreshes the server-side last_activity_at value.
    Expired/deactivated sessions are revoked before returning an error.
    """
    _require_fresh_session(db)
    if not isinstance(method, str) or method.upper() not in ALLOWED_METHODS:
        raise ValueError("An actual supported HTTP method is required.")
    if not _is_token(session_token):
        raise SessionUnavailable("Authentication is required.")

    unsafe = method.upper() not in SAFE_METHODS
    if unsafe and not _is_token(csrf_token):
        raise SessionCSRFRejected("CSRF verification failed.")

    settings = load_auth_settings()
    session_hash = _digest(
        session_token, purpose="session", key=settings.jwt_signing_key,
    )
    current: AuthenticatedSession | None = None
    failure: type[Exception] | None = None

    with db.begin():
        row = db.execute(
            select(auth_sessions)
            .where(auth_sessions.c.session_token_hash == session_hash)
            .with_for_update()
        ).mappings().one_or_none()
        if row is None:
            failure = SessionUnavailable
        else:
            now = datetime.now(timezone.utc)
            revoked = row["revoked_at"] is not None
            expired = (
                now >= _utc(row["expires_at"])
                or now >= _utc(row["last_activity_at"]) + timedelta(
                    seconds=settings.session_idle_timeout_seconds,
                )
            )
            user = None
            if not revoked and not expired:
                user = db.execute(
                    select(User)
                    .where(User.id_number == row["user_id"])
                    .with_for_update()
                ).scalar_one_or_none()
            if revoked or expired or (user is not None and not _active_user(user)) or (
                not revoked and not expired and user is None
            ):
                if not revoked:
                    db.execute(
                        update(auth_sessions)
                        .where(auth_sessions.c.id == row["id"])
                        .values(revoked_at=now)
                    )
                failure = SessionUnavailable
            elif unsafe and not hmac.compare_digest(
                _digest(csrf_token, purpose="csrf", key=settings.jwt_signing_key),
                row["csrf_token_hash"],
            ):
                failure = SessionCSRFRejected
            else:
                db.execute(
                    update(auth_sessions)
                    .where(auth_sessions.c.id == row["id"])
                    .values(last_activity_at=now)
                )
                current = AuthenticatedSession(
                    user_id=user.id_number,
                    username=user.username,
                    role=user.role,
                    session_id=row["id"],
                    expires_at=_utc(row["expires_at"]),
                )

    if failure is SessionCSRFRejected:
        raise SessionCSRFRejected("CSRF verification failed.")
    if failure is not None or current is None:
        raise SessionUnavailable("Authentication is required.")
    return current


def revoke_authenticated_session(
    db: Session,
    *,
    session_token: str | None,
    csrf_token: str | None,
) -> bool:
    """Revoke session on logout; require both the cookie AND CSRF token.

    False means there was no matching live session. The route should clear the
    cookie regardless, and never reveal whether a token ever existed.
    """
    _require_fresh_session(db)
    if not _is_token(session_token):
        return False
    if not _is_token(csrf_token):
        raise SessionCSRFRejected("CSRF verification failed.")

    settings = load_auth_settings()
    digest = _digest(session_token, purpose="session", key=settings.jwt_signing_key)
    revoked = False
    with db.begin():
        row = db.execute(
            select(auth_sessions)
            .where(auth_sessions.c.session_token_hash == digest)
            .with_for_update()
        ).mappings().one_or_none()
        if row is not None and row["revoked_at"] is None:
            now = datetime.now(timezone.utc)
            valid = (
                now < _utc(row["expires_at"])
                and now < _utc(row["last_activity_at"]) + timedelta(
                    seconds=settings.session_idle_timeout_seconds,
                )
            )
            if valid and not hmac.compare_digest(
                _digest(csrf_token, purpose="csrf", key=settings.jwt_signing_key),
                row["csrf_token_hash"],
            ):
                raise SessionCSRFRejected("CSRF verification failed.")
            db.execute(
                update(auth_sessions)
                .where(auth_sessions.c.id == row["id"])
                .values(revoked_at=now)
            )
            revoked = True
            db.add(ActivityLog(
                event_type="login_session_revoked",
                user_id=row["user_id"],
                details={"reason": "logout" if valid else "expired"},
            ))
    return revoked
