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
    google_credentials_json: str = os.getenv("GOOGLE_CREDENTIALS_JSON", "")
    google_sheet_id: str = os.getenv("GOOGLE_SHEET_ID", "")
    sheets_enabled: bool = os.getenv("SHEETS_ENABLED", "true").lower() in {"1", "true", "yes", "on"}


settings = Settings()
