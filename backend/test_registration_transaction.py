
"""LabGear Step 54: corrected PostgreSQL registration transaction test.

Destination: backend/test_registration_transaction.py
Run: python test_registration_transaction.py

Temporarily creates a fictional user and related records in an outer
transaction with an inner SQLAlchemy savepoint, then rolls everything back.
Only run against a disposable, local LabGear development database.

The Google CAPTCHA response is mocked ONLY within this standalone test.
No FastAPI routes are enabled and no email is sent. Database sequences and
external effects of triggers may not be reversible by transaction rollback.
"""

import secrets
from datetime import date
from unittest.mock import patch

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import engine
from app.models.auth import EmailOTP, PasswordHistory, UserSecurityAnswer
from app.models.security import ActivityLog
from app.models.user import User
from app.schemas.auth import RegistrationRequest
from app.services.registration_service import register_pending_user


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


def check(label: str, passed: bool) -> None:
    print(f"{label}: {passed}")
    if not passed:
        raise AssertionError(f"Failed check: {label}")


def count_for_user(connection, model, user_column, user_id: str) -> int:
    return connection.execute(
        select(func.count()).select_from(model).where(user_column == user_id)
    ).scalar_one()


def run() -> int:
    print("LabGear Step 54 - Registration Transaction Test (corrected)")

    if (
        engine.dialect.name != "postgresql"
        or engine.url.database != "labgear_db"
        or engine.url.host not in LOCAL_HOSTS
    ):
        print("STOP: Expected local PostgreSQL development database labgear_db.")
        return 1

    print("Mode: Temporary database transaction with guaranteed rollback")
    print("Do not run against a production or shared database.")

    if input("Type RUN to authorize the test: ").strip() != "RUN":
        print("Test cancelled. No test records created.")
        return 0

    user_id = None
    error = None

    try:
        with engine.connect() as connection:
            outer = connection.begin()

            try:
                for _ in range(100):
                    candidate = f"2026-{secrets.randbelow(10000):04d}"
                    existing = connection.execute(
                        select(User.id_number).where(
                            User.id_number == candidate
                        )
                    ).first()

                    if existing is None:
                        user_id = candidate
                        break

                if user_id is None:
                    raise RuntimeError("No unused fictional user ID found.")

                tag = secrets.token_hex(4)

                payload = RegistrationRequest(
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
                    email=f"labgear{tag}@example.com",
                    username=f"lg{tag}",
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
                    captcha_token="LOCAL_TEST_ONLY",
                )

                # The service commits inside a savepoint.
                # The outer transaction still controls the final rollback.
                with Session(
                    bind=connection,
                    join_transaction_mode="create_savepoint",
                ) as db:
                    with patch(
                        "app.services.registration_service."
                        "verify_registration_captcha",
                        return_value=True,
                    ) as captcha_mock:
                        delivery = register_pending_user(db, payload)

                    called_once = captcha_mock.call_count == 1

                check("CAPTCHA verification called once", called_once)

                check(
                    "Pending user inserted",
                    count_for_user(
                        connection,
                        User,
                        User.id_number,
                        user_id,
                    ) == 1,
                )

                check(
                    "Three security answers inserted",
                    count_for_user(
                        connection,
                        UserSecurityAnswer,
                        UserSecurityAnswer.user_id,
                        user_id,
                    ) == 3,
                )

                check(
                    "Password history inserted",
                    count_for_user(
                        connection,
                        PasswordHistory,
                        PasswordHistory.user_id,
                        user_id,
                    ) == 1,
                )

                check(
                    "Registration OTP inserted",
                    count_for_user(
                        connection,
                        EmailOTP,
                        EmailOTP.user_id,
                        user_id,
                    ) == 1,
                )

                check(
                    "Registration activity recorded",
                    count_for_user(
                        connection,
                        ActivityLog,
                        ActivityLog.user_id,
                        user_id,
                    ) >= 1,
                )

                # FIX: Select columns rather than expecting a User object
                # from a SQLAlchemy Core Connection.
                status, is_verified = connection.execute(
                    select(
                        User.account_status,
                        User.is_email_verified,
                    ).where(User.id_number == user_id)
                ).one()

                check(
                    "Account remains inactive",
                    status == "inactive" and is_verified is False,
                )

                check(
                    "Internal delivery ID matches",
                    delivery.user_id == user_id,
                )

                check(
                    "Outer transaction still active",
                    outer.is_active,
                )

            finally:
                if outer.is_active:
                    outer.rollback()
                    print("Temporary transaction rolled back: True")
                else:
                    raise RuntimeError(
                        "Outer transaction ended unexpectedly."
                    )

    except Exception as exc:
        error = exc
        print("Integration test failed:", type(exc).__name__)

        db_error = getattr(exc, "orig", None)

        if db_error is not None:
            print(
                "PostgreSQL SQLSTATE:",
                getattr(db_error, "sqlstate", "unavailable"),
            )

            diag = getattr(db_error, "diag", None)

            if diag is not None:
                print(
                    "Failed constraint:",
                    getattr(diag, "constraint_name", None),
                )

        # Do not print raw SQL errors: they may contain personal information.

    if user_id is not None:
        try:
            with engine.connect() as connection:
                remaining = count_for_user(
                    connection,
                    User,
                    User.id_number,
                    user_id,
                )

            check(
                "Temporary account rolled back",
                remaining == 0,
            )

        except Exception as exc:
            print(
                "Rollback verification failed:",
                type(exc).__name__,
            )
            return 1

    print("Email sent: NO")

    if error is not None:
        return 1

    print("RESULT: PASS - Registration transaction test succeeded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
