
"""LabGear Backend File 56: local-development registration API router.

Destination: backend/app/api/routes/registration.py (CREATE)

Mount in app/main.py (next file):
    from app.api.routes.registration import router as registration_router
    app.include_router(registration_router)

Routes after mounting:
    POST /api/auth/register
    POST /api/auth/register/verify-otp
    POST /api/auth/register/resend-otp

Uses existing Step 54/52/55 services; never returns OTPs, hashes, or
registration secrets. For now all three endpoints are intentionally limited
to the local development server and caller. Review and extend abuse controls,
CSRF/CORS, session policies, and error redaction before public deployment.
"""

import ipaddress
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

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

router = APIRouter(prefix="/api/auth", tags=["Registration"])

# Database-backed, per-IP request limits. They also apply to rejected attempts.
# A per-account limit for issued resends is enforced by the Step 55 service.
IP_LIMITS = {
    "registration_request": (5, 15 * 60),
    "registration_verify_request": (12, 10 * 60),
    "registration_resend_request": (6, 15 * 60),
}

GENERIC_REGISTRATION_MESSAGE = (
    "If this registration is eligible, check your email for its verification code."
)
GENERIC_OTP_ERROR = "The verification code is invalid, expired, or unavailable."


class PublicRegistrationRequest(RegistrationRequest):
    """Tighten the older Step 39 schema to the course username/answer rules."""

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
        if not 2 <= len(value) <= 50 or re.fullmatch(r"[A-Za-z]+(?: [A-Za-z]+)*", value) is None:
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
    captcha_token: str = Field(min_length=1, max_length=4096, repr=False, exclude=True)


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
                headers={"Retry-After": "60"},
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
    db: DbSession,
) -> RegistrationMessage:
    """Start self-registration and email the verification code using Gmail."""
    ip = _local_client_ip(request)
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
        ) from None
    except CaptchaConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Registration verification is temporarily unavailable.",
        ) from None
    except IntegrityError:
        # A non-unique database constraint failure is a server issue, not a
        # request-validation result. Don't expose SQL statements or parameters.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Registration is temporarily unavailable.",
        ) from None

    try:
        send_registration_otp(delivery)
    except (EmailConfigurationError, EmailDeliveryError):
        # A pending account now exists. Do not automatically create another
        # OTP or bypass the resend cooldown. The resend endpoint can recover.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Verification email could not be sent. Try resending later.",
        ) from None

    return RegistrationMessage(message=GENERIC_REGISTRATION_MESSAGE)


@router.post(
    "/register/verify-otp",
    response_model=RegistrationVerificationMessage,
)
def verify_registration(
    payload: VerifyRegistrationOTPRequest,
    request: Request,
    db: DbSession,
) -> RegistrationVerificationMessage:
    """Use the Step 52 locked, one-time OTP verifier to activate an account."""
    ip = _local_client_ip(request)
    _reserve_ip_attempt(db, ip=ip, action="registration_verify_request")

    result = verify_pending_registration_otp(
        db, user_id=payload.user_id, otp_code=payload.otp
    )
    if result != RegistrationOtpResult.VERIFIED:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=GENERIC_OTP_ERROR,
        )
    return RegistrationVerificationMessage(
        message="Email verified. You can now log in.", verified=True
    )


@router.post(
    "/register/resend-otp",
    response_model=RegistrationMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_registration(
    payload: ResendRegistrationOTPRequest,
    request: Request,
    db: DbSession,
) -> RegistrationMessage:
    """Rate-limit, replace, and email a new registration code."""
    ip = _local_client_ip(request)
    _reserve_ip_attempt(db, ip=ip, action="registration_resend_request")

    try:
        captcha_ok = verify_registration_captcha(payload.captcha_token)
    except CaptchaConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Registration verification is temporarily unavailable.",
        ) from None
    if not captcha_ok:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CAPTCHA verification failed.",
        )

    try:
        delivery = issue_registration_otp_resend(db, user_id=payload.user_id)
    except RegistrationResendLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait before requesting another code.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
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
        ) from None

    return RegistrationMessage(message=GENERIC_REGISTRATION_MESSAGE)
