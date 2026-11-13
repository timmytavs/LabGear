
"""LabGear File 120 — admin-only account listing and role assignment.

CREATE: backend/app/api/routes/admin_user_management.py

Endpoints (after a later main.py router registration):
    GET   /api/admin/users
    PATCH /api/admin/users/{user_id}/role

Security:
- Reuse the existing PostgreSQL-backed session and CSRF verification.
- Only live, authenticated admin sessions may access either endpoint.
- Restrict requests to the established localhost React/FastAPI origins.
- Only active, email-verified non-admin users may have roles changed.
- Never allow creation, promotion, or modification of an admin account.
- Never allow an admin to alter their own role.
- Revoke the target user's existing sessions after a role change.
- Record role changes in the existing append-only activity log.
- Never return passwords, email addresses, contact details or OTPs.

No database creation, schema migration, or changes to existing routers.
"""

from __future__ import annotations

import ipaddress
import re
from datetime import datetime, timezone
from math import ceil
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError

from app.db.dependencies import DbSession
from app.models.security import ActivityLog
from app.models.user import User
from app.services.session_service import (
    CSRF_HEADER_NAME,
    SESSION_COOKIE_NAME,
    SessionCSRFRejected,
    SessionUnavailable,
    auth_sessions,
    require_authenticated_session,
)

router = APIRouter(prefix="/api/admin/users", tags=["Admin User Management"])

_ALLOWED_ORIGINS = frozenset(
    {
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    }
)
_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
_USER_ID_PATTERN = re.compile(r"[0-9]{4}-[0-9]{4}\Z")
_ASSIGNABLE_ROLES = frozenset({"student", "instructor", "technician"})


class AdminUserItem(BaseModel):
    user_id: str
    username: str
    role: str
    account_status: str
    is_email_verified: bool
    department: str
    created_at: datetime


class AdminUsersPage(BaseModel):
    items: list[AdminUserItem]
    total: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1, le=50)
    pages: int = Field(ge=0)


class AdminRoleChangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    role: Literal["student", "instructor", "technician"]


class AdminRoleChangeResponse(BaseModel):
    user: AdminUserItem
    previous_role: str
    changed: bool
    message: str


def _trusted_local_request(request: Request) -> str:
    """Match the existing LabGear localhost-only browser API policy."""
    host = request.client.host if request.client else ""
    try:
        client = ipaddress.ip_address(host)
    except ValueError:
        client = None
    if (
        client is None
        or not client.is_loopback
        or request.url.hostname not in _ALLOWED_HOSTS
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin API is currently limited to localhost.",
        )
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
    return str(client)


def _require_admin(request: Request, db: DbSession, *, method: str):
    """Check the session before accessing any private user data."""
    _trusted_local_request(request)
    try:
        principal = require_authenticated_session(
            db,
            session_token=request.cookies.get(SESSION_COOKIE_NAME),
            method=method,
            csrf_token=(
                request.headers.get(CSRF_HEADER_NAME)
                if method != "GET"
                else None
            ),
        )
    except SessionCSRFRejected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="CSRF verification failed.",
        ) from None
    except SessionUnavailable:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Sign in again.",
        ) from None
    if principal.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return principal


def _item(user: User) -> AdminUserItem:
    return AdminUserItem(
        user_id=user.id_number,
        username=user.username,
        role=user.role,
        account_status=user.account_status,
        is_email_verified=bool(user.is_email_verified),
        department=user.department,
        created_at=user.created_at,
    )


@router.get("", response_model=AdminUsersPage)
def list_admin_users(
    request: Request,
    response: Response,
    db: DbSession,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=50),
    role: Literal["student", "instructor", "technician", "admin"] | None = None,
    search: str | None = Query(default=None, max_length=50),
) -> AdminUsersPage:
    _require_admin(request, db, method="GET")
    try:
        conditions = []
        if role is not None:
            conditions.append(User.role == role)
        if search and search.strip():
            cleaned = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            conditions.append(User.username.ilike(f"%{cleaned}%", escape="\\"))

        with db.begin():
            total = int(
                db.execute(select(func.count(User.id_number)).where(*conditions)).scalar_one()
            )
            users = db.execute(
                select(User)
                .where(*conditions)
                .order_by(User.created_at.desc(), User.id_number.asc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            ).scalars().all()
            result = AdminUsersPage(
                items=[_item(user) for user in users],
                total=total,
                page=page,
                page_size=page_size,
                pages=ceil(total / page_size),
            )
        response.headers["Cache-Control"] = "no-store"
        return result
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="User management is temporarily unavailable.",
        ) from None


@router.patch("/{user_id}/role", response_model=AdminRoleChangeResponse)
def change_user_role(
    user_id: str,
    payload: AdminRoleChangeRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> AdminRoleChangeResponse:
    principal = _require_admin(request, db, method="PATCH")
    if _USER_ID_PATTERN.fullmatch(user_id) is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if principal.user_id == user_id:
        raise HTTPException(status_code=403, detail="Cannot change your own administrator role.")
    if payload.role not in _ASSIGNABLE_ROLES:
        raise HTTPException(status_code=422, detail="Unsupported account role.")

    client_ip = _trusted_local_request(request)
    try:
        with db.begin():
            actor = db.execute(
                select(User).where(User.id_number == principal.user_id).with_for_update()
            ).scalar_one_or_none()
            if actor is None or actor.role != "admin" or actor.account_status != "active":
                raise HTTPException(status_code=403, detail="Administrator access required.")

            target = db.execute(
                select(User).where(User.id_number == user_id).with_for_update()
            ).scalar_one_or_none()
            if target is None:
                raise HTTPException(status_code=404, detail="User not found.")
            if target.role == "admin":
                raise HTTPException(status_code=403, detail="Administrator roles cannot be modified here.")
            if target.role not in _ASSIGNABLE_ROLES:
                raise HTTPException(status_code=409, detail="User has an unsupported current role.")
            if target.account_status != "active" or target.is_email_verified is not True:
                raise HTTPException(
                    status_code=409,
                    detail="The account must be active and email-verified before changing roles.",
                )

            previous_role = target.role
            changed = previous_role != payload.role
            if changed:
                now = datetime.now(timezone.utc)
                target.role = payload.role
                target.updated_at = now

                db.execute(
                    update(auth_sessions)
                    .where(
                        auth_sessions.c.user_id == user_id,
                        auth_sessions.c.revoked_at.is_(None),
                    )
                    .values(revoked_at=now)
                )
                db.add(
                    ActivityLog(
                        event_type="admin_user_role_changed",
                        user_id=principal.user_id,
                        ip_address=client_ip,
                        user_agent=request.headers.get("user-agent", "")[:500],
                        details={
                            "target_user_id": user_id,
                            "previous_role": previous_role,
                            "new_role": payload.role,
                        },
                    )
                )
            result = AdminRoleChangeResponse(
                user=_item(target),
                previous_role=previous_role,
                changed=changed,
                message=(
                    "Role updated. The user must sign in again."
                    if changed else "The account already has this role."
                ),
            )
        response.headers["Cache-Control"] = "no-store"
        return result
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="User management is temporarily unavailable.",
        ) from None
