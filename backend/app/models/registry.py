
"""LabGear Step 35: register all existing SQLAlchemy ORM models.

Import this module in future application/database setup code before using
Base.metadata or relationships. This module performs no schema migration.

Run `python -m app.models.registry` from the backend directory to perform
read-only registration and database-existence checks.
"""

from sqlalchemy import inspect, text
from sqlalchemy.orm import configure_mappers

from app.db.base import Base
from app.db.database import engine

from app.models.user import User
from app.models.auth import UserSecurityAnswer, EmailOTP, PasswordHistory
from app.models.security import ActivityLog, IPBlock, SecurityFlag
from app.models.inventory import (
    EquipmentCategory,
    Equipment,
    EquipmentUnit,
    equipment_stock_summary,
)
from app.models.reservations import (
    Reservation,
    ReservationDecision,
    ReservationUnit,
    EquipmentIssuance,
    EquipmentReturn,
    DamageReport,
)


ALL_MODELS = (
    User,
    UserSecurityAnswer,
    EmailOTP,
    PasswordHistory,
    ActivityLog,
    IPBlock,
    SecurityFlag,
    EquipmentCategory,
    Equipment,
    EquipmentUnit,
    Reservation,
    ReservationDecision,
    ReservationUnit,
    EquipmentIssuance,
    EquipmentReturn,
    DamageReport,
)

EXPECTED_TABLES = frozenset(
    {
        "users",
        "user_security_answers",
        "email_otps",
        "password_history",
        "activity_logs",
        "ip_blocks",
        "security_flags",
        "equipment_categories",
        "equipment",
        "equipment_units",
        "reservations",
        "reservation_decisions",
        "reservation_units",
        "equipment_issuances",
        "equipment_returns",
        "damage_reports",
    }
)


def check_model_registration() -> None:
    """Raise if expected models, tables, or FK references are missing."""
    configure_mappers()

    model_tables = {model.__table__.name for model in ALL_MODELS}
    metadata_tables = {table.name for table in Base.metadata.tables.values()}

    if len(ALL_MODELS) != len(model_tables):
        raise RuntimeError("Two or more ORM models map the same table.")

    missing_models = EXPECTED_TABLES - model_tables
    missing_metadata = EXPECTED_TABLES - metadata_tables
    if missing_models or missing_metadata:
        raise RuntimeError(
            "Missing model tables: "
            f"{sorted(missing_models)}; "
            "missing from Base.metadata: "
            f"{sorted(missing_metadata)}"
        )

    if "equipment_stock_summary" in metadata_tables:
        raise RuntimeError(
            "Stock summary VIEW must not be registered as a normal ORM table."
        )

    if equipment_stock_summary.metadata is Base.metadata:
        raise RuntimeError(
            "Stock summary VIEW must use metadata separate from Base.metadata."
        )

    # Resolving each FK target catches missing referenced model imports.
    for model in ALL_MODELS:
        for column in model.__table__.columns:
            for foreign_key in column.foreign_keys:
                _ = foreign_key.column


def main() -> int:
    print("LabGear Model Registry - Step 35")
    print("READ-ONLY: No tables or records will be changed.")

    try:
        check_model_registration()
        print(f"PASS: {len(ALL_MODELS)} ORM models registered.")
        print("PASS: All mapped foreign-key targets resolved.")
        print("PASS: Stock summary view excluded from Base.metadata.")

        inspector = inspect(engine)
        database_tables = set(inspector.get_table_names(schema="public"))
        missing_database_tables = EXPECTED_TABLES - database_tables
        database_views = set(inspector.get_view_names(schema="public"))

        if missing_database_tables:
            raise RuntimeError(
                "Missing PostgreSQL tables: "
                f"{sorted(missing_database_tables)}"
            )

        if "equipment_stock_summary" not in database_views:
            raise RuntimeError("PostgreSQL stock summary view was not found.")

        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))

        print(f"PASS: {len(EXPECTED_TABLES)} required PostgreSQL tables exist.")
        print("PASS: equipment_stock_summary PostgreSQL view exists.")
        print("PASS: Read-only database connection succeeded.")
        print("RESULT: Step 35 checks passed.")
        print(
            "Not checked here: column types, indexes, database permissions, "
            "defaults, triggers, or transaction behavior."
        )
        return 0

    except Exception as exc:
        print(f"FAIL: {type(exc).__name__}: {exc}")
        print("Do not change your database. Share this error for review.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
