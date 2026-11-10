
"""LabGear Backend File 104 — CSRF rejection auditing (retains File 94 behavior).

Destination: backend/app/api/routes/login.py (REPLACE).

Endpoints:
    GET  /api/auth/csrf
    POST /api/auth/login
    POST /api/auth/login/verify-otp
    GET  /api/auth/me
    POST /api/auth/logout

Password + reCAPTCHA -> Gmail login OTP -> HttpOnly session cookie.
Login OTP verification also requires a signed, short-lived challenge cookie
issued after the password step. The emailed code ALONE cannot log in.

Local development only. Do not log OTPs, passwords, signed challenges,
session cookies, or CSRF tokens.

New in File 94: record login_otp_sent only after the SMTP provider accepts
the email submission. Failed audit writes are safely logged without disrupting
a submitted OTP or its short-lived challenge cookie.

New in File 104: record CSRF_REJECTED for denied origins, invalid public
CSRF tokens, and session logout CSRF rejections. The security response is
unchanged if audit storage is temporarily unavailable.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import logging
import re
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.auth_config import AuthConfigurationError, load_auth_settings
from app.core.auth_security import hash_email_otp
from app.db.dependencies import DbSession
from app.db.database import SessionLocal
from app.models.auth import EmailOTP
from app.models.security import ActivityLog
from app.schemas.auth import LoginRequest
from app.services.captcha_service import CaptchaConfigurationError
from app.services.email_delivery_service import EmailConfigurationError, EmailDeliveryError
from app.services.login_service import (
    LOGIN_OTP_PURPOSE,
    LoginThrottled,
    LoginUnavailable,
    PendingLoginOTP,
    begin_login,
    send_login_otp_email,
    verify_login_otp_code,
)
from app.services.public_csrf_service import (
    PUBLIC_CSRF_TTL_SECONDS,
    PublicCSRFError,
    issue_public_csrf_token,
    verify_public_csrf_token,
)
from app.services.session_service import (
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    SessionCSRFRejected,
    SessionUnavailable,
    create_authenticated_session,
    require_authenticated_session,
    revoke_authenticated_session,
)

router = APIRouter(prefix="/api/auth", tags=["Login & Sessions"])
logger = logging.getLogger("labgear.login")

_CHALLENGE_COOKIE = "labgear_login_challenge"
_CHALLENGE_SECONDS = 180
_ID_PATTERN = re.compile(r"[0-9]{4}-[0-9]{4}\Z")
_HASH_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
_LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_ALLOWED_ORIGINS = frozenset({
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
})
_GENERIC_LOGIN_ERROR = "Invalid credentials, verification, or account status."
_GENERIC_OTP_ERROR = "Verification is invalid, expired, or unavailable."
_GENERIC_SERVICE_ERROR = "Authentication is temporarily unavailable."


class LoginOTPRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)
    user_id: str = Field(pattern=r"^[0-9]{4}-[0-9]{4}$")
    otp: str = Field(pattern=r"^[0-9]{6}$", repr=False, exclude=True)


class PublicCSRFResponse(BaseModel):
    csrf_token: str = Field(repr=False)
    expires_in: int


class LoginPendingResponse(BaseModel):
    message: str
    user_id: str
    otp_required: bool = True


class LoginUserResponse(BaseModel):
    user_id: str
    username: str
    role: str
    expires_at: datetime


class LoginCompleteResponse(BaseModel):
    message: str
    user: LoginUserResponse
    csrf_token: str = Field(repr=False)


class StatusMessage(BaseModel):
    message: str


def _local_client_ip(request: Request) -> str:
    """Local only; never trust client-provided forwarding headers."""
    host = request.client.host if request.client else ""
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address is None or not address.is_loopback or request.url.hostname not in _LOCAL_HOSTS:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Login API is currently limited to localhost.",
        )
    return str(address)


def _audit_csrf_rejected(request: Request, reason: str) -> None:
    """Append safe rejection metadata without trusting or recording credentials.

    Use an independent short-lived session: a rejected request may already
    have an active/failed authentication transaction. Audit problems must never
    turn a protected 403 into a success or expose database internals.
    """
    try:
        with SessionLocal.begin() as audit_db:
            audit_db.add(
                ActivityLog(
                    event_type="CSRF_REJECTED",
                    ip_address=request.client.host if request.client else None,
                    user_agent=request.headers.get("user-agent", "")[:500],
                    details={
                        "source": "login_api",
                        "method": request.method,
                        "path": request.url.path,
                        "reason": reason,
                    },
                )
            )
    except SQLAlchemyError:
        logger.error("CSRF rejection audit insertion failed.")


def _trusted_browser_origin(request: Request) -> None:
    """Reject and audit disallowed browser origins."""
    if request.headers.get("sec-fetch-site", "").lower() == "cross-site":
        _audit_csrf_rejected(request, "cross_site_request")
        raise HTTPException(status_code=403, detail="Origin not permitted.")
    origin = request.headers.get("origin")
    if origin is not None and origin not in _ALLOWED_ORIGINS:
        _audit_csrf_rejected(request, "origin_not_allowed")
        raise HTTPException(status_code=403, detail="Origin not permitted.")


def _require_public_csrf(request: Request) -> None:
    """Require a signed public-form token on unauthenticated login POSTs."""
    try:
        verify_public_csrf_token(
            request.headers.get(CSRF_HEADER_NAME),
            origin=request.headers.get("origin"),
            sec_fetch_site=request.headers.get("sec-fetch-site"),
        )
    except PublicCSRFError:
        _audit_csrf_rejected(request, "invalid_public_token")
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
    return request.url.scheme == "https"


def _encode_base64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _decode_base64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _challenge_sign(message: str, secret: bytes) -> str:
    return hmac.new(
        secret,
        ("labgear/login-challenge/v1:" + message).encode("ascii"),
        hashlib.sha256,
    ).hexdigest()


def _issue_challenge(delivery: PendingLoginOTP) -> tuple[str, int]:
    """Bind proof of successful password step to the exact issued OTP hash."""
    settings = load_auth_settings()
    now = int(time.time())
    otp_digest = hash_email_otp(
        delivery.otp_code,
        delivery.user_id,
        LOGIN_OTP_PURPOSE,
        settings.otp_hmac_key,
    )
    payload = _encode_base64(
        json.dumps(
            {
                "v": 1,
                "user_id": delivery.user_id,
                "otp_digest": otp_digest,
                "issued_at": now,
            },
            separators=(",", ":"),
            sort_keys=True,
        ).encode("utf-8")
    )
    signature = _challenge_sign(payload, settings.jwt_signing_key)
    max_age = min(
        _CHALLENGE_SECONDS,
        max(
            1,
            int(
                (
                    delivery.expires_at - datetime.now(timezone.utc)
                ).total_seconds()
            ),
        ),
    )
    return payload + "." + signature, max_age


def _read_challenge(cookie: str | None, expected_user_id: str) -> str | None:
    """Return bound OTP digest only for a valid, unexpired signed challenge."""
    if not isinstance(cookie, str) or len(cookie) > 750 or "." not in cookie:
        return None
    try:
        body, signature = cookie.rsplit(".", 1)
        if len(signature) != 64 or not _HASH_PATTERN.fullmatch(signature):
            return None
        settings = load_auth_settings()
        if not hmac.compare_digest(
            signature, _challenge_sign(body, settings.jwt_signing_key)
        ):
            return None
        payload = json.loads(_decode_base64(body))
        now = int(time.time())
        if not isinstance(payload, dict) or payload.get("v") != 1:
            return None
        issued = payload.get("issued_at")
        uid = payload.get("user_id")
        digest = payload.get("otp_digest")
        if (
            type(issued) is not int
            or issued > now + 5
            or now - issued >= _CHALLENGE_SECONDS
            or not isinstance(uid, str)
            or not _ID_PATTERN.fullmatch(uid)
            or uid != expected_user_id
            or not isinstance(digest, str)
            or not _HASH_PATTERN.fullmatch(digest)
        ):
            return None
        return digest
    except (ValueError, TypeError, UnicodeError, OverflowError):
        return None


def _latest_otp_matches(
    db: DbSession,
    *,
    user_id: str,
    expected_hash: str,
) -> bool:
    """Check challenge is for latest unconsumed OTP."""
    with db.begin():
        row = db.execute(
            select(EmailOTP)
            .where(
                EmailOTP.user_id == user_id,
                EmailOTP.purpose == LOGIN_OTP_PURPOSE,
            )
            .order_by(EmailOTP.created_at.desc(), EmailOTP.id.desc())
            .limit(1)
        ).scalar_one_or_none()

        if row is None:
            logger.warning("LabGear login OTP rejected: no login OTP record")
            return False

        if row.used_at is not None:
            logger.warning("LabGear login OTP rejected: latest OTP already used")
            return False

        if row.revoked_at is not None:
            logger.warning("LabGear login OTP rejected: latest OTP revoked")
            return False

        expires_at = row.expires_at
        if expires_at is None or expires_at.tzinfo is None:
            logger.warning("LabGear login OTP rejected: OTP timestamp invalid")
            return False

        matched = hmac.compare_digest(row.otp_hash, expected_hash)
        if not matched:
            logger.warning(
                "LabGear login OTP rejected: challenge is not for latest OTP"
            )
        return matched


@router.get("/csrf", response_model=PublicCSRFResponse)
def get_public_csrf_token(
    request: Request,
    response: Response,
) -> PublicCSRFResponse:
    """Issue a short-lived CSRF token for the public login forms."""
    _local_client_ip(request)
    _trusted_browser_origin(request)

    try:
        token = issue_public_csrf_token(
            origin=request.headers.get("origin"),
            sec_fetch_site=request.headers.get("sec-fetch-site"),
        )
    except PublicCSRFError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF token could not be issued for this origin.",
        ) from None
    except AuthConfigurationError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    response.headers["Cache-Control"] = "no-store, private"
    response.headers["Pragma"] = "no-cache"
    response.headers["Vary"] = "Origin"

    return PublicCSRFResponse(
        csrf_token=token,
        expires_in=PUBLIC_CSRF_TTL_SECONDS,
    )


@router.post(
    "/login",
    response_model=LoginPendingResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def start_login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> LoginPendingResponse:
    """Password + CAPTCHA, then send Gmail login code; no session yet."""
    client_ip = _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)

    try:
        pending = begin_login(
            db,
            username=payload.username,
            password=payload.password,
            captcha_token=payload.captcha_token,
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", ""),
        )
    except LoginThrottled as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from None
    except LoginUnavailable:
        raise HTTPException(
            status_code=401,
            detail=_GENERIC_LOGIN_ERROR,
        ) from None
    except (AuthConfigurationError, CaptchaConfigurationError):
        raise HTTPException(
            status_code=503,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    try:
        send_login_otp_email(pending)
    except (EmailConfigurationError, EmailDeliveryError):
        raise HTTPException(
            status_code=503,
            detail="Login email could not be sent. Please try again later.",
        ) from None

    # SMTP accepted the submission; this does not guarantee inbox delivery.
    # The login OTP row is already committed by begin_login. Persist only
    # safe delivery metadata, never the code, email address, or token.
    try:
        with db.begin():
            db.add(
                ActivityLog(
                    event_type="login_otp_sent",
                    user_id=pending.user_id,
                    ip_address=client_ip,
                    user_agent=request.headers.get("user-agent", "")[:500],
                    details={
                        "purpose": "login",
                        "delivery_status": "smtp_accepted",
                    },
                )
            )
    except SQLAlchemyError:
        # An email already accepted by SMTP cannot be unsent. Do not return
        # a false delivery failure or suppress the user's challenge cookie.
        db.rollback()
        logger.error("Login OTP SMTP acceptance audit insertion failed.")

    challenge, max_age = _issue_challenge(pending)
    response.set_cookie(
        key=_CHALLENGE_COOKIE,
        value=challenge,
        max_age=max_age,
        path="/api/auth/login",
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"

    return LoginPendingResponse(
        message="If eligible, check your email for a login verification code.",
        user_id=pending.user_id,
        otp_required=True,
    )


@router.post(
    "/login/verify-otp",
    response_model=LoginCompleteResponse,
)
def complete_login(
    payload: LoginOTPRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> LoginCompleteResponse:
    """Consume login OTP only after verifying password-stage challenge cookie."""
    client_ip = _local_client_ip(request)
    _trusted_browser_origin(request)
    _require_public_csrf(request)

    challenge_cookie = request.cookies.get(_CHALLENGE_COOKIE)
    challenge_digest = _read_challenge(challenge_cookie, payload.user_id)

    if challenge_digest is None:
        logger.warning(
            "LabGear login OTP rejected: %s",
            "password-step cookie missing"
            if not challenge_cookie
            else "password-step cookie invalid, expired, or for another login",
        )
        raise HTTPException(status_code=401, detail=_GENERIC_OTP_ERROR)

    if not _latest_otp_matches(
        db,
        user_id=payload.user_id,
        expected_hash=challenge_digest,
    ):
        raise HTTPException(status_code=401, detail=_GENERIC_OTP_ERROR)

    try:
        principal = verify_login_otp_code(
            db,
            user_id=payload.user_id,
            otp_code=payload.otp,
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", ""),
        )
    except LoginThrottled as exc:
        raise HTTPException(
            status_code=429,
            detail="Too many verification attempts. Try again later.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from None
    except LoginUnavailable:
        logger.warning(
            "LabGear login OTP rejected: OTP service rejected the code "
            "or current account/OTP state"
        )
        raise HTTPException(status_code=401, detail=_GENERIC_OTP_ERROR) from None

    # Stage 2 has completed; only NOW create an authenticated session.
    try:
        issued = create_authenticated_session(
            db,
            principal=principal,
            ip_address=client_ip,
            user_agent=request.headers.get("user-agent", ""),
        )
    except SessionUnavailable:
        raise HTTPException(
            status_code=503,
            detail=_GENERIC_SERVICE_ERROR,
        ) from None

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=issued.session_token,
        max_age=12 * 60 * 60,
        path="/",
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
    )
    response.delete_cookie(
        key=_CHALLENGE_COOKIE,
        path="/api/auth/login",
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"

    return LoginCompleteResponse(
        message="Login successful.",
        user=LoginUserResponse(
            user_id=principal.user_id,
            username=principal.username,
            role=principal.role,
            expires_at=issued.expires_at,
        ),
        csrf_token=issued.csrf_token,
    )


@router.get("/me", response_model=LoginUserResponse)
def read_current_user(
    request: Request,
    response: Response,
    db: DbSession,
) -> LoginUserResponse:
    """Validate login session, nine-minute idle timeout, and active account."""
    _local_client_ip(request)

    try:
        current = require_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            method="GET",
        )
    except SessionUnavailable:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
        ) from None

    response.headers["Cache-Control"] = "no-store"

    return LoginUserResponse(
        user_id=current.user_id,
        username=current.username,
        role=current.role,
        expires_at=current.expires_at,
    )


@router.post("/logout", response_model=StatusMessage)
def logout(
    request: Request,
    response: Response,
    db: DbSession,
) -> StatusMessage:
    """Revoke login session; authenticated session CSRF header is required."""
    _local_client_ip(request)
    _trusted_browser_origin(request)

    try:
        revoke_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            csrf_token=request.headers.get(CSRF_HEADER_NAME),
        )
    except SessionCSRFRejected:
        _audit_csrf_rejected(request, "invalid_session_token")
        raise HTTPException(
            status_code=403,
            detail="CSRF verification failed.",
        ) from None

    response.delete_cookie(
        key=SESSION_COOKIE_NAME,
        path="/",
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
    response.delete_cookie(
        key=_CHALLENGE_COOKIE,
        path="/api/auth/login",
        secure=_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-store"

    return StatusMessage(message="Signed out.")
