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


def _path_env(name: str, default: Path) -> Path:
    configured = Path(os.getenv(name, str(default))).expanduser()
    if not configured.is_absolute():
        configured = PROJECT_DIR / configured
    return configured.resolve()


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
    analysis_data_dir: Path = _path_env(
        "ANALYSIS_DATA_DIR", BACKEND_DIR / ".analysis-data"
    )
    analysis_model_dir: Path = _path_env(
        "ANALYSIS_MODEL_DIR", BACKEND_DIR / ".analysis-data" / "models"
    )
    analysis_ffmpeg_dir: Path = _path_env(
        "ANALYSIS_FFMPEG_DIR", BACKEND_DIR / ".analysis-tools"
    )
    analysis_max_upload_bytes: int = int(
        os.getenv("ANALYSIS_MAX_UPLOAD_BYTES", str(750 * 1024 * 1024))
    )
    analysis_separator: str = os.getenv("ANALYSIS_SEPARATOR", "auto").strip().casefold()
    analysis_separator_command: str = os.getenv(
        "ANALYSIS_SEPARATOR_COMMAND", "audio-separator"
    ).strip()
    analysis_separator_model: str | None = (
        os.getenv(
            "ANALYSIS_SEPARATOR_MODEL", "UVR-MDX-NET-Inst_HQ_3.onnx"
        ).strip()
        or None
    )
    analysis_demucs_model: str = os.getenv("ANALYSIS_DEMUCS_MODEL", "htdemucs").strip()
    analysis_device: str = os.getenv("ANALYSIS_DEVICE", "cuda").strip().casefold()
    analysis_aligner: str = os.getenv("ANALYSIS_ALIGNER", "auto").strip().casefold()
    analysis_aligner_command: str | None = (
        os.getenv("ANALYSIS_ALIGNER_COMMAND", "").strip() or None
    )
    analysis_ctc_python: Path = _path_env(
        "ANALYSIS_CTC_PYTHON",
        BACKEND_DIR
        / ".venv-analysis"
        / ("Scripts/python.exe" if os.name == "nt" else "bin/python"),
    )
    analysis_ctc_script: Path = _path_env(
        "ANALYSIS_CTC_SCRIPT", BACKEND_DIR / "aligners" / "japanese_ctc_aligner.py"
    )
    analysis_ctc_model: str = os.getenv(
        "ANALYSIS_CTC_MODEL", "prj-beatrice/japanese-hubert-base-phoneme-ctc-v4"
    ).strip()
    analysis_ctc_cache_dir: Path = _path_env(
        "ANALYSIS_CTC_CACHE_DIR", BACKEND_DIR / ".analysis-data" / "huggingface"
    )
    analysis_ctc_max_paths: int = int(os.getenv("ANALYSIS_CTC_MAX_PATHS", "8"))
    analysis_ctc_chunk_seconds: float = float(
        os.getenv("ANALYSIS_CTC_CHUNK_SECONDS", "25")
    )
    analysis_mfa_command: str = os.getenv("ANALYSIS_MFA_COMMAND", "mfa").strip()
    analysis_mfa_dictionary: str = os.getenv(
        "ANALYSIS_MFA_DICTIONARY", "japanese_mfa"
    ).strip()
    analysis_mfa_acoustic_model: str = os.getenv(
        "ANALYSIS_MFA_ACOUSTIC_MODEL", "japanese_mfa"
    ).strip()
    analysis_mfa_g2p_model: str | None = (
        os.getenv("ANALYSIS_MFA_G2P_MODEL", "japanese_mfa").strip() or None
    )
    analysis_command_timeout_seconds: float = float(
        os.getenv("ANALYSIS_COMMAND_TIMEOUT_SECONDS", "7200")
    )
    analysis_worker_poll_seconds: float = float(
        os.getenv("ANALYSIS_WORKER_POLL_SECONDS", "2")
    )
    analysis_worker_lease_seconds: int = int(
        os.getenv("ANALYSIS_WORKER_LEASE_SECONDS", "900")
    )
    analysis_worker_max_attempts: int = int(
        os.getenv("ANALYSIS_WORKER_MAX_ATTEMPTS", "3")
    )
    analysis_low_confidence_threshold: float = float(
        os.getenv("ANALYSIS_LOW_CONFIDENCE_THRESHOLD", "0.55")
    )


settings = Settings()
