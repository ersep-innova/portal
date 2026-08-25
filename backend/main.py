from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.boletin_routes import create_boletin_router

BASE_DIR = Path(__file__).resolve().parent
logger = logging.getLogger("boletin_backend")
load_dotenv(BASE_DIR / ".env.local", override=True)
load_dotenv(BASE_DIR / ".env", override=False)

HTTP_TIMEOUT = max(10, int(os.getenv("SCRAPER_HTTP_TIMEOUT", "45")))
DATA_ROOT = Path(os.getenv("DATA_ROOT", str(BASE_DIR / "data"))).expanduser().resolve()
FRONTEND_ORIGINS = [
    origin.strip().rstrip("/")
    for origin in os.getenv(
        "FRONTEND_ORIGINS",
        "https://ersep-innova.github.io,https://ersepobservatorio-cyt.github.io",
    ).split(",")
    if origin.strip()
]

app = FastAPI(
    title="Boletín Oficial · Portal de Innovación y Análisis de Datos",
    version="2.0.0",
    docs_url=None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["Content-Disposition"],
    max_age=86400,
)


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
        "service": "Boletín Oficial · Portal de Innovación y Análisis de Datos",
        "frontend": "https://ersep-innova.github.io/portal/",
        "health": "/api/health",
    }


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "boletin-innovacion-analisis-datos-ersep",
        "module": "boletin-oficial",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "storage": "sqlite-local",
    }


app.include_router(create_boletin_router(DATA_ROOT, HTTP_TIMEOUT))


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception):
    logger.exception("Error interno no controlado en %s", request.url.path, exc_info=exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Se produjo un error interno en el buscador del Boletín Oficial."},
    )
