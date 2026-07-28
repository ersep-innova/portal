from __future__ import annotations

import hashlib
import hmac
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from starlette.responses import JSONResponse

from app.boletin_routes import create_boletin_router

BASE_DIR = Path(__file__).resolve().parent
logger = logging.getLogger("boletin_backend")
load_dotenv(BASE_DIR / ".env.local", override=True)
load_dotenv(BASE_DIR / ".env", override=False)

APP_PASSWORD = os.getenv("APP_PASSWORD", "").strip()
JWT_SECRET = os.getenv("JWT_SECRET", "").strip()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = max(1, int(os.getenv("JWT_EXPIRE_HOURS", "12")))
HTTP_TIMEOUT = max(10, int(os.getenv("SCRAPER_HTTP_TIMEOUT", "45")))
DATA_ROOT = Path(os.getenv("DATA_ROOT", str(BASE_DIR / "data"))).expanduser().resolve()
FRONTEND_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "https://ersepobservatorio-cyt.github.io",
    ).split(",")
    if origin.strip()
]

if not APP_PASSWORD:
    raise RuntimeError("Falta configurar APP_PASSWORD en Render.")
if not JWT_SECRET:
    raise RuntimeError("Falta configurar JWT_SECRET en Render.")

app = FastAPI(
    title="Boletín Oficial · Portal Observatorio ERSeP",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
    max_age=86400,
)

security = HTTPBearer(auto_error=False)


def create_token() -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": "portal-observatorio-ersep",
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> bool:
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return True
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return False


def require_auth(credentials: HTTPAuthorizationCredentials = Depends(security)) -> bool:
    if not credentials or not verify_token(credentials.credentials):
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada.")
    return True


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.get("/")
def root():
    return {
        "ok": True,
        "service": "Boletín Oficial · Portal Observatorio ERSeP",
        "frontend": "https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/",
        "health": "/api/health",
    }


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "boletin-observatorio-ersep",
        "module": "boletin-oficial",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "storage": "sqlite-local",
    }


@app.post("/api/login")
def login(body: dict):
    password = str(body.get("password", ""))
    supplied = hashlib.sha256(password.encode("utf-8")).digest()
    expected = hashlib.sha256(APP_PASSWORD.encode("utf-8")).digest()
    valid = hmac.compare_digest(supplied, expected)
    time.sleep(0.25)
    if not valid:
        raise HTTPException(status_code=401, detail="Contraseña incorrecta para el backend.")
    return {"token": create_token(), "expires_hours": JWT_EXPIRE_HOURS}


boletin_router = create_boletin_router(require_auth, DATA_ROOT, HTTP_TIMEOUT)
app.include_router(boletin_router)


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("Error interno no controlado en %s", request.url.path, exc_info=exc)
    # Evita filtrar rutas internas o trazas al navegador.
    return JSONResponse(
        status_code=500,
        content={"detail": "Se produjo un error interno en el backend del Boletín Oficial."},
    )
