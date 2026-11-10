
"""LabGear File 89: admin-only security-monitoring API.

CREATE: backend/app/api/routes/admin_monitoring.py

Mount in a later main.py step:
    from app.api.routes.admin_monitoring import router as admin_monitoring_router
    app.include_router(admin_monitoring_router)

Only an active, authenticated admin session can read the dashboard.
Every successful dashboard read and authenticated non-admin denial is
appended to activity_logs. This route never updates or deletes audit logs.
The monitoring script, dashboard React UI, and admin account provisioning
are separate steps. No database changes or migration are performed here.
"""

from __future__ import annotations

import ipaddress
import logging
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException, Query, Request, Response
from sqlalchemy import func, or_, select, text
from sqlalchemy.exc import SQLAlchemyError

from app.db.dependencies import DbSession
from app.models.security import ActivityLog, IPBlock, SecurityFlag
from app.models.user import User
from app.services.session_service import (
    SESSION_COOKIE_NAME,
    SessionUnavailable,
    require_authenticated_session,
)

router = APIRouter(prefix="/api/admin", tags=["Admin Security Monitoring"])
logger = logging.getLogger("labgear.admin_monitoring")

MANILA = ZoneInfo("Asia/Manila")
UTC = timezone.utc
_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_ALLOWED_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)

_LOGIN_FAILURES = ("login_password_failed", "login_otp_failed", "login_failed")
_OTP_FAILURES = ("login_otp_failed", "otp_failed", "registration_otp_failed", "password_recovery_otp_failed")
_OTP_ISSUED = ("login_otp_issued", "registration_otp_issued", "password_recovery_otp_issued")
# These represent confirmed sends only if older code actually writes such events.
_OTP_SENT = ("otp_sent", "login_otp_sent", "registration_otp_sent", "password_recovery_otp_sent")
_ACCOUNT_LOCKOUTS = ("login_account_lockout", "lockout_tier_1", "lockout_tier_2", "lockout_tier_3")
_ALERT_EMAIL_SENT = ("alert_email_sent", "login_alert_email_sent")
_SENSITIVE_FIELDS = (
    "password", "secret", "token", "cookie", "authorization", "answer",
    "otp", "hash", "credential", "private_key", "api_key", "code",
)


def _local_client_ip(request: Request) -> str:
    """Keep LabGear admin access restricted to the existing local deployment."""
    raw = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(raw)
    except ValueError:
        address = None
    if address is None or not address.is_loopback or request.url.hostname not in _ALLOWED_HOSTS:
        raise HTTPException(status_code=403, detail="Admin monitoring is limited to localhost.")
    return str(address)


def _trusted_browser_origin(request: Request) -> None:
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        raise HTTPException(status_code=403, detail="Origin not permitted.")
    origin = request.headers.get("origin")
    if origin is not None and origin not in _ALLOWED_ORIGINS:
        raise HTTPException(status_code=403, detail="Origin not permitted.")


def _safe_user_agent(raw: str | None) -> str | None:
    if not raw:
        return None
    return "".join(ch for ch in raw if ch.isprintable())[:255] or None


def _audit_access(db: DbSession, *, principal, request: Request, ip: str, allowed: bool) -> None:
    """Append audit event; fail closed if audit storage is unavailable."""
    try:
        db.add(
            ActivityLog(
                event_type="ADMIN_VIEWED_DASHBOARD" if allowed else "ADMIN_ACCESS_DENIED",
                user_id=principal.user_id,
                username_typed=principal.username,
                ip_address=ip,
                user_agent=_safe_user_agent(request.headers.get("user-agent")),
                details={"resource": "security_monitoring", "method": "GET"},
            )
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.error("Security dashboard audit write failed; access denied.")
        raise HTTPException(status_code=503, detail="Monitoring is temporarily unavailable.") from None


def _require_admin(db: DbSession, request: Request) -> None:
    address = _local_client_ip(request)
    _trusted_browser_origin(request)
    try:
        principal = require_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            method="GET",
        )
    except SessionUnavailable:
        raise HTTPException(status_code=401, detail="Authentication required.") from None
    except SQLAlchemyError:
        raise HTTPException(status_code=503, detail="Monitoring is temporarily unavailable.") from None

    allowed = isinstance(principal.role, str) and principal.role.lower() == "admin"
    _audit_access(db, principal=principal, request=request, ip=address, allowed=allowed)
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied.")


def _event_filter(*names: str):
    return func.lower(ActivityLog.event_type).in_(names)


def _count_events(db: DbSession, *, start: datetime, end: datetime, names: tuple[str, ...]) -> int:
    return int(
        db.execute(
            select(func.count(ActivityLog.id)).where(
                ActivityLog.created_at >= start,
                ActivityLog.created_at < end,
                _event_filter(*names),
            )
        ).scalar_one()
    )


def _safe_details(value, depth: int = 0):
    """Expose bounded, non-secret audit metadata only; never echo stored credentials."""
    if depth >= 3:
        return "[truncated]"
    if isinstance(value, dict):
        result = {}
        for key, item in list(value.items())[:25]:
            name = str(key)[:80]
            if any(term in name.lower() for term in _SENSITIVE_FIELDS):
                result[name] = "[redacted]"
            else:
                result[name] = _safe_details(item, depth + 1)
        return result
    if isinstance(value, (list, tuple)):
        return [_safe_details(item, depth + 1) for item in value[:20]]
    if isinstance(value, str):
        return value[:300]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:100]


def _hourly_login_failures(db: DbSession, now: datetime) -> list[dict]:
    now_local = now.astimezone(MANILA)
    last_hour = now_local.replace(minute=0, second=0, microsecond=0)
    hour_bucket = func.date_trunc(
        "hour", func.timezone("Asia/Manila", ActivityLog.created_at)
    )
    rows = db.execute(
        select(hour_bucket.label("bucket"), func.count(ActivityLog.id).label("attempts"))
        .where(
            ActivityLog.created_at >= now - timedelta(hours=24),
            ActivityLog.created_at <= now,
            _event_filter(*_LOGIN_FAILURES),
        )
        .group_by(hour_bucket)
    ).all()
    counts = {row.bucket.strftime("%Y-%m-%d %H"): int(row.attempts) for row in rows}

    result = []
    for offset in range(23, -1, -1):
        hour = last_hour - timedelta(hours=offset)
        result.append(
            {
                "hour": hour.isoformat(timespec="seconds"),
                "failed_logins": counts.get(hour.strftime("%Y-%m-%d %H"), 0),
            }
        )
    return result


def _active_ip_set(db: DbSession, now: datetime) -> set[str]:
    rows = db.execute(
        select(IPBlock.ip_address)
        .where(IPBlock.blocked_until > now)
        .distinct()
    ).scalars()
    return {str(ip) for ip in rows}


def _top_ips(db: DbSession, now: datetime, blocked_ips: set[str]) -> list[dict]:
    rows = db.execute(
        select(
            ActivityLog.ip_address,
            func.count(ActivityLog.id).label("failures"),
            func.count(func.distinct(ActivityLog.username_typed)).label("usernames"),
        )
        .where(
            ActivityLog.created_at >= now - timedelta(hours=24),
            ActivityLog.ip_address.is_not(None),
            _event_filter(*_LOGIN_FAILURES, *_OTP_FAILURES),
        )
        .group_by(ActivityLog.ip_address)
        .order_by(func.count(ActivityLog.id).desc(), ActivityLog.ip_address)
        .limit(5)
    ).all()
    return [
        {
            "ip_address": str(row.ip_address),
            "failures": int(row.failures),
            "distinct_usernames": int(row.usernames),
            "blocked_now": str(row.ip_address) in blocked_ips,
        }
        for row in rows
    ]


def _locked_accounts_now(db: DbSession, now: datetime) -> int:
    # Current LabGear login code uses short 24/48/96-second lockout tiers.
    rows = db.execute(
        select(ActivityLog.user_id, ActivityLog.created_at, ActivityLog.details, ActivityLog.event_type)
        .where(
            ActivityLog.created_at >= now - timedelta(seconds=120),
            ActivityLog.user_id.is_not(None),
            _event_filter(*_ACCOUNT_LOCKOUTS),
        )
    ).all()
    locked: set[str] = set()
    for user_id, created_at, details, event_type in rows:
        event = event_type.lower()
        value = details.get("duration_seconds", 0) if isinstance(details, dict) else 0
        if not isinstance(value, int) or value <= 0:
            value = {"lockout_tier_1": 24, "lockout_tier_2": 48, "lockout_tier_3": 96}.get(event, 0)
        if value > 0 and created_at + timedelta(seconds=value) > now:
            locked.add(user_id)
    return len(locked)


def _flags(db: DbSession) -> list[dict]:
    rows = db.execute(
        select(SecurityFlag)
        .order_by(SecurityFlag.created_at.desc(), SecurityFlag.id.desc())
        .limit(50)
    ).scalars()
    return [
        {
            "id": row.id,
            "pattern_type": row.pattern_type,
            "target_value": row.target_value[:255],
            "severity": row.severity,
            "flag_date": row.flag_date.isoformat(),
            "created_at": row.created_at.isoformat(),
            "details": _safe_details(row.details),
        }
        for row in rows
    ]


def _recent_events(
    db: DbSession,
    *,
    date_from: date | None,
    date_to: date | None,
    event_type: str | None,
    username: str | None,
    ip_address: str | None,
) -> list[dict]:
    query = select(ActivityLog, User.username.label("account_username")).outerjoin(
        User, ActivityLog.user_id == User.id_number
    )
    if date_from is not None:
        start = datetime.combine(date_from, time.min, tzinfo=MANILA).astimezone(UTC)
        query = query.where(ActivityLog.created_at >= start)
    if date_to is not None:
        next_date = date_to + timedelta(days=1)
        end = datetime.combine(next_date, time.min, tzinfo=MANILA).astimezone(UTC)
        query = query.where(ActivityLog.created_at < end)
    if event_type:
        query = query.where(func.lower(ActivityLog.event_type) == event_type.lower())
    if username:
        query = query.where(
            or_(
                func.lower(ActivityLog.username_typed) == username.lower(),
                func.lower(User.username) == username.lower(),
            )
        )
    if ip_address:
        query = query.where(ActivityLog.ip_address == ip_address)

    rows = db.execute(
        query.order_by(ActivityLog.created_at.desc(), ActivityLog.id.desc()).limit(50)
    ).all()
    return [
        {
            "id": event.id,
            "event_type": event.event_type,
            "username_typed": (event.username_typed or "")[:200],
            "account_username": (account_username or "")[:100],
            "user_id": event.user_id,
            "ip_address": str(event.ip_address) if event.ip_address else None,
            "user_agent": (event.user_agent or "")[:255],
            "details": _safe_details(event.details),
            "created_at": event.created_at.isoformat(),
        }
        for event, account_username in rows
    ]


@router.get("/monitoring")
def get_security_monitoring(
    request: Request,
    response: Response,
    db: DbSession,
    date_from: date | None = Query(default=None),
    date_to: date | None = Query(default=None),
    event_type: str | None = Query(default=None, min_length=1, max_length=50, pattern=r"^[A-Za-z0-9_]+$"),
    username: str | None = Query(default=None, min_length=1, max_length=100),
    ip_address: str | None = Query(default=None, max_length=45),
) -> dict:
    """Read-only admin dashboard data (React will poll every 60 seconds)."""
    _require_admin(db, request)

    if date_from is not None and (date_from.year < 2000 or date_from.year > 2098):
        raise HTTPException(status_code=422, detail="Invalid start date.")
    if date_to is not None and (date_to.year < 2000 or date_to.year > 2098):
        raise HTTPException(status_code=422, detail="Invalid end date.")
    if date_from is not None and date_to is not None and date_to < date_from:
        raise HTTPException(status_code=422, detail="End date must be after start date.")
    if date_from is not None and date_to is not None and (date_to - date_from).days > 366:
        raise HTTPException(status_code=422, detail="Date range may not exceed 366 days.")
    if ip_address:
        try:
            ip_address = str(ipaddress.ip_address(ip_address))
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid IP address filter.") from None

    now = datetime.now(UTC)
    today_local = now.astimezone(MANILA).date()
    start_of_day = datetime.combine(today_local, time.min, tzinfo=MANILA).astimezone(UTC)
    end_of_day = datetime.combine(today_local + timedelta(days=1), time.min, tzinfo=MANILA).astimezone(UTC)

    try:
        blocked_ips = _active_ip_set(db, now)
        # Only sessions created after a successful password + email OTP login
        # are included. This avoids counting an uncompleted OTP as a login.
        successful_logins_today = int(
            db.execute(
                text(
                    "SELECT count(*) FROM public.auth_sessions "
                    "WHERE created_at >= :start_day AND created_at < :end_day"
                ),
                {"start_day": start_of_day, "end_day": end_of_day},
            ).scalar_one()
        )
        summary = {
            "successful_logins": successful_logins_today,
            "failed_logins": _count_events(db, start=start_of_day, end=end_of_day, names=_LOGIN_FAILURES),
            "accounts_locked_now": _locked_accounts_now(db, now),
            "ips_blocked_now": len(blocked_ips),
            "otp_issued": _count_events(db, start=start_of_day, end=end_of_day, names=_OTP_ISSUED),
            "otp_sent": _count_events(db, start=start_of_day, end=end_of_day, names=_OTP_SENT),
            "otp_failed": _count_events(db, start=start_of_day, end=end_of_day, names=_OTP_FAILURES),
            "alert_emails_sent": _count_events(db, start=start_of_day, end=end_of_day, names=_ALERT_EMAIL_SENT),
        }
        result = {
            "generated_at": now.isoformat(),
            "timezone": "Asia/Manila",
            "summary": summary,
            "failed_logins_per_hour": _hourly_login_failures(db, now),
            "top_ips": _top_ips(db, now, blocked_ips),
            "flags": _flags(db),
            "recent_events": _recent_events(
                db, date_from=date_from, date_to=date_to,
                event_type=event_type, username=username,
                ip_address=ip_address,
            ),
        }
    except SQLAlchemyError as exc:
        db.rollback()
        logger.error("Security dashboard data query failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Monitoring is temporarily unavailable.") from None
    finally:
        # Keep the request Session clean for the dependency finalizer.
        if db.in_transaction():
            db.rollback()

    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    return result
