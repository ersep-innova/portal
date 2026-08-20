import os
from dataclasses import dataclass


def _csv(name: str, default: str = "") -> list[str]:
    return [x.strip().lower() for x in os.getenv(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "")
    frontend_origins: tuple[str, ...] = tuple(
        x.strip() for x in os.getenv(
            "FRONTEND_ORIGINS",
            "https://ersepobservatorio-cyt.github.io,http://localhost:8000,http://127.0.0.1:8000"
        ).split(",") if x.strip()
    )
    google_oauth_client_id: str = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    bootstrap_admin_emails: tuple[str, ...] = tuple(_csv("BOOTSTRAP_ADMIN_EMAILS"))
    google_oauth_client_secret: str = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    google_sheet_id: str = os.getenv("GOOGLE_SHEET_ID", "")
    google_sheets_redirect_uri: str = os.getenv(
        "GOOGLE_SHEETS_REDIRECT_URI",
        "https://portal-observatorio-ersep-permisos.onrender.com/api/google-sheets/callback"
    )
    permisos_frontend_url: str = os.getenv(
        "PERMISOS_FRONTEND_URL",
        "https://ersepobservatorio-cyt.github.io/portal-observatorio-ersep/modulos/permisos-salida/"
    )
    sheets_enabled: bool = os.getenv("SHEETS_ENABLED", "true").lower() in {"1", "true", "yes", "on"}


settings = Settings()
