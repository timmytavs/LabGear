
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="LabGear API",
    description="School Laboratory Equipment Reservation System",
    version="1.0.0"
)

# Allow the React development frontend
allowed_origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173"
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-CSRF-Token"]
)


@app.get("/")
def home():
    return {
        "message": "LabGear FastAPI backend is running",
        "status": "success"
    }
