
"""LabGear authentication configuration (Backend Step 37).

Reads persistent signing keys from the backend's .env file or process
environment. No default signing keys are provided, including in development.

Importing this module does not read secrets, connect to PostgreSQL, create
sessions, or enable authentication. Call load_auth_settings() from the future
FastAPI application startup/authentication service.
"""

import hmac
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class AuthConfigurationError(RuntimeError):
    """Raised when required authentication secrets are missing or unsafe."""


@dataclass(frozen=True, slots=True)
class AuthSettings:
    # Never include signing keys in repr(), logs, or API responses.
    otp_hmac_key: bytes = field(repr=False)
    jwt_signing_key: bytes = field(repr=False)

    # These are policy configuration values, NOT enforcement by themselves.
    jwt_algorithm: str = "HS256"
    otp_expiry_seconds: int = 180
    otp_max_failed_attempts: int = 3
    otp_resend_cooldown_seconds: int = 60
    otp_max_resends_in_15_minutes: int = 3
    session_idle_timeout_seconds: int = 9 * 60
    login_lockout_seconds: tuple[int, int, int] = (24, 48, 96)
    ip_failure_window_seconds: int = 10 * 60
    ip_block_threshold: int = 14


def _read_32_byte_hex_key(variable_name: str) -> bytes:
    """Read a strictly formatted 256-bit key; never fall back to a demo key."""
    raw = os.environ.get(variable_name, "").strip()
    if not raw:
        raise AuthConfigurationError(
            f"Missing {variable_name}. Set it in the backend .env file "
            "or in the process environment."
        )
    if re.fullmatch(r"[0-9a-fA-F]{64}", raw) is None:
        raise AuthConfigurationError(
            f"{variable_name} must contain exactly 64 hexadecimal characters "
            "(32 random bytes)."
        )
    return bytes.fromhex(raw)


def load_auth_settings(*, load_env_file: bool = True) -> AuthSettings:
    """Load and validate separate, persistent OTP and JWT signing keys.

    Set LABGEAR_OTP_HMAC_KEY_HEX and LABGEAR_JWT_KEY_HEX to independent
    values generated with secrets.token_hex(32). Values loaded from .env
    never override an already-set operating-system environment variable.

    The future API must enforce OTP expiry, attempts, one-time use, resend
    limits, session inactivity, progressive lockouts, and IP blocking.
    """
    if load_env_file:
        load_dotenv(dotenv_path=BACKEND_ENV_FILE, override=False)

    otp_key = _read_32_byte_hex_key("LABGEAR_OTP_HMAC_KEY_HEX")
    jwt_key = _read_32_byte_hex_key("LABGEAR_JWT_KEY_HEX")

    if hmac.compare_digest(otp_key, jwt_key):
        raise AuthConfigurationError(
            "OTP and JWT signing keys must be different random values."
        )

    return AuthSettings(
        otp_hmac_key=otp_key,
        jwt_signing_key=jwt_key,
    )
