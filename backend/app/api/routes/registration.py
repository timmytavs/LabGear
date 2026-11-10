
"""LabGear Backend File 81 — registration API with public CSRF enforcement.

Destination: backend/app/api/routes/registration.py (REPLACE).

Routes:
    POST /api/auth/register
    POST /api/auth/register/verify-otp
    POST /api/auth/register/resend-otp

All three unsafe public registration routes require the signed, short-lived
public-form CSRF token issued by File 79 at GET /api/auth/csrf.

Preserves the existing registration workflow, privacy consent, CAPTCHA,
three security questions, database-backed IP limits, email delivery, and
one-time registration OTP verification/resend behavior.

The router remains local-development only. The public CSRF token does not
authenticate a user and does not replace CAPTCHA, rate limits, account
verification, or authenticated-session CSRF protection.
"""

import ipaddress
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.core.auth_config import AuthConfigurationError
from app.db.dependencies import DbSession
from app.models.security import ActivityLog
from app.schemas.auth import RegistrationRequest
from app.services.captcha_service import (
    CaptchaConfigurationError,
    verify_registration_captcha,
)
from app.services.email_delivery_service import (
    EmailConfigurationError,
    EmailDeliveryError,
    send_registration_otp,
)
from app.services.public_csrf_service import (
    PublicCSRFError,
    verify_public_csrf_token,
)
from app.services.registration_otp_resend_service import (
    RegistrationResendLimited,
    RegistrationResendUnavailable,
    issue_registration_otp_resend,
)
from app.services.registration_otp_service import (
    RegistrationOtpResult,
    verify_pending_registration_otp,
)
from app.services.registration_service import (
    RegistrationConflict,
    RegistrationRejected,
    register_pending_user,
)
from app.services.session_service import CSRF_HEADER_NAME

router = APIRouter(prefix="/api/auth", tags=["Registration"])

# Database-backed, per-IP request limits. They also apply to rejected
# registration, CAPTCHA, and OTP attempts after browser-origin/CSRF checks.
# A per-account limit for issued resends is enforced by the Step 55 service.
IP_LIMITS = {
    "registration_request": (5, 15 * 60),
    "registration_verify_request": (12, 10 * 60),
    "registration_resend_request": (6, 15 * 60),
}

_ALLOWED_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)

GENERIC_REGISTRATION_MESSAGE = (
    "If this registration is eligible, check your email for its verification code."
)
GENERIC_OTP_ERROR = "The verification code is invalid, expired, or unavailable."
GENERIC_CSRF_ERROR = "CSRF verification failed."
GENERIC_SECURITY_ERROR = "Registration security is temporarily unavailable."


class PublicRegistrationRequest(RegistrationRequest):
    """Tighten the older registration schema to the course username/answer rules."""

    @field_validator("username")
    @classmethod
    def validate_public_username(cls, value: str) -> str:
        if re.fullmatch(r"[A-Za-z][A-Za-z0-9]{5,16}", value) is None:
            raise ValueError(
                "Username must start with a letter and use 6-17 letters or digits."
            )
        return value

    @field_validator(
        "security_answer_q7", "security_answer_q2", "security_answer_q4"
    )
    @classmethod
    def validate_public_answer(cls, value: str) -> str:
        if (
            not 2 <= len(value) <= 50
            or re.fullmatch(r"[A-Za-z]+(?: [A-Za-z]+)*", value) is None
        ):
            raise ValueError(
                "Security answer must use 2-50 letters/spaces without double spaces."
            )
        return value


class VerifyRegistrationOTPRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    user_id: str = Field(pattern=r"^[0-9]{4}-[0-9]{4}$")
    otp: str = Field(pattern=r"^[0-9]{6}$", repr=False, exclude=True)


class ResendRegistrationOTPRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    user_id: str = Field(pattern=r"^[0-9]{4}-[0-9]{4}$")
    captcha_token: str = Field(
        min_length=1,
        max_length=4096,
        repr=False,
        exclude=True,
    )


class RegistrationMessage(BaseModel):
    message: str


class RegistrationVerificationMessage(RegistrationMessage):
    verified: bool


def _local_client_ip(request: Request) -> str:
    """Allow local development only; never trust X-Forwarded-For here."""
    host = request.client.host if request.client else ""

    try:
        client = ipaddress.ip_address(host)
    except ValueError:
        client = None

    if client is None or not client.is_loopback:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration API is currently available only on localhost.",
        )

    # Also reject external Host headers when using a local reverse proxy.
    if request.url.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration API is currently available only on localhost.",
        )

    return str(client)


def _trusted_browser_origin(request: Request) -> None:
    """Reject cross-site browser requests and unapproved browser origins.

    Origin-less calls remain available for local CLI/Swagger development.
    The signed CSRF verifier below independently binds browser tokens to the
    exact Origin that requested them.
    """
    if request.headers.get("sec-fetch-site", "").strip().lower() == "cross-site":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Origin not permitted.",
        )

    origin = request.headers.get("origin")
    if origin is not None and origin not in _ALLOWED_ORIGINS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Origin not permitted.",
        )


def _require_public_csrf(request: Request) -> None:
    """Require File 79's signed public-form CSRF token on every unsafe route."""
    try:
        verify_public_csrf_token(
            request.headers.get(CSRF_HEADER_NAME),
            origin=request.headers.get("origin"),
            sec_fetch_site=request.headers.get("sec-fetch-site"),
        )
    except PublicCSRFError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=GENERIC_CSRF_ERROR,
        ) from None
    except AuthConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=GENERIC_SECURITY_ERROR,
        ) from None


def _protect_public_post(request: Request) -> str:
    """Apply local-host, Origin, and signed-CSRF checks before database work."""
    ip = _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)
    return ip


def _reserve_ip_attempt(db: DbSession, *, ip: str, action: str) -> None:
    """Count attempts in PostgreSQL atomically; no volatile in-memory counters.

    Advisory lock serializes this client's requests across workers. Complete
    this short transaction before entering a registration service; each service
    owns its own subsequent database transaction.
    """
    maximum, window_seconds = IP_LIMITS[action]
    now = datetime.now(timezone.utc)

    with db.begin():
        # hashtext -> PostgreSQL bigint advisory lock. Only an IP hash reaches it.
        db.execute(
            select(
                func.pg_advisory_xact_lock(
                    func.hashtext("labgear:registration:" + ip)
                )
            )
        ).scalar_one()

        attempts = db.execute(
            select(func.count())
            .select_from(ActivityLog)
            .where(
                ActivityLog.event_type == action,
                ActivityLog.ip_address == ip,
                ActivityLog.created_at >= now - timedelta(seconds=window_seconds),
            )
        ).scalar_one()

        if attempts >= maximum:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Try again later.",
                headers={"Retry-After": "60", "Cache-Control": "no-store"},
            )

        db.add(
            ActivityLog(
                event_type=action,
                ip_address=ip,
                details={"source": "local_registration_api"},
            )
        )


@router.post(
    "/register",
    response_model=RegistrationMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def register(
    payload: PublicRegistrationRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> RegistrationMessage:
    """Start self-registration and email the verification code using Gmail."""
    response.headers["Cache-Control"] = "no-store"

    ip = _protect_public_post(request)
    _reserve_ip_attempt(db, ip=ip, action="registration_request")

    try:
        delivery = register_pending_user(db, payload)
    except RegistrationConflict:
        # Avoid confirming that a specific ID, username, or email exists.
        return RegistrationMessage(message=GENERIC_REGISTRATION_MESSAGE)
    except RegistrationRejected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Registration could not be accepted. Check your details and CAPTCHA.",
            headers={"Cache-Control": "no-store"},
        ) from None
    except CaptchaConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Registration verification is temporarily unavailable.",
            headers={"Cache-Control": "no-store"},
        ) from None
    except IntegrityError:
        # A non-unique database constraint failure is a server issue, not a
        # request-validation result. Don't expose SQL statements or parameters.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Registration is temporarily unavailable.",
            headers={"Cache-Control": "no-store"},
        ) from None

    try:
        send_registration_otp(delivery)
    except (EmailConfigurationError, EmailDeliveryError):
        # A pending account now exists. Do not automatically create another
        # OTP or bypass the resend cooldown. The resend endpoint can recover.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verification email could not be sent. Try resending later.",
            headers={"Cache-Control": "no-store"},
        ) from None

    return RegistrationMessage(message=GENERIC_REGISTRATION_MESSAGE)


@router.post(
    "/register/verify-otp",
    response_model=RegistrationVerificationMessage,
)
def verify_registration(
    payload: VerifyRegistrationOTPRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> RegistrationVerificationMessage:
    """Use the Step 52 locked, one-time OTP verifier to activate an account."""
    response.headers["Cache-Control"] = "no-store"

    ip = _protect_public_post(request)
    _reserve_ip_attempt(db, ip=ip, action="registration_verify_request")

    result = verify_pending_registration_otp(
        db,
        user_id=payload.user_id,
        otp_code=payload.otp,
    )

    if result != RegistrationOtpResult.VERIFIED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=GENERIC_OTP_ERROR,
            headers={"Cache-Control": "no-store"},
        )

    return RegistrationVerificationMessage(
        message="Email verified. You can now log in.",
        verified=True,
    )


@router.post(
    "/register/resend-otp",
    response_model=RegistrationMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_registration(
    payload: ResendRegistrationOTPRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> RegistrationMessage:
    """Rate-limit, replace, and email a new registration code."""
    response.headers["Cache-Control"] = "no-store"

    ip = _protect_public_post(request)
    _reserve_ip_attempt(db, ip=ip, action="registration_resend_request")

    try:
        captcha_ok = verify_registration_captcha(payload.captcha_token)
    except CaptchaConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Registration verification is temporarily unavailable.",
            headers={"Cache-Control": "no-store"},
        ) from None

    if not captcha_ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CAPTCHA verification failed.",
            headers={"Cache-Control": "no-store"},
        )

    try:
        delivery = issue_registration_otp_resend(db, user_id=payload.user_id)
    except RegistrationResendLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait before requesting another code.",
            headers={
                "Retry-After": str(exc.retry_after_seconds),
                "Cache-Control": "no-store",
            },
        ) from None
    except RegistrationResendUnavailable:
        # Keep existence and status of accounts confidential.
        return RegistrationMessage(message=GENERIC_REGISTRATION_MESSAGE)

    try:
        send_registration_otp(delivery)
    except (EmailConfigurationError, EmailDeliveryError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verification email could not be sent. Try resending later.",
            headers={"Cache-Control": "no-store"},
        ) from None

    return RegistrationMessage(message=GENERIC_REGISTRATION_MESSAGE)
