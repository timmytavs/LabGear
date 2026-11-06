
"""LabGear authentication configuration (Backend Step 43).

Loads three independent, persistent 256-bit secrets from the backend .env
file or process environment: email OTP HMAC, JWT signing, and AES-256-GCM
contact-number encryption. No default or development bypass keys exist.

Importing this module does not read secrets, connect to PostgreSQL, or
activate authentication. Call load_auth_settings() when configuring services.
"""

import hmac
import os
import re
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv


BACKEND_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class AuthConfigurationError(RuntimeError):
    """Required authentication secrets are missing, invalid, or reused."""


@dataclass(frozen=True, slots=True)
class AuthSettings:
    # Never include secrets in repr(), logs, or API responses.
    otp_hmac_key: bytes = field(repr=False)
    jwt_signing_key: bytes = field(repr=False)
    contact_aes_key: bytes = field(repr=False)

    # Policy values only; future FastAPI services must enforce them.
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
    """Read exactly 32 bytes encoded as 64 hexadecimal characters."""
    raw = os.environ.get(variable_name, "").strip()
    if not raw:
        raise AuthConfigurationError(
            f"Missing {variable_name}. Set it in backend .env "
            "or the process environment."
        )
    if re.fullmatch(r"[0-9a-fA-F]{64}", raw) is None:
        raise AuthConfigurationError(
            f"{variable_name} must contain exactly 64 hexadecimal "
            "characters (32 random bytes)."
        )
    return bytes.fromhex(raw)


def load_auth_settings(*, load_env_file: bool = True) -> AuthSettings:
    """Load and validate distinct OTP, JWT, and contact-encryption keys.

    Expected environment variables:
      LABGEAR_OTP_HMAC_KEY_HEX
      LABGEAR_JWT_KEY_HEX
      LABGEAR_CONTACT_AES_KEY_HEX

    .env never overrides a process environment variable. Do not rotate the
    contact-encryption key without an audited re-encryption plan: existing
    encrypted contact numbers require their original key for decryption.
    """
    if load_env_file:
        load_dotenv(dotenv_path=BACKEND_ENV_FILE, override=False)

    otp_key = _read_32_byte_hex_key("LABGEAR_OTP_HMAC_KEY_HEX")
    jwt_key = _read_32_byte_hex_key("LABGEAR_JWT_KEY_HEX")
    aes_key = _read_32_byte_hex_key("LABGEAR_CONTACT_AES_KEY_HEX")

    if (
        hmac.compare_digest(otp_key, jwt_key)
        or hmac.compare_digest(otp_key, aes_key)
        or hmac.compare_digest(jwt_key, aes_key)
    ):
        raise AuthConfigurationError(
            "OTP, JWT, and contact-encryption keys must be different "
            "random values."
        )

    return AuthSettings(
        otp_hmac_key=otp_key,
        jwt_signing_key=jwt_key,
        contact_aes_key=aes_key,
    )
