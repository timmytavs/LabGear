
"""LabGear Backend File 57: FastAPI application and local React CORS.

Destination: backend/app/main.py (REPLACE existing file).

Preserves the existing root health message and Vite development origins.
Mounts File 56 registration endpoints without changing database tables or
invoking SMTP on application startup.

Start from backend/: python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.registration import router as registration_router


app = FastAPI(
    title="LabGear API",
    description="School Laboratory Equipment Reservation System",
    version="1.0.0",
)

# Only the two known local Vite origins may make browser requests.
# CORS is not a replacement for authentication, CSRF protection, or rate limits.
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

# File 56 defines /api/auth/register, /register/verify-otp, /register/resend-otp.
# Route registration itself does not connect to PostgreSQL or send email.
app.include_router(registration_router)


@app.get("/", tags=["System"])
def read_root() -> dict[str, str]:
    """Preserve the original LabGear backend status response."""
    return {
        "message": "LabGear FastAPI backend is running",
        "status": "success",
    }
