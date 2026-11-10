
"""LabGear File 107 — monitoring event-name compatibility (IT 107 Section 14).

REPLACE: backend/scripts/monitor.py
Run from backend with the virtual environment activated:
    python scripts/monitor.py --dry-run  # preview; does not write
    python scripts/monitor.py            # write new flags; idempotent

NOT an HTTP endpoint. Do not mount/import this script into FastAPI.
Reads the last 24 hours of activity_logs and detects four handout patterns:
  1. IP_OVER_THRESHOLD : one IP with failures >= configured IP threshold
  2. ACCOUNT_TARGETED : one username with failures from >= 3 IPs
  3. OTP_GUESSING     : >= 5 OTP_FAILED events for one account within 10 min
  4. OFF_HOURS_LOGIN : completed login from 00:00 to before 05:00 PHT

Writes only to security_flags, with a unique daily flag per pattern + target.
Never modifies or deletes the activity log, and never creates tables.
Uses SQLAlchemy parameter binding and PostgreSQL ON CONFLICT DO NOTHING.
"""

from __future__ import annotations

import argparse
import ipaddress
import math
import re
import sys
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

# `python scripts/monitor.py` puts backend/scripts, not backend, on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

PHT = timezone(timedelta(hours=8), name="PHT")
UTC = timezone.utc
PERIOD = timedelta(hours=24)
OTP_WINDOW = timedelta(minutes=10)

# Existing LabGear event names plus the handout's generic event naming.
LOGIN_FAILURES = frozenset({
    "login_password_failed", "login_otp_failed", "login_failed",
})
OTP_FAILURES = frozenset({
    "login_otp_failed", "registration_otp_failed",
    "password_recovery_otp_failed", "otp_failed",
})
# An OTP verification alone is NOT a completed login: the session can fail.
# LabGear records login_session_created only AFTER successful OTP and session
# creation. Keep login_success for compatibility with the handout naming.
SUCCESSFUL_LOGIN = frozenset({"login_success", "login_session_created"})


@dataclass(frozen=True, slots=True)
class Event:
    event_type: str
    created_at: datetime
    ip_address: str | None
    username: str | None
    user_id: str | None


@dataclass(frozen=True, slots=True)
class Finding:
    pattern_type: str
    target_value: str
    severity: str
    description: str
    details: dict


def _name(raw: str | None) -> str | None:
    """Normalize account keys; preserve no control characters."""
    if not isinstance(raw, str):
        return None
    result = raw.strip().casefold()
    return result[:255] if result else None


def _ip(raw: str | None) -> str | None:
    if raw is None:
        return None
    try:
        return str(ipaddress.ip_address(raw))
    except ValueError:
        return None


def _safe_console(raw: str) -> str:
    """Never emit terminal escape sequences from attacker-controlled log data."""
    return "".join(c if c.isprintable() else "?" for c in raw)[:80]


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Database timestamps must include timezone information.")
    return value.astimezone(UTC)


def detect_patterns(
    events: Iterable[Event], *, now: datetime, ip_threshold: int
) -> tuple[int, list[Finding]]:
    """Detect rules from existing audit events; no database calls or side effects."""
    if not isinstance(ip_threshold, int) or ip_threshold < 1:
        raise ValueError("A positive configured IP failure threshold is required.")
    now_utc = _utc(now)
    since = now_utc - PERIOD
    ip_failures: dict[str, list[str | None]] = defaultdict(list)
    username_ips: dict[str, set[str]] = defaultdict(set)
    otp_times: dict[str, list[datetime]] = defaultdict(list)
    offhour_logins: dict[str, list[datetime]] = defaultdict(list)
    scanned = 0

    for item in events:
        created_at = _utc(item.created_at)
        if not since <= created_at <= now_utc:
            continue
        scanned += 1
        event_type = item.event_type.casefold()
        address = _ip(item.ip_address)
        username = _name(item.username) or _name(item.user_id)

        if event_type in LOGIN_FAILURES:
            if address:
                ip_failures[address].append(username)
                if username:
                    username_ips[username].add(address)
        if event_type in OTP_FAILURES and item.user_id:
            # A guessed unknown username is NOT proof of a targeted account.
            # Prefer the real account ID as the deduplication target.
            otp_times[item.user_id].append(created_at)
        if event_type in SUCCESSFUL_LOGIN and username:
            local = created_at.astimezone(PHT)
            if 0 <= local.hour < 5:
                offhour_logins[username].append(local)

    findings: list[Finding] = []
    for ip_address, targets in sorted(ip_failures.items()):
        if len(targets) >= ip_threshold:
            distinct = len(set(u for u in targets if u))
            findings.append(Finding(
                "IP_OVER_THRESHOLD", ip_address, "HIGH",
                f"{len(targets)} failures; {distinct} usernames",
                {"failures": len(targets), "distinct_usernames": distinct,
                 "threshold": ip_threshold, "window_hours": 24},
            ))

    for username, addresses in sorted(username_ips.items()):
        if len(addresses) >= 3:
            findings.append(Finding(
                "ACCOUNT_TARGETED", username, "MEDIUM",
                f"Login failures from {len(addresses)} IPs",
                {"distinct_ips": len(addresses), "window_hours": 24},
            ))

    for user_id, stamps in sorted(otp_times.items()):
        stamps.sort()
        recent: deque[datetime] = deque()
        max_window = 0
        for timestamp in stamps:
            recent.append(timestamp)
            while recent and timestamp - recent[0] > OTP_WINDOW:
                recent.popleft()
            max_window = max(max_window, len(recent))
        if max_window >= 5:
            findings.append(Finding(
                "OTP_GUESSING", user_id, "MEDIUM",
                f"{max_window} failed OTP checks within 10 minutes",
                {"maximum_failures_in_10_minutes": max_window,
                 "total_failed_otp_checks_24h": len(stamps)},
            ))

    for username, stamps in sorted(offhour_logins.items()):
        findings.append(Finding(
            "OFF_HOURS_LOGIN", username, "MEDIUM",
            f"Completed login between 00:00–05:00 PHT ({len(stamps)} event(s))",
            {"count": len(stamps),
             "first_login_pht": min(stamps).isoformat(timespec="seconds"),
             "last_login_pht": max(stamps).isoformat(timespec="seconds")},
        ))

    return scanned, findings


def _load_events(db, now: datetime) -> Iterable[Event]:
    """Stream bounded fields; never read tokens, passwords, or JSON details."""
    from sqlalchemy import select
    from app.models.security import ActivityLog
    from app.models.user import User

    stmt = (
        select(
            ActivityLog.event_type,
            ActivityLog.created_at,
            ActivityLog.ip_address,
            ActivityLog.username_typed,
            ActivityLog.user_id,
            User.username,
        )
        .outerjoin(User, ActivityLog.user_id == User.id_number)
        .where(
            ActivityLog.created_at >= now - PERIOD,
            ActivityLog.created_at <= now,
        )
        .order_by(ActivityLog.created_at.asc(), ActivityLog.id.asc())
        .execution_options(yield_per=1000)
    )
    for event_type, created_at, ip, username_typed, user_id, username_from_user in db.execute(stmt):
        yield Event(
            event_type=event_type,
            created_at=created_at,
            ip_address=str(ip) if ip is not None else None,
            username=username_typed or username_from_user,
            user_id=user_id,
        )


def _save_findings(db, findings: list[Finding], *, today, dry_run: bool) -> tuple[int, int]:
    """Insert flags atomically; suppress duplicate pattern/target/date rows."""
    from sqlalchemy.dialects.postgresql import insert
    from app.models.security import SecurityFlag

    written = 0
    existing = 0
    for finding in findings:
        if dry_run:
            continue
        stmt = (
            insert(SecurityFlag)
            .values(
                pattern_type=finding.pattern_type,
                target_value=finding.target_value,
                severity=finding.severity,
                details=finding.details,
                flag_date=today,
            )
            .on_conflict_do_nothing(
                constraint="unique_daily_security_flag"
            )
            .returning(SecurityFlag.id)
        )
        inserted = db.execute(stmt).scalar_one_or_none()
        if inserted is None:
            existing += 1
        else:
            written += 1
    return written, existing


def run(*, dry_run: bool) -> int:
    """Use LabGear's configured DB account; never ask for an admin login."""
    from sqlalchemy.exc import SQLAlchemyError
    from app.core.auth_config import load_auth_settings
    from app.db.database import SessionLocal, engine

    if engine.url.database != "labgear_db" or engine.url.host not in (
        "localhost", "127.0.0.1", "::1"
    ):
        print("STOP: This script is restricted to the local labgear_db database.")
        return 1

    now = datetime.now(UTC)
    today = now.astimezone(PHT).date()
    try:
        threshold = int(load_auth_settings().ip_block_threshold)
        if threshold < 1:
            raise ValueError("Configured IP threshold must be positive.")
        with SessionLocal.begin() as db:
            count, findings = detect_patterns(
                _load_events(db, now), now=now, ip_threshold=threshold
            )
            written, existing = _save_findings(
                db, findings, today=today, dry_run=dry_run
            )
    except SQLAlchemyError as exc:
        original = getattr(exc, "orig", None)
        sqlstate = getattr(original, "sqlstate", None) or "unavailable"
        table = getattr(getattr(original, "diag", None), "table_name", None) or "unavailable"
        print(f"Database operation failed (SQLSTATE={sqlstate}, object={table}).")
        print("Confirm that labgear_app can SELECT audit logs and INSERT security_flags.")
        return 1
    except (ValueError, RuntimeError, OSError) as exc:
        print(f"Monitoring could not run: {type(exc).__name__}.")
        return 1

    print(f"IT 107 Monitoring Report — {now.astimezone(PHT):%Y-%m-%d %H:%M} PHT")
    print(f"Mode: {'DRY RUN (no writes)' if dry_run else 'LIVE (new flags inserted)'}")
    print(f"Scanned: {count:,} events (last 24 hours)")
    print(f"Configured IP failure threshold: {threshold}")
    for finding in findings:
        severity = {"HIGH": "HIGH", "MEDIUM": "MED ", "LOW": "LOW "}[finding.severity]
        print(f"[{severity}] {finding.pattern_type:<20} {_safe_console(finding.target_value):<26} {_safe_console(finding.description)}")
    if not findings:
        print("No matching attack patterns in the last 24 hours.")
    if dry_run:
        print(f"Potential flags: {len(findings)} (nothing written)")
    else:
        print(f"New flags written: {written}    Already flagged today: {existing}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="LabGear IT 107 security log monitor")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="read and detect patterns without inserting flags",
    )
    args = parser.parse_args()
    return run(dry_run=args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
