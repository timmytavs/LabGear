"""LabGear Backend File 78 — signed public-form CSRF token service.

Destination: backend/app/services/public_csrf_service.py (CREATE)

Purpose:
    Provide short-lived, HMAC-signed CSRF tokens for public browser forms
    that run before an authenticated session exists.

    This is the service layer only. The next backend files will expose the
    token endpoint and require its token on public POST routes.

Existing authenticated sessions continue using the session-bound CSRF token
from session_service.py. Do not replace that mechanism with this public token.

Security properties:
    - HMAC-SHA256 signature with a domain-separated key derived from the
      existing persistent LABGEAR_JWT_KEY_HEX.
    - Ten-minute expiration.
    - Bound to the exact trusted browser Origin that requested the token.
    - Rejects cross-site Fetch Metadata requests.
    - Uses secrets.token_urlsafe() for an unpredictable nonce.
    - Constant-time signature comparison.
    - No database writes, cookies, OTPs, or user records.
    - Does not log or expose secrets.

The token is intentionally reusable until expiration. CSRF tokens do not
authenticate users and do not replace CAPTCHA, rate limits, authentication,
authorization, or the authenticated-session CSRF checks.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import secrets
import time
from typing import Any

from app.core.auth_config import load_auth_settings


PUBLIC_CSRF_TTL_SECONDS = 10 * 60
_TOKEN_VERSION = "v1"
_MAX_TOKEN_LENGTH = 1024

_ALLOWED_BROWSER_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)

_NONCE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{40,50}$")
_BASE64URL_PATTERN = re.compile(r"^[A-Za-z0-9_-]+$")


class PublicCSRFError(ValueError):
    """A public-form CSRF token or browser origin is invalid."""


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode_base64url(value: str) -> bytes:
    if not value or _BASE64URL_PATTERN.fullmatch(value) is None:
        raise PublicCSRFError("CSRF verification failed.")

    padded = value + ("=" * (-len(value) % 4))

    try:
        return base64.b64decode(
            padded.encode("ascii"),
            altchars=b"-_",
            validate=True,
        )
    except (ValueError, UnicodeEncodeError):
        raise PublicCSRFError("CSRF verification failed.") from None


def _signing_key() -> bytes:
    """Derive a purpose-specific CSRF key without reusing the JWT key directly."""
    settings = load_auth_settings()
    return hmac.new(
        settings.jwt_signing_key,
        b"labgear:public-form-csrf:v1:key-derivation",
        hashlib.sha256,
    ).digest()


def validate_public_browser_origin(
    *,
    origin: str | None,
    sec_fetch_site: str | None = None,
) -> str:
    """Validate browser-origin metadata and return the token-bound origin.

    Browser requests must use one of the exact local development origins.
    Origin-less calls are permitted for local CLI/Swagger development only.
    Cross-site browser requests are rejected even if other headers are present.
    """
    fetch_site = (sec_fetch_site or "").strip().lower()

    if fetch_site == "cross-site":
        raise PublicCSRFError("CSRF verification failed.")

    if origin is None:
        return ""

    if (
        not isinstance(origin, str)
        or origin not in _ALLOWED_BROWSER_ORIGINS
    ):
        raise PublicCSRFError("CSRF verification failed.")

    return origin


def issue_public_csrf_token(
    *,
    origin: str | None,
    sec_fetch_site: str | None = None,
    now: int | None = None,
) -> str:
    """Issue a short-lived signed token bound to a trusted browser origin."""
    token_origin = validate_public_browser_origin(
        origin=origin,
        sec_fetch_site=sec_fetch_site,
    )

    issued_at = int(time.time()) if now is None else int(now)
    expires_at = issued_at + PUBLIC_CSRF_TTL_SECONDS

    payload = {
        "v": 1,
        "iat": issued_at,
        "exp": expires_at,
        "origin": token_origin,
        "nonce": secrets.token_urlsafe(32),
    }

    encoded_payload = _encode_base64url(
        json.dumps(
            payload,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )

    signed_message = f"{_TOKEN_VERSION}.{encoded_payload}".encode("ascii")
    signature = hmac.new(
        _signing_key(),
        signed_message,
        hashlib.sha256,
    ).digest()

    return (
        f"{_TOKEN_VERSION}."
        f"{encoded_payload}."
        f"{_encode_base64url(signature)}"
    )


def verify_public_csrf_token(
    token: str | None,
    *,
    origin: str | None,
    sec_fetch_site: str | None = None,
    now: int | None = None,
) -> None:
    """Verify signature, expiration, nonce shape, and exact browser origin.

    Raises PublicCSRFError for every invalid token condition. Callers should
    return the same generic HTTP 403 response and must never log the token.
    """
    token_origin = validate_public_browser_origin(
        origin=origin,
        sec_fetch_site=sec_fetch_site,
    )

    if (
        not isinstance(token, str)
        or not token
        or len(token) > _MAX_TOKEN_LENGTH
    ):
        raise PublicCSRFError("CSRF verification failed.")

    parts = token.split(".")
    if len(parts) != 3:
        raise PublicCSRFError("CSRF verification failed.")

    version, encoded_payload, encoded_signature = parts

    if version != _TOKEN_VERSION:
        raise PublicCSRFError("CSRF verification failed.")

    payload_bytes = _decode_base64url(encoded_payload)
    supplied_signature = _decode_base64url(encoded_signature)

    if len(supplied_signature) != hashlib.sha256().digest_size:
        raise PublicCSRFError("CSRF verification failed.")

    signed_message = f"{version}.{encoded_payload}".encode("ascii")
    expected_signature = hmac.new(
        _signing_key(),
        signed_message,
        hashlib.sha256,
    ).digest()

    if not hmac.compare_digest(supplied_signature, expected_signature):
        raise PublicCSRFError("CSRF verification failed.")

    try:
        payload: Any = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise PublicCSRFError("CSRF verification failed.") from None

    if not isinstance(payload, dict):
        raise PublicCSRFError("CSRF verification failed.")

    if set(payload) != {"v", "iat", "exp", "origin", "nonce"}:
        raise PublicCSRFError("CSRF verification failed.")

    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    nonce = payload.get("nonce")

    # bool is a subclass of int in Python; explicitly reject it.
    if (
        isinstance(payload.get("v"), bool)
        or payload.get("v") != 1
        or isinstance(issued_at, bool)
        or not isinstance(issued_at, int)
        or isinstance(expires_at, bool)
        or not isinstance(expires_at, int)
        or not isinstance(nonce, str)
        or _NONCE_PATTERN.fullmatch(nonce) is None
    ):
        raise PublicCSRFError("CSRF verification failed.")

    current_time = int(time.time()) if now is None else int(now)

    if (
        issued_at > current_time + 30
        or expires_at <= current_time
        or expires_at <= issued_at
        or expires_at - issued_at != PUBLIC_CSRF_TTL_SECONDS
    ):
        raise PublicCSRFError("CSRF verification failed.")

    if payload.get("origin") != token_origin:
        raise PublicCSRFError("CSRF verification failed.")
