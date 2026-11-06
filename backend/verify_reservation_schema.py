
"""LabGear Step 34: read-only verification of reservation SQLAlchemy models.

Compares six existing PostgreSQL tables with their ORM mappings.
It performs inspection only: no CREATE, ALTER, INSERT, UPDATE, or DELETE.
"""

from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine

# Import referenced models so SQLAlchemy can resolve the foreign keys.
from app.models.user import User  # noqa: F401
from app.models.inventory import Equipment, EquipmentUnit  # noqa: F401
from app.models.reservations import (
    Reservation,
    ReservationDecision,
    ReservationUnit,
    EquipmentIssuance,
    EquipmentReturn,
    DamageReport,
)


SCHEMA = "public"
MODELS = (
    Reservation,
    ReservationDecision,
    ReservationUnit,
    EquipmentIssuance,
    EquipmentReturn,
    DamageReport,
)


def formatted_type(column_type):
    """Get comparable PostgreSQL type names from SQLAlchemy types."""
    return str(column_type.compile(dialect=engine.dialect)).upper().strip()


def orm_foreign_keys(model):
    """Return (local column, target table, target column, ondelete)."""
    keys = set()
    for column in model.__table__.columns:
        for fk in column.foreign_keys:
            keys.add(
                (
                    column.name,
                    fk.column.table.name,
                    fk.column.name,
                    (fk.ondelete or "NO ACTION").upper(),
                )
            )
    return keys


def postgres_foreign_keys(inspector, table_name):
    """Get equivalent tuples from the real PostgreSQL constraints."""
    keys = set()
    for fk in inspector.get_foreign_keys(table_name, schema=SCHEMA):
        source_columns = fk.get("constrained_columns") or []
        target_columns = fk.get("referred_columns") or []
        target_table = fk["referred_table"]
        action = (
            (fk.get("options") or {}).get("ondelete") or "NO ACTION"
        ).upper()

        for local, remote in zip(source_columns, target_columns):
            keys.add((local, target_table, remote, action))
    return keys


def verify_table(inspector, model, existing_tables):
    table_name = model.__tablename__
    print(f"\n[{table_name}]")

    if table_name not in existing_tables:
        print("  FAIL: Table not found in the public schema.")
        return False

    orm_columns = {
        column.name: column
        for column in model.__table__.columns
    }
    db_columns = {
        column["name"]: column
        for column in inspector.get_columns(
            table_name, schema=SCHEMA
        )
    }
    differences = []

    for name in sorted(orm_columns.keys() - db_columns.keys()):
        differences.append(f"Missing database column: {name}")

    for name in sorted(db_columns.keys() - orm_columns.keys()):
        differences.append(
            f"Database column not mapped in Python: {name}"
        )

    for name in sorted(orm_columns.keys() & db_columns.keys()):
        model_column = orm_columns[name]
        database_column = db_columns[name]

        model_type = formatted_type(model_column.type)
        db_type = formatted_type(database_column["type"])

        if model_type != db_type:
            differences.append(
                f"{name}: type model={model_type}; "
                f"database={db_type}"
            )

        if model_column.nullable != database_column["nullable"]:
            differences.append(
                f"{name}: nullable model={model_column.nullable}; "
                f"database={database_column['nullable']}"
            )

    model_pk = {
        column.name
        for column in model.__table__.primary_key
    }
    database_pk = set(
        inspector.get_pk_constraint(
            table_name, schema=SCHEMA
        ).get("constrained_columns") or []
    )

    if model_pk != database_pk:
        differences.append(
            f"Primary key model={sorted(model_pk)}; "
            f"database={sorted(database_pk)}"
        )

    expected_fks = orm_foreign_keys(model)
    actual_fks = postgres_foreign_keys(inspector, table_name)

    for fk in sorted(expected_fks - actual_fks):
        differences.append(
            f"Model foreign key missing/different in database: {fk}"
        )

    for fk in sorted(actual_fks - expected_fks):
        differences.append(
            f"Database foreign key not matched by model: {fk}"
        )

    if differences:
        print(f"  MISMATCH: {len(differences)} difference(s)")
        for difference in differences:
            print(f"    - {difference}")
        return False

    print(
        f"  PASS: {len(orm_columns)} columns; "
        "types, nullability, primary key and foreign keys match."
    )
    return True


def main():
    print("LabGear Reservation Schema Verification - Step 34")
    print("READ-ONLY: No database changes.")
    print(f"Database: {engine.url.database}")

    try:
        inspector = inspect(engine)
        existing_tables = set(
            inspector.get_table_names(schema=SCHEMA)
        )
        results = [
            verify_table(inspector, model, existing_tables)
            for model in MODELS
        ]
    except (
        SQLAlchemyError,
        ValueError,
        AttributeError,
        KeyError,
    ) as exc:
        print(f"\nERROR: {exc}")
        return 1

    passed = sum(results)
    print("\n" + "=" * 56)
    print(f"RESULT: {passed}/{len(MODELS)} reservation tables matched.")
    print(
        "Not checked: indexes, UNIQUE/CHECK constraints, defaults, "
        "identity settings, triggers and permissions."
    )

    if passed != len(MODELS):
        print(
            "Do not change PostgreSQL yet. Review the differences first."
        )
        return 1

    print("PASS: All six reservation/transaction model mappings matched.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
