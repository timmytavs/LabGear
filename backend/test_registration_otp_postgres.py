
"""LabGear Backend Step 53 (fixed): safe PostgreSQL OTP integration test.

Run from LabGear/backend:
    python test_registration_otp_postgres.py           # read-only preflight
    python test_registration_otp_postgres.py --run     # confirmed DB test

The --run test inserts three fictional accounts ONLY inside an outer
PostgreSQL transaction. Each service commit is confined to a SAVEPOINT;
the outer transaction is rolled back, even if a test fails. The script
checks successful OTP verification, replay rejection, three failed guesses,
expired OTP rejection, audit events, and transaction rollback.

Run ONLY against a local development database, NEVER production. Database
sequences are nontransactional; they can advance even after rollback.
External systems triggered by database triggers may also be nontransactional.
No SMTP email is sent. No public API route is enabled. OTPs stay private.
"""

import argparse
import secrets
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.core.auth_config import load_auth_settings
from app.db.database import engine
from app.models.auth import EmailOTP
from app.models.security import ActivityLog
from app.models.user import User
from app.schemas.auth import RegistrationRequest
from app.services.registration_otp_service import (
    RegistrationOtpResult,
    verify_pending_registration_otp,
)
from app.services.registration_service import (
    REGISTRATION_OTP_PURPOSE,
    _prepare_records,
)


EXPECTED_DB = "labgear_db"
LOCAL_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
REQUIRED_COLUMNS = {
    "users": {
        "id_number", "first_name", "family_name", "birthdate",
        "purok_street", "barangay", "municipality_city", "province",
        "country", "zip_code", "email", "username", "password_hash",
        "role", "department", "contact_number_encrypted",
        "contact_number_iv", "class_section_or_unit", "is_email_verified",
        "account_status", "failed_login_attempts", "privacy_consent_at",
    },
    "email_otps": {
        "id", "user_id", "purpose", "otp_hash", "failed_attempts",
        "is_resend", "created_at", "expires_at", "used_at", "revoked_at",
    },
    "activity_logs": {"id", "user_id", "event_type", "details"},
}


def require(label: str, condition: bool) -> None:
    print(f"{label}: {bool(condition)}")
    if not condition:
        raise AssertionError(f"Check failed: {label}")


def preflight() -> bool:
    """Read-only checks; never read secret values or print credentials."""
    print("LabGear Step 53 - Registration OTP PostgreSQL Integration Test")
    print("Mode: READ-ONLY PREFLIGHT")

    if engine.dialect.name != "postgresql":
        print("FAIL: This test requires PostgreSQL.")
        return False
    if engine.url.database != EXPECTED_DB or engine.url.host not in LOCAL_HOSTS:
        print("FAIL: Expected local development database labgear_db.")
        return False

    inspector = inspect(engine)
    models = {"users": User, "email_otps": EmailOTP, "activity_logs": ActivityLog}
    good = True
    for table_name, required in REQUIRED_COLUMNS.items():
        table_columns = {
            column["name"]
            for column in inspector.get_columns(table_name, schema="public")
        }
        model_columns = set(models[table_name].__table__.columns.keys())
        missing_db = sorted(required - table_columns)
        missing_model = sorted(required - model_columns)
        matched = not missing_db and not missing_model
        print(f"Schema {table_name}: {'PASS' if matched else 'FAIL'}")
        if missing_db:
            print("  Missing database columns:", ", ".join(missing_db))
        if missing_model:
            print("  Missing model columns:", ", ".join(missing_model))
        good = good and matched

    with engine.connect() as connection:
        db_name = connection.execute(text("SELECT current_database() ")).scalar_one()
        purpose_checks = connection.execute(text("""
            SELECT pg_get_constraintdef(oid)
            FROM pg_constraint
            WHERE conrelid = 'public.email_otps'::regclass
              AND contype = 'c'
        """)).scalars().all()

    require("Database is labgear_db", db_name == EXPECTED_DB)
    purpose_allowed = any(
        "purpose" in check.lower() and "'register'" in check
        for check in purpose_checks
    )
    require("Registration purpose is register", REGISTRATION_OTP_PURPOSE == "register")
    require("PostgreSQL register purpose is allowed", purpose_allowed)
    print("Read-only checks complete; no database records modified.")
    return good and purpose_allowed


def sample_registration(user_id: str, suffix: str) -> RegistrationRequest:
    return RegistrationRequest(
        id_number=user_id,
        first_name="LabGear",
        family_name="TestAccount",
        birthdate=date(2000, 1, 1),
        purok_street="Test Street",
        barangay="Test Barangay",
        municipality_city="Test City",
        province="Test Province",
        country="Philippines",
        zip_code="6000",
        email=f"labgear{suffix}@example.com",
        username=f"lg{suffix}",
        password="LabGear#Demo2026",
        confirm_password="LabGear#Demo2026",
        role="student",
        department="Information Technology",
        contact_number="09123456789",
        class_section_or_unit="TEST-ONLY",
        security_answer_q7="Test School",
        security_answer_q2="Test Friend",
        security_answer_q4="Test Name",
        privacy_consent=True,
        captcha_token="UNIT_TEST_ONLY_NOT_SUBMITTED",
    )


def new_unused_id(connection, reserved: set[str]) -> str:
    for _ in range(100):
        candidate = f"2026-{secrets.randbelow(10000):04d}"
        if candidate in reserved:
            continue
        if connection.execute(
            select(User.id_number).where(User.id_number == candidate)
        ).first() is None:
            return candidate
    raise RuntimeError("Unable to find a vacant fictional test user ID.")


def service_call(connection, user_id: str, otp_code: str) -> RegistrationOtpResult:
    """Bind service's commit inside a savepoint; outer test owns rollback."""
    with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
        result = verify_pending_registration_otp(
            db, user_id=user_id, otp_code=otp_code
        )
    if not connection.in_transaction():
        raise RuntimeError("STOP: Outer test transaction was unexpectedly closed.")
    return result


def run_database_tests() -> None:
    settings = load_auth_settings()
    identifiers: list[str] = []
    print("Mode: TEMPORARY DATABASE TRANSACTION")
    print("Each service commit is inside a savepoint; outer transaction rolls back.")

    with engine.connect() as connection:
        outer = connection.begin()
        try:
            for _ in range(3):
                identifiers.append(new_unused_id(connection, set(identifiers)))

            tag = secrets.token_hex(4)
            records = [
                _prepare_records(
                    sample_registration(user_id, tag + letter), settings=settings
                )
                for user_id, letter in zip(identifiers, "abc")
            ]

            # Keep expiry AFTER creation (also satisfies typical DB CHECKs),
            # but both dates are safely in the past.
            expired_at = datetime.now(timezone.utc) - timedelta(seconds=60)
            records[2].otp.created_at = expired_at - timedelta(
                seconds=settings.otp_expiry_seconds
            )
            records[2].otp.expires_at = expired_at

            with Session(
                bind=connection, join_transaction_mode="create_savepoint"
            ) as db:
                # ORM models have ForeignKey declarations, but no mapped
                # relationships. SQLAlchemy may otherwise flush children
                # before users. Flush the parent users first so their PKs
                # exist before inserting FK-dependent records.
                print("Stage: inserting temporary parent users")
                db.add_all([item.user for item in records])
                db.flush()

                print("Stage: inserting dependent OTP/security records")
                for item in records:
                    db.add_all(item.answers)
                    db.add(item.password_history)
                    db.add(item.otp)
                db.flush()
                db.commit()

            print("Temporary test records staged inside outer transaction.")

            # A: correct code verifies once, consumes OTP, activates account.
            one, two, three = identifiers
            good_code = records[0].delivery.otp_code
            result = service_call(connection, one, good_code)
            require("Correct OTP activates account", result == RegistrationOtpResult.VERIFIED)

            with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                user = db.execute(select(User).where(User.id_number == one)).scalar_one()
                otp = db.execute(select(EmailOTP).where(
                    EmailOTP.user_id == one,
                    EmailOTP.purpose == "register",
                )).scalar_one()
                require("Account marked active", user.account_status == "active")
                require("Email marked verified", user.is_email_verified is True)
                require("OTP marked used", otp.used_at is not None)

            require(
                "OTP replay rejected",
                service_call(connection, one, good_code) != RegistrationOtpResult.VERIFIED,
            )

            # B: incorrect code is counted, then code revoked on third failure.
            correct_two = records[1].delivery.otp_code
            wrong = "000000" if correct_two != "000000" else "000001"
            for attempt in (1, 2, 3):
                result = service_call(connection, two, wrong)
                expected = (
                    RegistrationOtpResult.EXHAUSTED
                    if attempt == 3 else RegistrationOtpResult.INVALID
                )
                require(f"Failed attempt {attempt} outcome", result == expected)
                with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                    otp = db.execute(select(EmailOTP).where(
                        EmailOTP.user_id == two,
                        EmailOTP.purpose == "register",
                    )).scalar_one()
                    require(f"Failed attempt {attempt} saved", otp.failed_attempts == attempt)
                    if attempt == 3:
                        require("Exhausted OTP revoked", otp.revoked_at is not None)

            require(
                "Correct OTP blocked after 3 failures",
                service_call(connection, two, correct_two) != RegistrationOtpResult.VERIFIED,
            )
            with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                user = db.execute(select(User).where(User.id_number == two)).scalar_one()
                require(
                    "Exhausted account stays inactive",
                    user.account_status == "inactive"
                    and user.is_email_verified is False,
                )

            # C: expired codes must not activate or consume the account.
            require(
                "Expired OTP rejected",
                service_call(connection, three, records[2].delivery.otp_code)
                == RegistrationOtpResult.EXPIRED,
            )
            with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                user = db.execute(select(User).where(User.id_number == three)).scalar_one()
                require("Expired account stays inactive", user.account_status == "inactive")

            with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
                count = db.execute(select(ActivityLog.id).where(
                    ActivityLog.user_id.in_(identifiers)
                )).all()
                require("Verification events audited", len(count) >= 4)

        finally:
            # Always discard fictional users, answers, OTPs, and audit rows.
            if outer.is_active:
                outer.rollback()
            else:
                raise RuntimeError("Outer transaction unexpectedly ended before rollback.")

    with engine.connect() as connection:
        left = connection.execute(
            select(User.id_number).where(User.id_number.in_(identifiers))
        ).all()
    require("All temporary accounts rolled back", not left)
    print("RESULT: PASS - PostgreSQL OTP integration checks succeeded.")
    print("No test accounts remain and no email was sent.")


def main() -> int:
    parser = argparse.ArgumentParser(description="LabGear safe OTP integration check")
    parser.add_argument(
        "--run", action="store_true",
        help="Run temporary PostgreSQL test transactions (requires confirmation).",
    )
    args = parser.parse_args()

    try:
        if not preflight():
            print("RESULT: FAIL - preflight must pass before any write test.")
            return 1
        if not args.run:
            print("RESULT: PASS - read-only preflight passed.")
            print("To test transactions, rerun with --run on local development only.")
            return 0

        print("This will INSERT fictional rows and ROLLBACK the outer transaction.")
        print("Only use a disposable LOCAL DEVELOPMENT database.")
        if input("Type RUN to continue: ").strip() != "RUN":
            print("Cancelled. No test records created.")
            return 0
        run_database_tests()
        return 0
    except (KeyboardInterrupt, EOFError):
        print("Cancelled. Transaction cleanup will run if testing began.")
        return 1
    except Exception as exc:
        # Do not echo raw SQL or exception parameters that may contain OTPs.
        print(f"RESULT: FAIL - {type(exc).__name__}")
        sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
        if sqlstate:
            print("PostgreSQL SQLSTATE:", sqlstate)
        # Constraint identity is safe to report; never print raw SQL or
        # database parameters because they might contain OTP hashes/PII.
        diag = getattr(getattr(exc, "orig", None), "diag", None)
        table_name = getattr(diag, "table_name", None)
        constraint_name = getattr(diag, "constraint_name", None)
        if table_name:
            print("Failed table:", table_name)
        if constraint_name:
            print("Failed constraint:", constraint_name)
        print("No public API endpoint has been enabled.")
        print("Share the error type and SQLSTATE, not credentials or OTP codes.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
