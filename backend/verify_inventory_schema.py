"""LabGear Step 32: read-only inventory schema verification.

Compare the existing PostgreSQL inventory tables and stock-summary view
against their SQLAlchemy definitions. No DDL or data modifications occur.
"""

from sqlalchemy import inspect
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine
from app.models.inventory import (
    EquipmentCategory,
    Equipment,
    EquipmentUnit,
    equipment_stock_summary,
)

SCHEMA = "public"
MODELS = (EquipmentCategory, Equipment, EquipmentUnit)


def describe_type(column_type):
    """Compile a SQLAlchemy column type for the active database dialect."""
    return str(column_type.compile(dialect=engine.dialect)).upper().strip()


def orm_foreign_keys(model):
    result = set()
    for column in model.__table__.columns:
        for foreign_key in column.foreign_keys:
            result.add(
                (
                    column.name,
                    foreign_key.column.table.name,
                    foreign_key.column.name,
                    (foreign_key.ondelete or "NO ACTION").upper(),
                )
            )
    return result


def postgres_foreign_keys(inspector, table_name):
    result = set()
    for foreign_key in inspector.get_foreign_keys(table_name, schema=SCHEMA):
        source_columns = foreign_key.get("constrained_columns") or []
        target_columns = foreign_key.get("referred_columns") or []
        action = (
            (foreign_key.get("options") or {}).get("ondelete")
            or "NO ACTION"
        ).upper()
        for source, target in zip(source_columns, target_columns):
            result.add(
                (source, foreign_key["referred_table"], target, action)
            )
    return result


def compare_columns(expected_columns, actual_columns, *, check_nullability):
    issues = []
    expected = {column.name: column for column in expected_columns}
    actual = {column["name"]: column for column in actual_columns}

    for name in sorted(expected.keys() - actual.keys()):
        issues.append(f"Missing PostgreSQL column: {name}")

    for name in sorted(actual.keys() - expected.keys()):
        issues.append(f"Extra PostgreSQL column: {name}")

    for name in sorted(expected.keys() & actual.keys()):
        model_column = expected[name]
        database_column = actual[name]
        expected_type = describe_type(model_column.type)
        actual_type = describe_type(database_column["type"])

        if expected_type != actual_type:
            issues.append(
                f"{name}: type model={expected_type}; database={actual_type}"
            )

        if check_nullability and model_column.nullable != database_column["nullable"]:
            issues.append(
                f"{name}: nullable model={model_column.nullable}; "
                f"database={database_column['nullable']}"
            )

    return issues, len(expected)


def verify_table(inspector, model, table_names):
    name = model.__tablename__
    print(f"\n[{name}]")

    if name not in table_names:
        print("  FAIL: Table does not exist in the public schema.")
        return False

    issues, column_count = compare_columns(
        model.__table__.columns,
        inspector.get_columns(name, schema=SCHEMA),
        check_nullability=True,
    )

    model_pk = {column.name for column in model.__table__.primary_key}
    postgres_pk = set(
        inspector.get_pk_constraint(name, schema=SCHEMA).get("constrained_columns")
        or []
    )
    if model_pk != postgres_pk:
        issues.append(
            f"Primary key differs: model={sorted(model_pk)}; "
            f"database={sorted(postgres_pk)}"
        )

    model_fks = orm_foreign_keys(model)
    db_fks = postgres_foreign_keys(inspector, name)
    for item in sorted(model_fks - db_fks):
        issues.append(f"Model foreign key missing/different in database: {item}")
    for item in sorted(db_fks - model_fks):
        issues.append(f"Database foreign key not matched by model: {item}")

    if issues:
        print(f"  MISMATCH: {len(issues)} difference(s)")
        for issue in issues:
            print(f"    - {issue}")
        return False

    print(f"  PASS: {column_count} columns, types, nullability, PK and FKs match.")
    return True


def verify_stock_view(inspector, view_names):
    name = equipment_stock_summary.name
    print(f"\n[{name} (VIEW)]")

    if name not in view_names:
        print("  FAIL: PostgreSQL view does not exist in the public schema.")
        return False

    issues, column_count = compare_columns(
        equipment_stock_summary.columns,
        inspector.get_columns(name, schema=SCHEMA),
        check_nullability=False,
    )

    if issues:
        print(f"  MISMATCH: {len(issues)} difference(s)")
        for issue in issues:
            print(f"    - {issue}")
        return False

    print(f"  PASS: {column_count} view columns and types match.")
    print("  INFO: View nullability and keys are not enforced by this test.")
    return True


def main():
    print("LabGear Inventory Schema Verification - Step 32")
    print("READ-ONLY: No database changes.")
    print(f"Database: {engine.url.database}")

    try:
        inspector = inspect(engine)
        table_names = set(inspector.get_table_names(schema=SCHEMA))
        view_names = set(inspector.get_view_names(schema=SCHEMA))

        results = [
            verify_table(inspector, model, table_names)
            for model in MODELS
        ]
        results.append(verify_stock_view(inspector, view_names))

    except (SQLAlchemyError, ValueError, AttributeError, KeyError) as exc:
        print(f"\nERROR: {exc}")
        return 1

    print("\n" + "=" * 54)
    successes = sum(results)
    print(f"RESULT: {successes}/{len(results)} inventory objects matched.")
    print("Indexes, defaults, unique/check constraints and permissions not checked.")

    if successes != len(results):
        print("Do not change PostgreSQL yet; share the mismatches for review.")
        return 1

    print("PASS: Inventory ORM mappings and stock view match checked properties.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
