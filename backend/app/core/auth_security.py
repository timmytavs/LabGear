
"""LabGear authentication security helpers (Step 36).

Use in FastAPI services after server-side validation and authorization.
This module does NOT create sessions, send emails, or modify the database.

Password and security-answer hashes use Argon2id. Email OTP digests use
HMAC-SHA256 with a secret key kept outside the database. The calling
service must enforce OTP expiry, one-time use, attempts, and resend limits.
"""

import hashlib
import hmac
import re
import secrets
import unicodedata
from collections.abc import Iterable

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


_password_hasher = PasswordHasher()

PASSWORD_MIN_LENGTH = 10
PASSWORD_MAX_LENGTH = 64
OTP_LENGTH = 6


def password_errors(password: str) -> list[str]:
    """Return password-policy errors without storing or logging the password."""
    errors = []
    if not isinstance(password, str):
        return ["Password must be text."]
    if not PASSWORD_MIN_LENGTH <= len(password) <= PASSWORD_MAX_LENGTH:
        errors.append("Password must contain 10 to 64 characters.")
    if not re.search(r"[A-Z]", password):
        errors.append("Add an uppercase letter.")
    if not re.search(r"[a-z]", password):
        errors.append("Add a lowercase letter.")
    if not re.search(r"[0-9]", password):
        errors.append("Add a number.")
    if not re.search(r"[^A-Za-z0-9]", password):
        errors.append("Add a special character.")
    return errors


def hash_password(password: str) -> str:
    """Validate and hash a new password with salted Argon2id."""
    errors = password_errors(password)
    if errors:
        raise ValueError(" ".join(errors))
    return _password_hasher.hash(password)


def verify_password(password: str, stored_hash: str) -> bool:
    """Return False for an incorrect password or malformed stored hash."""
    if not isinstance(password, str) or not isinstance(stored_hash, str):
        return False
    try:
        return bool(_password_hasher.verify(stored_hash, password))
    except (VerificationError, InvalidHashError):
        return False


def password_was_used(password: str, previous_hashes: Iterable[str]) -> bool:
    """Check a proposed password against server-retrieved password history."""
    return any(verify_password(password, item) for item in previous_hashes)


def _normalized_answer(answer: str) -> str:
    if not isinstance(answer, str):
        raise ValueError("Security answer must be text.")
    normalized = unicodedata.normalize("NFKC", answer).strip().casefold()
    if not normalized:
        raise ValueError("Security answer cannot be empty.")
    return normalized


def hash_security_answer(answer: str) -> str:
    """Hash a normalized answer (never store plaintext security answers)."""
    return _password_hasher.hash(_normalized_answer(answer))


def verify_security_answer(answer: str, stored_hash: str) -> bool:
    """Verify a normalized answer without leaking a plaintext answer."""
    try:
        normalized = _normalized_answer(answer)
    except ValueError:
        return False
    return verify_password(normalized, stored_hash)


def generate_email_otp() -> str:
    """Generate a cryptographically secure, zero-padded 6-digit code."""
    return f"{secrets.randbelow(10 ** OTP_LENGTH):0{OTP_LENGTH}d}"


def _validate_otp_context(
    otp: str, user_id: str, purpose: str, secret_key: bytes
) -> None:
    if not isinstance(otp, str) or re.fullmatch(r"[0-9]{6}", otp) is None:
        raise ValueError("OTP must be exactly six digits.")
    if not isinstance(user_id, str) or re.fullmatch(r"[0-9]{4}-[0-9]{4}", user_id) is None:
        raise ValueError("User ID must follow 0000-0000 format.")
    if not isinstance(purpose, str) or re.fullmatch(r"[a-z][a-z0-9_]{0,19}", purpose) is None:
        raise ValueError("Invalid OTP purpose.")
    if not isinstance(secret_key, bytes) or len(secret_key) < 32:
        raise ValueError("OTP signing key must contain at least 32 random bytes.")


def hash_email_otp(
    otp: str, user_id: str, purpose: str, secret_key: bytes
) -> str:
    """Return a keyed OTP digest bound to one account and one purpose.

    Obtain secret_key from a private, persistent environment setting in the
    future API service. Never save that key, or the OTP, in PostgreSQL.
    """
    _validate_otp_context(otp, user_id, purpose, secret_key)
    message = f"labgear-email-otp-v1|{user_id}|{purpose}|{otp}".encode("utf-8")
    return hmac.new(secret_key, message, hashlib.sha256).hexdigest()


def verify_email_otp(
    otp: str,
    stored_digest: str,
    user_id: str,
    purpose: str,
    secret_key: bytes,
) -> bool:
    """Verify a keyed digest; expiry/attempt/use checks belong to the API."""
    if not isinstance(stored_digest, str) or re.fullmatch(r"[a-f0-9]{64}", stored_digest) is None:
        return False
    if not isinstance(otp, str) or re.fullmatch(r"[0-9]{6}", otp) is None:
        return False
    candidate = hash_email_otp(otp, user_id, purpose, secret_key)
    return hmac.compare_digest(candidate, stored_digest)
