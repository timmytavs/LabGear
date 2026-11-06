
"""Read-only LabGear SQLAlchemy schema verification."""

from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine
from app.models.user import User
from app.models.auth import (
    UserSecurityAnswer,
    EmailOTP,
    PasswordHistory,
)
from app.models.security import (
    ActivityLog,
    IPBlock,
    SecurityFlag,
)

MODELS = (
    User,
    UserSecurityAnswer,
    EmailOTP,
    PasswordHistory,
    ActivityLog,
    IPBlock,
    SecurityFlag,
)


def normalized_type(column_type):
    return str(
        column_type.compile(dialect=engine.dialect)
    ).upper().strip()


def model_foreign_keys(model):
    keys = set()

    for column in model.__table__.columns:
        for fk in column.foreign_keys:
            keys.add((
                column.name,
                fk.column.table.name,
                fk.column.name,
                (fk.ondelete or "NO ACTION").upper(),
            ))

    return keys


def db_foreign_keys(inspector, table_name):
    keys = set()

    for fk in inspector.get_foreign_keys(
        table_name, schema="public"
    ):
        sources = fk.get("constrained_columns") or []
        targets = fk.get("referred_columns") or []
        action = (
            (fk.get("options") or {}).get("ondelete")
            or "NO ACTION"
        )

        for source, target in zip(sources, targets):
            keys.add((
                source,
                fk["referred_table"],
                target,
                action.upper(),
            ))

    return keys


def inspect_model(inspector, model, existing_tables):
    table_name = model.__tablename__
    print(f"\n[{table_name}]")

    if table_name not in existing_tables:
        print("  FAIL: Table missing from public schema.")
        return 1

    expected = {
        column.name: column
        for column in model.__table__.columns
    }

    actual = {
        column["name"]: column
        for column in inspector.get_columns(
            table_name, schema="public"
        )
    }

    problems = []

    for name in sorted(expected.keys() - actual.keys()):
        problems.append(
            f"Model column missing from database: {name}"
        )

    for name in sorted(actual.keys() - expected.keys()):
        problems.append(
            f"Database column not in model: {name}"
        )

    for name in sorted(expected.keys() & actual.keys()):
        model_column = expected[name]
        db_column = actual[name]

        model_type = normalized_type(model_column.type)
        db_type = normalized_type(db_column["type"])

        if model_type != db_type:
            problems.append(
                f"{name}: type model={model_type}, "
                f"database={db_type}"
            )

        if model_column.nullable != db_column["nullable"]:
            problems.append(
                f"{name}: nullable model="
                f"{model_column.nullable}, "
                f"database={db_column['nullable']}"
            )

    model_pk = {
        column.name
        for column in model.__table__.primary_key
    }

    db_pk = set(
        inspector.get_pk_constraint(
            table_name, schema="public"
        ).get("constrained_columns") or []
    )

    if model_pk != db_pk:
        problems.append(
            f"Primary key model={sorted(model_pk)}, "
            f"database={sorted(db_pk)}"
        )

    model_fks = model_foreign_keys(model)
    database_fks = db_foreign_keys(
        inspector, table_name
    )

    for fk in sorted(model_fks - database_fks):
        problems.append(
            f"Foreign key missing/different: {fk}"
        )

    for fk in sorted(database_fks - model_fks):
        problems.append(
            f"Database foreign key not matched: {fk}"
        )

    if problems:
        print(f"  MISMATCH: {len(problems)} difference(s)")

        for problem in problems:
            print(f"    - {problem}")

        return 1

    print(
        f"  PASS: {len(expected)} columns; "
        "types, nullability, PK, and FKs match."
    )
    return 0


def main():
    print("LabGear Schema Verification")
    print("READ-ONLY: No database changes.")
    print(f"Database: {engine.url.database}")

    try:
        inspector = inspect(engine)

        existing_tables = set(
            inspector.get_table_names(schema="public")
        )

        failures = sum(
            inspect_model(
                inspector, model, existing_tables
            )
            for model in MODELS
        )

    except (SQLAlchemyError, ValueError, AttributeError) as exc:
        print(f"\nERROR: {exc}")
        return 1

    print("\n" + "=" * 50)

    if failures:
        print(
            f"RESULT: {failures} table(s) "
            "have differences."
        )
        print(
            "Do not change PostgreSQL yet. "
            "Review the differences first."
        )
        return 1

    print(
        f"RESULT: PASS - all {len(MODELS)} "
        "tables matched the checked properties."
    )
    print(
        "Defaults, indexes, check constraints, "
        "and permissions were not checked."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
