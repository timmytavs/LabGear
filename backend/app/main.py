
"""LabGear Backend File 90 — FastAPI application with admin monitoring.

Destination: backend/app/main.py (REPLACE the installed File 86).

Preserves:
- Registration, login/session, equipment, and reservation routers.
- Password recovery routes (File 85).
- Existing local React CORS origins and credential support.
- Existing root health/status endpoint.
- Existing X-Frame-Options and X-Content-Type-Options security headers.
- Existing FastAPI application behavior and route registration.

Adds:
- Admin monitoring router (File 89): GET /api/admin/monitoring

SecurityHeadersMiddleware wraps the complete Starlette/FastAPI middleware
stack. This ensures the headers are added to normal responses, handled errors,
CORS preflight responses, and unhandled HTTP 500 responses.

Importing this module only registers the application and routes. It does not
create or alter database tables, run migrations, create reservations, or send
email/OTP messages.

Run from backend/:
    python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

For authenticated local browser sessions, use matching hostnames:
    React:   http://localhost:5173
    FastAPI: http://localhost:8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.datastructures import MutableHeaders

from app.api.routes.admin_monitoring import (
    router as admin_monitoring_router,
)
from app.api.routes.equipment import router as equipment_router
from app.api.routes.login import router as login_router
from app.api.routes.password_recovery import (
    router as password_recovery_router,
)
from app.api.routes.registration import router as registration_router
from app.api.routes.reservations import router as reservations_router


class SecurityHeadersMiddleware:
    """Add required security headers to every HTTP response.

    This is a pure ASGI middleware rather than BaseHTTPMiddleware. It wraps
    the complete FastAPI middleware stack, including ServerErrorMiddleware,
    so unhandled 500 responses receive the same security headers.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_security_headers(message):
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Frame-Options"] = "DENY"
                headers["X-Content-Type-Options"] = "nosniff"

            await send(message)

        await self.app(scope, receive, send_with_security_headers)


class LabGearFastAPI(FastAPI):
    """FastAPI application whose outermost layer enforces security headers."""

    def build_middleware_stack(self):
        application = super().build_middleware_stack()
        return SecurityHeadersMiddleware(application)


app = LabGearFastAPI(
    title="LabGear API",
    description="School Laboratory Equipment Reservation System",
    version="1.0.0",
)

# Exact local Vite origins. Cookies are permitted for authenticated requests.
# CORS does not replace server-side authentication, authorization, or CSRF.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"],
)

# Existing application routers.
app.include_router(registration_router)
app.include_router(login_router)
app.include_router(equipment_router)
app.include_router(reservations_router)

# File 85: password recovery using security-answer verification and email OTP.
app.include_router(password_recovery_router)

# File 89: protected, admin-only security monitoring dashboard data.
app.include_router(admin_monitoring_router)


@app.get("/", tags=["System"])
def read_root() -> dict[str, str]:
    """Preserve the existing LabGear backend status response."""
    return {
        "message": "LabGear FastAPI backend is running",
        "status": "success",
    }
