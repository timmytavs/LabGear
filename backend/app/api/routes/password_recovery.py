
"""LabGear Backend File 101 — public CSRF enforcement on password recovery.

Destination: backend/app/api/routes/password_recovery.py (REPLACE EXISTING FILE)

Mount in app/main.py in a later step:
    from app.api.routes.password_recovery import router as password_recovery_router
    app.include_router(password_recovery_router)

Endpoints:
    POST /api/auth/password-recovery
    POST /api/auth/password-recovery/resend-otp
    POST /api/auth/password-recovery/verify-otp
    POST /api/auth/password-recovery/reset

All four recovery POST endpoints require the same signed public CSRF token
issued at GET /api/auth/csrf as registration and login. File 100 sends this
token in X-CSRF-Token. The backend verifies its origin binding and signature.

The OTP challenge and reset grant remain exclusively in HttpOnly, SameSite=Lax
cookies; the existing password recovery and Gmail delivery logic is unchanged.

No database tables or migrations are created by this file.
"""

from __future__ import annotations

import ipaddress
import logging
import secrets
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.auth_config import AuthConfigurationError
from app.db.dependencies import DbSession
from app.services.captcha_service import CaptchaConfigurationError
from app.services.email_delivery_service import (
    EmailConfigurationError,
    EmailDeliveryError,
)
from app.services.public_csrf_service import (
    PublicCSRFError,
    verify_public_csrf_token,
)
from app.services.password_recovery_service import (
    PasswordRecoveryCaptchaRejected,
    PasswordRecoveryPasswordRejected,
    PasswordRecoveryPasswordReused,
    PasswordRecoveryRateLimited,
    PasswordRecoveryUnavailable,
    begin_password_recovery,
    complete_password_recovery,
    resend_password_recovery_otp,
    revoke_password_recovery_otp,
    send_password_changed_email,
    send_password_recovery_otp_email,
    verify_password_recovery_otp,
)

from app.services.session_service import CSRF_HEADER_NAME

router = APIRouter(prefix="/api/auth", tags=["Password Recovery"])
logger = logging.getLogger("labgear.password_recovery")

_RECOVERY_PATH = "/api/auth/password-recovery"
_RECOVERY_CHALLENGE_COOKIE = "labgear_password_recovery"
_RESET_GRANT_COOKIE = "labgear_password_reset"
_RECOVERY_FLOW_SECONDS = 15 * 60
_RESET_GRANT_SECONDS = 10 * 60

_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_ALLOWED_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)

_GENERIC_RECOVERY_MESSAGE = (
    "If the recovery details are valid, a verification code will be sent."
)
_GENERIC_OTP_ERROR = "The verification code is invalid, expired, or unavailable."
_GENERIC_SERVICE_ERROR = "Password recovery is temporarily unavailable."


class PasswordRecoveryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    username: str = Field(
        min_length=6,
        max_length=17,
        pattern=r"^[A-Za-z][A-Za-z0-9]{5,16}$",
    )
    question_code: Literal["Q7", "Q2", "Q4"]
    answer: str = Field(
        min_length=2,
        max_length=50,
        pattern=r"^[A-Za-z]+(?: [A-Za-z]+)*$",
        repr=False,
        exclude=True,
    )
    answer_confirmation: str = Field(
        min_length=2,
        max_length=50,
        pattern=r"^[A-Za-z]+(?: [A-Za-z]+)*$",
        repr=False,
        exclude=True,
    )
    captcha_token: str = Field(
        min_length=1,
        max_length=8192,
        repr=False,
        exclude=True,
    )

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def answers_must_match(self) -> "PasswordRecoveryRequest":
        if self.answer != self.answer_confirmation:
            raise ValueError("Security answers do not match.")
        return self


class PasswordRecoveryOTPRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    otp: str = Field(
        pattern=r"^[0-9]{6}$",
        repr=False,
        exclude=True,
    )


class PasswordResetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)

    new_password: str = Field(
        min_length=10,
        max_length=64,
        repr=False,
        exclude=True,
    )
    confirm_password: str = Field(
        min_length=10,
        max_length=64,
        repr=False,
        exclude=True,
    )


class PasswordRecoveryMessage(BaseModel):
    message: str
    otp_required: bool = True


class PasswordRecoveryVerifiedMessage(BaseModel):
    message: str
    reset_required: bool = True


class PasswordResetMessage(BaseModel):
    message: str
    notification_sent: bool
    sessions_invalidated: bool


def _log_recovery_service_failure(exc: Exception) -> None:
    """Log safe diagnostic metadata without exposing credentials or SQL values."""
    if isinstance(exc, SQLAlchemyError):
        original_error = getattr(exc, "orig", None)
        diagnostic = getattr(original_error, "diag", None)

        sqlstate = (
            getattr(original_error, "sqlstate", None)
            or getattr(original_error, "pgcode", None)
        )
        table_name = getattr(diagnostic, "table_name", None)
        column_name = getattr(diagnostic, "column_name", None)
        constraint_name = getattr(diagnostic, "constraint_name", None)

        logger.error(
            "LabGear password recovery failed: category=database "
            "exception_type=%s sqlstate=%s table=%s column=%s constraint=%s",
            type(original_error).__name__
            if original_error is not None
            else type(exc).__name__,
            sqlstate or "unavailable",
            table_name or "unavailable",
            column_name or "unavailable",
            constraint_name or "unavailable",
        )
        return

    if isinstance(exc, CaptchaConfigurationError):
        category = "captcha_configuration"
    elif isinstance(exc, AuthConfigurationError):
        category = "authentication_configuration"
    else:
        category = "unexpected"

    logger.error(
        "LabGear password recovery failed: category=%s exception_type=%s",
        category,
        type(exc).__name__,
    )


def _local_client_ip(request: Request) -> str:
    """Match the existing LabGear login route's localhost-only policy."""
    host = request.client.host if request.client else ""

    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None

    if (
        address is None
        or not address.is_loopback
        or request.url.hostname not in _ALLOWED_HOSTS
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password recovery API is currently limited to localhost.",
        )

    return str(address)


def _trusted_browser_origin(request: Request) -> None:
    """Reject cross-site browser requests; allow local React/FastAPI origins."""
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
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
    """Require signed, origin-bound public CSRF proof on every recovery POST.

    The frontend obtains a fresh signed token from GET /api/auth/csrf.
    Keep the same semantics and generic 403 as the existing login and
    registration routers; never log or echo the token value.
    """
    try:
        verify_public_csrf_token(
            request.headers.get(CSRF_HEADER_NAME),
            origin=request.headers.get("origin"),
            sec_fetch_site=request.headers.get("sec-fetch-site"),
        )
    except PublicCSRFError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF verification failed.",
        ) from None
    except AuthConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None


def _cookie_secure(request: Request) -> bool:
    """Allow non-Secure cookies only for the existing localhost HTTP workflow."""
    return request.url.scheme == "https"


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def _set_challenge_cookie(
    response: Response,
    request: Request,
    token: str,
    *,
    max_age: int = _RECOVERY_FLOW_SECONDS,
) -> None:
    response.set_cookie(
        key=_RECOVERY_CHALLENGE_COOKIE,
        value=token,
        max_age=max(1, min(int(max_age), _RECOVERY_FLOW_SECONDS)),
        path=_RECOVERY_PATH,
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )


def _set_reset_cookie(
    response: Response,
    request: Request,
    token: str,
) -> None:
    response.set_cookie(
        key=_RESET_GRANT_COOKIE,
        value=token,
        max_age=_RESET_GRANT_SECONDS,
        path=_RECOVERY_PATH,
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )


def _delete_recovery_cookies(response: Response, request: Request) -> None:
    for cookie_name in (
        _RECOVERY_CHALLENGE_COOKIE,
        _RESET_GRANT_COOKIE,
    ):
        response.delete_cookie(
            key=cookie_name,
            path=_RECOVERY_PATH,
            secure=_cookie_secure(request),
            httponly=True,
            samesite="lax",
        )


def _set_decoy_challenge_cookie(response: Response, request: Request) -> None:
    """Keep the response shape consistent for unknown or incorrect accounts."""
    _set_challenge_cookie(
        response,
        request,
        secrets.token_urlsafe(32),
        max_age=_RECOVERY_FLOW_SECONDS,
    )


def _revoke_delivery_safely(db: DbSession, *, user_id: str, otp_id: int) -> None:
    """Invalidate a persisted code if SMTP did not accept the email."""
    try:
        revoke_password_recovery_otp(
            db,
            user_id=user_id,
            otp_id=otp_id,
        )
    except Exception:
        # Do not log SQL parameters, OTP data, tokens, or provider responses.
        logger.warning("LabGear password recovery OTP cleanup failed.")


def _invalidate_existing_sessions(db: DbSession, *, user_id: str) -> bool:
    """Expire all server-side sessions after a password reset.

    auth_sessions is the existing LabGear session table used by login.py.
    If the database role cannot update it, password reset remains successful
    but the response reports that session invalidation did not complete.
    """
    now = datetime.now(timezone.utc)

    try:
        with db.begin():
            db.execute(
                text(
                    """
                    UPDATE public.auth_sessions
                    SET expires_at = :now
                    WHERE user_id = :user_id
                      AND expires_at > :now
                    """
                ),
                {"now": now, "user_id": user_id},
            )
        return True
    except SQLAlchemyError:
        logger.warning(
            "LabGear password recovery could not invalidate existing sessions."
        )
        return False


@router.post(
    "/password-recovery",
    response_model=PasswordRecoveryMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_password_recovery(
    payload: PasswordRecoveryRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> PasswordRecoveryMessage:
    """Verify CAPTCHA and one assigned security answer, then email a reset OTP."""
    client_ip = _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)

    try:
        delivery = begin_password_recovery(
            db,
            username=payload.username,
            question_code=payload.question_code,
            answer=payload.answer,
            answer_confirmation=payload.answer_confirmation,
            captcha_token=payload.captcha_token,
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", ""),
        )
    except PasswordRecoveryCaptchaRejected:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CAPTCHA verification failed. Please try again.",
        ) from None
    except PasswordRecoveryRateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many recovery attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from None
    except PasswordRecoveryUnavailable:
        # Do not disclose whether the username, question, or answer was valid.
        _set_decoy_challenge_cookie(response, request)
        _no_store(response)
        return PasswordRecoveryMessage(message=_GENERIC_RECOVERY_MESSAGE)
    except (
        AuthConfigurationError,
        CaptchaConfigurationError,
        SQLAlchemyError,
    ) as exc:
        _log_recovery_service_failure(exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    if delivery is None:
        _set_decoy_challenge_cookie(response, request)
        _no_store(response)
        return PasswordRecoveryMessage(message=_GENERIC_RECOVERY_MESSAGE)

    try:
        send_password_recovery_otp_email(delivery)
    except (EmailConfigurationError, EmailDeliveryError):
        _revoke_delivery_safely(
            db,
            user_id=delivery.user_id,
            otp_id=delivery.otp_id,
        )
        # Keep the same public response to avoid exposing account existence.
        _set_decoy_challenge_cookie(response, request)
        _no_store(response)
        return PasswordRecoveryMessage(message=_GENERIC_RECOVERY_MESSAGE)

    remaining = int(
        (delivery.challenge_expires_at - datetime.now(timezone.utc)).total_seconds()
    )
    _set_challenge_cookie(
        response,
        request,
        delivery.challenge_token,
        max_age=remaining,
    )
    _no_store(response)

    return PasswordRecoveryMessage(message=_GENERIC_RECOVERY_MESSAGE)


@router.post(
    "/password-recovery/resend-otp",
    response_model=PasswordRecoveryMessage,
    status_code=status.HTTP_202_ACCEPTED,
)
def resend_password_recovery(
    request: Request,
    response: Response,
    db: DbSession,
) -> PasswordRecoveryMessage:
    """Resend only for the signed recovery challenge stored in the HttpOnly cookie."""
    _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)

    challenge_token = request.cookies.get(_RECOVERY_CHALLENGE_COOKIE)
    if not challenge_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_GENERIC_OTP_ERROR,
        )

    try:
        delivery = resend_password_recovery_otp(
            db,
            challenge_token=challenge_token,
        )
    except PasswordRecoveryRateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Please wait before requesting another code.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from None
    except PasswordRecoveryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_GENERIC_OTP_ERROR,
        ) from None
    except (AuthConfigurationError, SQLAlchemyError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    try:
        send_password_recovery_otp_email(delivery)
    except (EmailConfigurationError, EmailDeliveryError):
        _revoke_delivery_safely(
            db,
            user_id=delivery.user_id,
            otp_id=delivery.otp_id,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The verification email could not be sent. Please try again later.",
        ) from None

    remaining = int(
        (delivery.challenge_expires_at - datetime.now(timezone.utc)).total_seconds()
    )
    _set_challenge_cookie(
        response,
        request,
        delivery.challenge_token,
        max_age=remaining,
    )
    _no_store(response)

    return PasswordRecoveryMessage(
        message="If the recovery request is still valid, a new code has been sent."
    )


@router.post(
    "/password-recovery/verify-otp",
    response_model=PasswordRecoveryVerifiedMessage,
)
def verify_recovery_otp(
    payload: PasswordRecoveryOTPRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> PasswordRecoveryVerifiedMessage:
    """Consume the OTP and replace the challenge cookie with a reset-grant cookie."""
    client_ip = _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)

    challenge_token = request.cookies.get(_RECOVERY_CHALLENGE_COOKIE)
    if not challenge_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_GENERIC_OTP_ERROR,
        )

    try:
        grant = verify_password_recovery_otp(
            db,
            challenge_token=challenge_token,
            otp_code=payload.otp,
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", ""),
        )
    except PasswordRecoveryRateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from None
    except PasswordRecoveryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_GENERIC_OTP_ERROR,
        ) from None
    except (AuthConfigurationError, SQLAlchemyError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    _set_reset_cookie(
        response,
        request,
        grant.reset_token,
    )
    response.delete_cookie(
        key=_RECOVERY_CHALLENGE_COOKIE,
        path=_RECOVERY_PATH,
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
    _no_store(response)

    return PasswordRecoveryVerifiedMessage(
        message="Email verification successful. You may now reset your password."
    )


@router.post(
    "/password-recovery/reset",
    response_model=PasswordResetMessage,
)
def reset_password(
    payload: PasswordResetRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> PasswordResetMessage:
    """Complete a password reset using only the short-lived HttpOnly grant."""
    _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)

    reset_token = request.cookies.get(_RESET_GRANT_COOKIE)
    if not reset_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password reset authorization is missing or expired.",
        )

    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Passwords do not match.",
        )

    try:
        completed = complete_password_recovery(
            db,
            reset_token=reset_token,
            new_password=payload.new_password,
            password_confirmation=payload.confirm_password,
        )
    except PasswordRecoveryPasswordReused:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You cannot reuse one of your last three passwords.",
        ) from None
    except PasswordRecoveryPasswordRejected as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from None
    except PasswordRecoveryUnavailable:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Password reset authorization is invalid or expired.",
        ) from None
    except (AuthConfigurationError, SQLAlchemyError):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    # Password change is already committed. A notification failure must not
    # falsely tell the user that their password was not changed.
    notification_sent = True
    try:
        send_password_changed_email(completed)
    except (EmailConfigurationError, EmailDeliveryError):
        notification_sent = False
        logger.warning(
            "LabGear password changed, but its notification email was not sent."
        )

    sessions_invalidated = _invalidate_existing_sessions(
        db,
        user_id=completed.user_id,
    )

    _delete_recovery_cookies(response, request)
    _no_store(response)

    if notification_sent and sessions_invalidated:
        message = "Password changed successfully. You can now sign in."
    elif not notification_sent and sessions_invalidated:
        message = (
            "Password changed successfully. The security notification email "
            "could not be sent."
        )
    elif notification_sent and not sessions_invalidated:
        message = (
            "Password changed successfully. Please sign out from other devices "
            "because existing sessions could not all be invalidated."
        )
    else:
        message = (
            "Password changed successfully. The notification email could not "
            "be sent, and existing sessions could not all be invalidated."
        )

    return PasswordResetMessage(
        message=message,
        notification_sent=notification_sent,
        sessions_invalidated=sessions_invalidated,
    )
