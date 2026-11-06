
"""LabGear Backend Step 48: secure registration OTP email delivery.

This service sends an already-issued registration OTP using SMTP over TLS
(SMTP_SSL, port 465). It does not generate OTPs, alter PostgreSQL records,
or expose any FastAPI routes. SMTP configuration will be added to the
private backend .env in a later step.

Security properties:
- No hardcoded credentials, fallback credentials, or plaintext SMTP.
- Validates the sender and recipient; rejects expired or malformed OTPs.
- Uses the system's trusted certificate authorities to verify the server.
- Never prints or returns the OTP, SMTP password, or raw SMTP errors.
- Does not retry delivery automatically; retries must follow OTP policy.
"""

import os
import re
import ssl
import smtplib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.message import EmailMessage

from dotenv import load_dotenv
from email_validator import EmailNotValidError, validate_email

from app.core.auth_config import BACKEND_ENV_FILE
from app.services.registration_service import PendingRegistration


SMTP_SSL_PORT = 465
SMTP_TIMEOUT_SECONDS = 10
MIN_OTP_REMAINING_SECONDS = 15


class EmailConfigurationError(RuntimeError):
    """SMTP settings are missing or unsafe."""


class EmailDeliveryError(RuntimeError):
    """The message was not confirmed sent; caller must handle failure safely."""


@dataclass(frozen=True, slots=True)
class SMTPSettings:
    host: str
    username: str = field(repr=False)
    password: str = field(repr=False)
    from_email: str
    port: int = SMTP_SSL_PORT


def _validated_email(value: str) -> str:
    try:
        return validate_email(value, check_deliverability=False).normalized
    except (EmailNotValidError, TypeError, ValueError):
        raise ValueError("Invalid email address.") from None


def load_smtp_settings() -> SMTPSettings:
    """Read configuration from the process environment or backend .env.

    Required variables (configured in a later step):
      LABGEAR_SMTP_HOST
      LABGEAR_SMTP_USERNAME
      LABGEAR_SMTP_PASSWORD
      LABGEAR_SMTP_FROM_EMAIL
    """
    load_dotenv(dotenv_path=BACKEND_ENV_FILE, override=False)

    names = (
        "LABGEAR_SMTP_HOST",
        "LABGEAR_SMTP_USERNAME",
        "LABGEAR_SMTP_PASSWORD",
        "LABGEAR_SMTP_FROM_EMAIL",
    )
    values = {name: os.environ.get(name, "") for name in names}
    if any(not value.strip() for value in values.values()):
        raise EmailConfigurationError("SMTP configuration is incomplete.")

    host = values["LABGEAR_SMTP_HOST"].strip().lower()
    labels = host.split(".")
    if (
        len(host) > 253
        or len(labels) < 2
        or any(
            re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
            is None
            for label in labels
        )
    ):
        raise EmailConfigurationError("Invalid SMTP hostname.")

    username = values["LABGEAR_SMTP_USERNAME"].strip()
    if any(char in username for char in "\r\n\x00"):
        raise EmailConfigurationError("Invalid SMTP username.")

    try:
        sender = _validated_email(values["LABGEAR_SMTP_FROM_EMAIL"].strip())
    except ValueError:
        raise EmailConfigurationError("Invalid SMTP sender address.") from None

    return SMTPSettings(
        host=host,
        username=username,
        password=values["LABGEAR_SMTP_PASSWORD"],
        from_email=sender,
    )


def _build_registration_message(
    delivery: PendingRegistration, sender: str
) -> EmailMessage:
    """Build an email from trusted internal registration delivery details."""
    if not isinstance(delivery, PendingRegistration):
        raise TypeError("A PendingRegistration object is required.")
    if re.fullmatch(r"[0-9]{6}", delivery.otp_code) is None:
        raise EmailDeliveryError("Registration OTP has an invalid format.")
    expiry = delivery.otp_expires_at
    if not isinstance(expiry, datetime) or expiry.tzinfo is None:
        raise EmailDeliveryError("Registration OTP expiry is invalid.")
    remaining = (expiry - datetime.now(timezone.utc)).total_seconds()
    if remaining < MIN_OTP_REMAINING_SECONDS:
        raise EmailDeliveryError("Registration OTP is expired or near expiry.")
    try:
        recipient = _validated_email(delivery.email_address)
    except ValueError:
        raise EmailDeliveryError("Registration email address is invalid.") from None

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = "LabGear - Verify your email address"
    message["Auto-Submitted"] = "auto-generated"
    message.set_content(
        "Your LabGear email verification code is:\n\n"
        f"{delivery.otp_code}\n\n"
        "This code expires three minutes after it was issued. "
        "Only enter it on the LabGear website. Never share this code.\n\n"
        "If you did not start this registration, ignore this email.\n"
    )
    return message


def send_registration_otp(delivery: PendingRegistration) -> None:
    """Send a registration code using certificate-verified SMTP over TLS.

    Returns None only after the SMTP server accepts the message. This does
    not guarantee delivery to the inbox. SMTP failure raises a generic
    EmailDeliveryError without exposing credentials or OTP contents.
    """
    settings = load_smtp_settings()
    message = _build_registration_message(delivery, settings.from_email)
    context = ssl.create_default_context()

    try:
        with smtplib.SMTP_SSL(
            settings.host,
            settings.port,
            timeout=SMTP_TIMEOUT_SECONDS,
            context=context,
        ) as smtp:
            smtp.login(settings.username, settings.password)
            smtp.send_message(message)
    except (smtplib.SMTPException, OSError, TimeoutError):
        raise EmailDeliveryError(
            "Registration verification email could not be sent."
        ) from None
