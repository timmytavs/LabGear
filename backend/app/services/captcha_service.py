
"""LabGear Backend Step 45: server-side reCAPTCHA v2 Checkbox verification.

Google's legacy SiteVerify endpoint validates the response token. This
module checks Google's success result AND the hostname reported by Google.

There is no test-mode bypass, and there are no fallback secrets. Missing
configuration raises CaptchaConfigurationError. Network failures, invalid
responses, and untrusted hostnames fail closed (return False).

This module does not connect to PostgreSQL or expose a FastAPI route.
"""

import json
import os
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from dotenv import load_dotenv

from app.core.auth_config import BACKEND_ENV_FILE


SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify"
REQUEST_TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 16_384
MAX_TOKEN_LENGTH = 4096


class CaptchaConfigurationError(RuntimeError):
    """reCAPTCHA cannot be used safely with the current server settings."""


def _read_captcha_configuration() -> tuple[str, frozenset[str]]:
    """Read the server-only secret and allowed browser hostnames.

    Localhost is not automatically trusted; it must be explicitly configured
    with a development reCAPTCHA key. Do not include localhost in production.
    """
    load_dotenv(dotenv_path=BACKEND_ENV_FILE, override=False)

    secret = os.environ.get("LABGEAR_RECAPTCHA_SECRET_KEY", "").strip()
    hostname_list = os.environ.get(
        "LABGEAR_RECAPTCHA_ALLOWED_HOSTNAMES", ""
    ).strip()

    if not secret or not hostname_list:
        raise CaptchaConfigurationError(
            "Missing reCAPTCHA server secret or allowed-hostname configuration."
        )

    hostnames = frozenset(
        hostname.strip().lower()
        for hostname in hostname_list.split(",")
    )

    # Only plain hostnames: never URLs, wildcard domains, or host:port pairs.
    if not hostnames or any(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", host)
        is None
        or ".." in host
        for host in hostnames
    ):
        raise CaptchaConfigurationError(
            "Allowed reCAPTCHA hostnames must be explicit hostnames "
            "without schemes, ports, or wildcards."
        )

    return secret, hostnames


def verify_registration_captcha(captcha_token: str) -> bool:
    """Verify a browser token with Google before accepting registration.

    Intended for the Step 44 register_pending_user(..., verify_captcha=...)
    callback once a complete registration API and email OTP flow exist.
    Never trust the browser's claim that CAPTCHA has passed.

    True requires all of:
      * A nonempty token with a plausible length and no whitespace.
      * Google's siteverify endpoint returning HTTP 200 and success=true.
      * Google's reported hostname exactly matching a server allowlist entry.

    Google handles token expiry (two minutes) and one-time use. This service
    also handles network/response errors without allowing registration.
    """
    if (
        not isinstance(captcha_token, str)
        or not 1 <= len(captcha_token) <= MAX_TOKEN_LENGTH
        or any(character.isspace() for character in captcha_token)
    ):
        return False

    secret, trusted_hostnames = _read_captcha_configuration()

    request = Request(
        SITEVERIFY_URL,
        data=urlencode(
            {"secret": secret, "response": captcha_token}
        ).encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                return False
            content = response.read(MAX_RESPONSE_BYTES + 1)
    except (HTTPError, URLError, OSError, TimeoutError, ValueError):
        return False

    if len(content) > MAX_RESPONSE_BYTES:
        return False

    try:
        result = json.loads(content)
    except (ValueError, UnicodeError):
        return False

    if not isinstance(result, dict) or result.get("success") is not True:
        return False

    verified_hostname = result.get("hostname")
    return (
        isinstance(verified_hostname, str)
        and verified_hostname.lower() in trusted_hostnames
    )
