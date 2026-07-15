from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent

load_dotenv(PROJECT_DIR / ".env")
load_dotenv(BACKEND_DIR / ".env", override=True)


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


def _cors_origins() -> tuple[str, ...]:
    configured = _csv(
        os.getenv(
            "CORS_ORIGINS",
            "http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173",
        )
    )
    # Content-script fetches carry the page origin in current Chromium builds.
    required = ("https://music.youtube.com",)
    return tuple(dict.fromkeys((*configured, *required)))


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    host: str = os.getenv("HOST", "127.0.0.1")
    port: int = int(os.getenv("PORT", "8000"))
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./lyrikana.db")
    lrclib_base_url: str = os.getenv("LRCLIB_BASE_URL", "https://lrclib.net").rstrip("/")
    cors_origins: tuple[str, ...] = _cors_origins()
    log_level: str = os.getenv("LOG_LEVEL", "INFO").upper()
    lrclib_timeout_seconds: float = float(os.getenv("LRCLIB_TIMEOUT_SECONDS", "10"))


settings = Settings()
