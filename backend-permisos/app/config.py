import os
from dataclasses import dataclass


def _csv(name: str, default: str = "") -> list[str]:
    return [x.strip().lower() for x in os.getenv(name, default).split(",") if x.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "")
    frontend_origins: tuple[str, ...] = tuple(
        x.strip()
        for x in os.getenv(
            "FRONTEND_ORIGINS",
            "https://ersep-innova.github.io,https://ersepobservatorio-cyt.github.io,http://localhost:8000,http://127.0.0.1:8000",
        ).split(",")
        if x.strip()
    )

    # Acceso local simple (sin Google Login).
    bootstrap_admin_username: str = os.getenv("BOOTSTRAP_ADMIN_USERNAME", "admin")
    bootstrap_admin_password: str = os.getenv("BOOTSTRAP_ADMIN_PASSWORD", "")
    bootstrap_admin_email: str = os.getenv("BOOTSTRAP_ADMIN_EMAIL", "")
    auth_session_hours: int = int(os.getenv("AUTH_SESSION_HOURS", "12"))

    # Google queda únicamente como integración opcional de Sheets.
    google_oauth_client_id: str = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    google_oauth_client_secret: str = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    google_sheet_id: str = os.getenv("GOOGLE_SHEET_ID", "")
    google_sheets_redirect_uri: str = os.getenv(
        "GOOGLE_SHEETS_REDIRECT_URI",
        "https://portal-observatorio-ersep-permisos.onrender.com/api/google-sheets/callback",
    )
    permisos_frontend_url: str = os.getenv(
        "PERMISOS_FRONTEND_URL",
        "https://ersep-innova.github.io/portal/modulos/permisos-salida/",
    )
    sheets_enabled: bool = os.getenv("SHEETS_ENABLED", "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


settings = Settings()
