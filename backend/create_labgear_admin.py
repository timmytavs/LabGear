
"""LabGear Step 91: one-time, LOCAL database administrator provisioning.

CREATE: backend/create_labgear_admin.py
Run from the backend directory with its virtual environment activated:
    python create_labgear_admin.py

This is a command-line maintenance script, not an API route. It creates a
new database-provisioned administrator, never promotes public registrations.
It asks for an authorized local PostgreSQL owner password via getpass and
never stores it in source, .env, files, logs, or command-line arguments.

Uses LabGear's existing Argon2id password / security-answer hashing and
AES-256-GCM contact-number encryption. Adds password history and one audit
entry in the same transaction. Login still requires genuine Gmail OTP.

For local development only; do not expose as an HTTP endpoint or commit
credentials. Do not run this against production.
"""

from __future__ import annotations

import ipaddress
import re
import sys
from datetime import date, datetime, timezone
from getpass import getpass

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import create_engine, func, or_, select
from sqlalchemy.engine import URL
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.auth_config import AuthConfigurationError, load_auth_settings
from app.core.auth_security import (
    hash_password,
    hash_security_answer,
    password_errors,
)
from app.models.auth import PasswordHistory, UserSecurityAnswer
from app.models.security import ActivityLog
from app.models.user import User
from app.services.registration_service import encrypt_contact_number


DB_NAME = "labgear_db"
DB_HOST = "127.0.0.1"
DB_OWNER = "postgres"
_USERNAME = re.compile(r"[A-Za-z][A-Za-z0-9]{5,16}\Z")
_ACCOUNT_ID = re.compile(r"[0-9]{4}-[0-9]{4}\Z")
_ANSWER = re.compile(r"[A-Za-z]+(?: [A-Za-z]+)*\Z")
_PHONE = re.compile(r"09[0-9]{9}\Z")
_NAME = re.compile(r"[A-Za-z][A-Za-z .'-]*\Z")


class SetupStopped(Exception):
    """Safe, human-readable preflight or input failure."""


def _ask(label: str, *, default: str | None = None, limit: int = 100) -> str:
    suffix = f" [{default}]" if default is not None else ""
    raw = input(f"{label}{suffix}: ").strip()
    result = raw or (default if default is not None else "")
    if not result or len(result) > limit or any(ord(ch) < 32 for ch in result):
        raise SetupStopped(f"Invalid or missing value for {label}.")
    return result


def _ask_name(label: str) -> str:
    value = _ask(label, limit=26)
    if len(value) < 2 or not _NAME.fullmatch(value):
        raise SetupStopped(f"{label} must contain 2–26 valid name characters.")
    return value


def _ask_answer(label: str) -> str:
    value = getpass(f"{label} (hidden): ").strip()
    if not 2 <= len(value) <= 50 or not _ANSWER.fullmatch(value):
        raise SetupStopped("Security answers must use 2–50 letters and single spaces.")
    return value


def _ask_password() -> str:
    value = getpass("New ADMIN password (hidden): ")
    problems = password_errors(value)
    if problems:
        raise SetupStopped("Admin password rejected by LabGear's password policy: " + " ".join(problems))
    confirm = getpass("Re-enter ADMIN password (hidden): ")
    if value != confirm:
        raise SetupStopped("Admin password confirmation does not match.")
    return value


def _birthdate(value: str) -> date:
    try:
        birthday = date.fromisoformat(value)
    except ValueError:
        raise SetupStopped("Birthdate must be YYYY-MM-DD.") from None
    today = datetime.now(timezone.utc).date()
    if birthday > date(today.year - 18, today.month, today.day):
        raise SetupStopped("The administrator must be at least 18 years old.")
    if birthday.year < 1900:
        raise SetupStopped("Invalid administrator birthdate.")
    return birthday


def _email(value: str) -> str:
    try:
        normalized = validate_email(value, check_deliverability=False).normalized
    except EmailNotValidError:
        raise SetupStopped("Enter a valid administrator email address.") from None
    if len(normalized) > 100:
        raise SetupStopped("Administrator email is too long.")
    return normalized


def _collect() -> dict:
    print("\nLabGear Step 91 — Create a NEW local administrator")
    print("Only use an email inbox you control: login OTP will be sent there.")
    print("Do NOT send your passwords or security answers to anyone.\n")

    user_id = _ask("Admin ID (YYYY-NNNN)", default="2026-9001", limit=9)
    if not _ACCOUNT_ID.fullmatch(user_id):
        raise SetupStopped("Admin ID must follow YYYY-NNNN (for example, 2026-9001).")

    username = _ask("Admin username", default="labadmin", limit=17)
    if not _USERNAME.fullmatch(username):
        raise SetupStopped("Username must start with a letter and use 6–17 letters/digits.")

    email = _email(_ask("Admin Gmail/email address", limit=100))
    first_name = _ask_name("Admin first name")
    family_name = _ask_name("Admin family name")
    birthday = _birthdate(_ask("Birthdate (YYYY-MM-DD)", limit=10))
    phone = _ask("Contact number (09XXXXXXXXX)", limit=11)
    if not _PHONE.fullmatch(phone):
        raise SetupStopped("Contact number must be 11 digits and start with 09.")

    address = {
        "purok_street": _ask("Street/address", limit=50),
        "barangay": _ask("Barangay", limit=50),
        "municipality_city": _ask("City/municipality", limit=50),
        "province": _ask("Province", limit=50),
        "country": _ask("Country", default="Philippines", limit=50),
        "zip_code": _ask("ZIP code (4 digits)", limit=4),
    }
    if not re.fullmatch(r"[0-9]{4}", address["zip_code"]):
        raise SetupStopped("ZIP code must be 4 digits.")

    department = _ask("Department", default="Laboratory Administration", limit=80)
    unit = _ask("Class/section/unit", default="ADMIN", limit=100)
    password = _ask_password()

    answers = {
        "Q7": _ask_answer("Q7: Elementary school name"),
        "Q2": _ask_answer("Q2: Elementary school best friend"),
        "Q4": _ask_answer("Q4: Mother's maiden first name"),
    }
    print("\nAdmin username:", username)
    print("Admin email:", email)
    print("This owner-provisioned account will be activated and marked email-verified.")
    print("Only proceed if you are authorized AND control the above email inbox.")
    confirmation = input("Type CREATE ADMIN to commit a new admin account: ").strip()
    if confirmation != "CREATE ADMIN":
        raise SetupStopped("Cancelled before any database modification.")

    return {
        "id_number": user_id,
        "username": username,
        "email": email,
        "first_name": first_name,
        "family_name": family_name,
        "birthdate": birthday,
        "contact_number": phone,
        "department": department,
        "class_section_or_unit": unit,
        "password": password,
        "answers": answers,
        **address,
    }


def _provision(details: dict, *, port: int, owner_password: str) -> None:
    try:
        settings = load_auth_settings()
    except AuthConfigurationError:
        raise SetupStopped("LabGear auth keys are not configured in backend/.env.") from None

    db_url = URL.create(
        drivername="postgresql+psycopg",
        username=DB_OWNER,
        password=owner_password,
        host=DB_HOST,
        port=port,
        database=DB_NAME,
    )
    db_engine = create_engine(db_url, pool_pre_ping=True, echo=False, connect_args={"connect_timeout": 8})
    try:
        now = datetime.now(timezone.utc)
        encrypted_phone, nonce = encrypt_contact_number(
            details["contact_number"], details["id_number"], settings.contact_aes_key
        )
        password_digest = hash_password(details["password"])
        answer_hashes = {
            code: hash_security_answer(answer)
            for code, answer in details["answers"].items()
        }

        with Session(db_engine) as db, db.begin():
            database_name = db.execute(select(func.current_database())).scalar_one()
            if database_name != DB_NAME:
                raise SetupStopped("Refusing to modify an unexpected database.")

            current_admin = db.execute(
                select(User.id_number).where(func.lower(User.role) == "admin").limit(1)
            ).first()
            if current_admin is not None:
                raise SetupStopped("An admin account already exists. No second admin was created.")

            conflict = db.execute(
                select(User.id_number).where(
                    or_(
                        User.id_number == details["id_number"],
                        func.lower(User.username) == details["username"].lower(),
                        func.lower(User.email) == details["email"].lower(),
                    )
                ).limit(1)
            ).first()
            if conflict is not None:
                raise SetupStopped("The requested ID, username, or email already belongs to an account.")

            account = User(
                id_number=details["id_number"],
                first_name=details["first_name"],
                middle_name=None,
                family_name=details["family_name"],
                name_extension=None,
                birthdate=details["birthdate"],
                purok_street=details["purok_street"],
                barangay=details["barangay"],
                municipality_city=details["municipality_city"],
                province=details["province"],
                country=details["country"],
                zip_code=details["zip_code"],
                email=details["email"],
                username=details["username"],
                password_hash=password_digest,
                role="admin",
                department=details["department"],
                contact_number_encrypted=encrypted_phone,
                contact_number_iv=nonce,
                class_section_or_unit=details["class_section_or_unit"],
                is_email_verified=True,
                account_status="active",
                failed_login_attempts=0,
                locked_until=None,
                privacy_consent_at=now,
            )
            db.add(account)
            db.flush()

            db.add_all(
                UserSecurityAnswer(
                    user_id=details["id_number"], question_code=code, answer_hash=digest
                ) for code, digest in answer_hashes.items()
            )
            db.add(PasswordHistory(user_id=details["id_number"], password_hash=password_digest))
            db.add(ActivityLog(
                event_type="admin_account_provisioned",
                username_typed=details["username"],
                user_id=details["id_number"],
                details={"source": "local_database_owner", "role": "admin"},
            ))
            db.flush()
    finally:
        db_engine.dispose()


def main() -> int:
    try:
        if not sys.stdin.isatty():
            raise SetupStopped("Run this script interactively from PowerShell, not from a pipe.")
        if not ipaddress.ip_address(DB_HOST).is_loopback:
            raise SetupStopped("Only localhost PostgreSQL provisioning is permitted.")

        port_text = _ask("Local PostgreSQL port", default="5432", limit=5)
        try:
            port = int(port_text)
        except ValueError:
            raise SetupStopped("Port must be numeric.") from None
        if not 1 <= port <= 65535:
            raise SetupStopped("Invalid PostgreSQL port.")

        details = _collect()
        owner_password = getpass("Local postgres database-owner password (hidden): ")
        if not owner_password:
            raise SetupStopped("Database-owner password is required.")
        _provision(details, port=port, owner_password=owner_password)
        print("\nSUCCESS: Dedicated LabGear admin account created in labgear_db.")
        print("Role: admin | Status: active | Email verified: true")
        print("Use the normal LabGear login. Gmail OTP is still REQUIRED.")
        return 0
    except SetupStopped as error:
        print(f"\nNOT CREATED: {error}")
        return 1
    except SQLAlchemyError as error:
        original = getattr(error, "orig", None)
        diag = getattr(original, "diag", None)
        sqlstate = getattr(original, "sqlstate", None) or "unknown"
        constraint = getattr(diag, "constraint_name", None) or "unavailable"
        print("\nNOT CREATED: PostgreSQL rejected the operation; transaction rolled back.")
        print(f"SQLSTATE: {sqlstate}; constraint: {constraint}")
        print("Check local database-owner password, users.role constraints, and schema compatibility.")
        return 1
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled; no new account was committed.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
