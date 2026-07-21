from __future__ import annotations

import json
import logging

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings


logger = logging.getLogger(__name__)

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


if settings.database_url.startswith("sqlite"):

    @event.listens_for(Engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _migrate_song_info_columns() -> None:
    inspector = inspect(engine)
    if "song_info" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("song_info")}
    additions = {
        "normalized_title": "VARCHAR(255)",
        "normalized_artist": "VARCHAR(255) DEFAULT ''",
        "work_id": "VARCHAR(64)",
        "recording_key": "VARCHAR(320)",
        "provider": "VARCHAR(50) NOT NULL DEFAULT 'youtube_music'",
        "provider_recording_id": "VARCHAR(255)",
        "performer": "VARCHAR(255)",
        "version_type": "VARCHAR(30) NOT NULL DEFAULT 'unknown'",
        "audio_fingerprint": "VARCHAR(255)",
        "status": "VARCHAR(30) NOT NULL DEFAULT 'pending'",
        "progress_total": "INTEGER NOT NULL DEFAULT 0",
        "progress_completed": "INTEGER NOT NULL DEFAULT 0",
        "progress_failed": "INTEGER NOT NULL DEFAULT 0",
        "error_message": "TEXT",
        "raw_lrc": "TEXT",
        "updated_at": "DATETIME",
    }

    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE song_info ADD COLUMN {name} {definition}"))

        rows = connection.execute(
            text(
                "SELECT id, title, artist FROM song_info "
                "WHERE normalized_title IS NULL OR normalized_title = '' "
                "OR normalized_artist IS NULL "
                "OR (COALESCE(artist, '') != '' AND normalized_artist = '')"
            )
        ).mappings()
        for row in rows:
            from app.services.normalization import normalize_song_part

            connection.execute(
                text(
                    "UPDATE song_info SET normalized_title=:title, normalized_artist=:artist, "
                    "updated_at=COALESCE(updated_at, created_at) WHERE id=:id"
                ),
                {
                    "id": row["id"],
                    "title": normalize_song_part(row["title"]),
                    "artist": normalize_song_part(row["artist"]),
                },
            )

    _rebuild_legacy_song_info_identity()


def _rebuild_legacy_song_info_identity() -> None:
    """Remove the old title/artist uniqueness constraint without losing lyric FKs."""
    if engine.dialect.name != "sqlite":
        return

    with engine.connect() as connection:
        table_sql = connection.execute(
            text("SELECT sql FROM sqlite_master WHERE type='table' AND name='song_info'")
        ).scalar_one_or_none()
    normalized_sql = " ".join((table_sql or "").lower().replace('"', "").split())
    has_legacy_constraint = (
        "uq_song_info_identity" in normalized_sql
        or "unique (normalized_title, normalized_artist)" in normalized_sql
        or "unique(normalized_title, normalized_artist)" in normalized_sql
    )
    if not has_legacy_constraint:
        return

    raw_connection = engine.raw_connection()
    cursor = raw_connection.cursor()
    try:
        cursor.execute("PRAGMA foreign_keys=OFF")
        cursor.execute("BEGIN")
        cursor.execute("DROP TABLE IF EXISTS song_info_recording_migration")
        cursor.execute(
            """
            CREATE TABLE song_info_recording_migration (
                id VARCHAR(64) NOT NULL PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                artist VARCHAR(255),
                normalized_title VARCHAR(255) NOT NULL,
                normalized_artist VARCHAR(255) NOT NULL DEFAULT '',
                work_id VARCHAR(64),
                recording_key VARCHAR(320),
                provider VARCHAR(50) NOT NULL DEFAULT 'youtube_music',
                provider_recording_id VARCHAR(255),
                performer VARCHAR(255),
                version_type VARCHAR(30) NOT NULL DEFAULT 'unknown',
                audio_fingerprint VARCHAR(255),
                album VARCHAR(255),
                duration INTEGER,
                source VARCHAR(50) NOT NULL DEFAULT 'youtube_music',
                raw_lrc TEXT,
                status VARCHAR(30) NOT NULL DEFAULT 'pending',
                progress_total INTEGER NOT NULL DEFAULT 0,
                progress_completed INTEGER NOT NULL DEFAULT 0,
                progress_failed INTEGER NOT NULL DEFAULT 0,
                error_message TEXT,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                CONSTRAINT uq_song_info_recording_key UNIQUE (recording_key),
                FOREIGN KEY(work_id) REFERENCES works(id)
            )
            """
        )
        cursor.execute(
            """
            INSERT INTO song_info_recording_migration (
                id, title, artist, normalized_title, normalized_artist,
                work_id, recording_key, provider, provider_recording_id,
                performer, version_type, audio_fingerprint, album, duration,
                source, raw_lrc, status, progress_total, progress_completed,
                progress_failed, error_message, created_at, updated_at
            )
            SELECT
                id, title, artist, normalized_title, normalized_artist,
                work_id, recording_key, provider, provider_recording_id,
                performer, version_type, audio_fingerprint, album, duration,
                source, raw_lrc, status, progress_total, progress_completed,
                progress_failed, error_message,
                COALESCE(created_at, CURRENT_TIMESTAMP),
                COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
            FROM song_info
            """
        )
        cursor.execute("DROP TABLE song_info")
        cursor.execute("ALTER TABLE song_info_recording_migration RENAME TO song_info")
        for column in (
            "title",
            "artist",
            "normalized_title",
            "normalized_artist",
            "work_id",
            "recording_key",
            "provider_recording_id",
            "audio_fingerprint",
            "status",
        ):
            cursor.execute(f"CREATE INDEX IF NOT EXISTS ix_song_info_{column} ON song_info({column})")
        raw_connection.commit()
    except Exception:
        raw_connection.rollback()
        logger.exception("Could not migrate song_info to recording identity")
        raise
    finally:
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
        raw_connection.close()


def _migrate_lyric_columns() -> None:
    inspector = inspect(engine)
    if "lyrics" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("lyrics")}
    additions = {
        "end_time": "FLOAT",
        "sung_reading": "TEXT",
        "confidence": "FLOAT",
        "source": "VARCHAR(50) NOT NULL DEFAULT 'provider'",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE lyrics ADD COLUMN {name} {definition}"))


def _migrate_analysis_job_columns() -> None:
    inspector = inspect(engine)
    if "analysis_jobs" not in inspector.get_table_names():
        return

    existing = {column["name"] for column in inspector.get_columns("analysis_jobs")}
    additions = {
        "audio_asset_id": "VARCHAR(64)",
        "attempt_count": "INTEGER NOT NULL DEFAULT 0",
        "worker_id": "VARCHAR(255)",
        "heartbeat_at": "DATETIME",
        "lease_expires_at": "DATETIME",
        "started_at": "DATETIME",
        "completed_at": "DATETIME",
        "result_summary": "TEXT",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name not in existing:
                connection.execute(text(f"ALTER TABLE analysis_jobs ADD COLUMN {name} {definition}"))
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_jobs_audio_asset_id "
                "ON analysis_jobs(audio_asset_id)"
            )
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_analysis_jobs_lease_expires_at "
                "ON analysis_jobs(lease_expires_at)"
            )
        )


def _backfill_recording_metadata() -> None:
    inspector = inspect(engine)
    if "song_info" not in inspector.get_table_names() or "works" not in inspector.get_table_names():
        return

    from app.services.normalization import (
        make_recording_key,
        make_work_id,
        normalize_song_part,
    )

    with engine.begin() as connection:
        rows = connection.execute(
            text(
                "SELECT id, title, artist, work_id, recording_key, performer "
                "FROM song_info WHERE work_id IS NULL OR recording_key IS NULL OR performer IS NULL"
            )
        ).mappings()
        for row in rows:
            normalized_title = normalize_song_part(row["title"])
            normalized_artist = normalize_song_part(row["artist"])
            work_id = row["work_id"] or make_work_id(row["title"], row["artist"])
            recording_key = row["recording_key"] or make_recording_key(
                row["title"], row["artist"]
            )
            connection.execute(
                text(
                    "INSERT OR IGNORE INTO works "
                    "(id, title, artist, normalized_title, normalized_artist, created_at, updated_at) "
                    "VALUES (:id, :title, :artist, :normalized_title, :normalized_artist, "
                    "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
                ),
                {
                    "id": work_id,
                    "title": row["title"],
                    "artist": row["artist"],
                    "normalized_title": normalized_title,
                    "normalized_artist": normalized_artist,
                },
            )
            connection.execute(
                text(
                    "UPDATE song_info SET work_id=:work_id, recording_key=:recording_key, "
                    "performer=COALESCE(performer, artist), provider=COALESCE(provider, 'youtube_music'), "
                    "version_type=COALESCE(version_type, 'unknown') WHERE id=:id"
                ),
                {
                    "id": row["id"],
                    "work_id": work_id,
                    "recording_key": recording_key,
                },
            )


def _migrate_legacy_lyric_rows() -> None:
    inspector = inspect(engine)
    if "lyric" not in inspector.get_table_names() or "lyrics" not in inspector.get_table_names():
        return

    with engine.begin() as connection:
        legacy_rows = connection.execute(
            text("SELECT song_id, status, lyric_lines_json FROM lyric")
        ).mappings()

        for legacy in legacy_rows:
            exists = connection.execute(
                text("SELECT 1 FROM lyrics WHERE song_id=:song_id LIMIT 1"),
                {"song_id": legacy["song_id"]},
            ).first()
            if exists:
                continue

            try:
                lines = json.loads(legacy["lyric_lines_json"] or "[]")
            except (TypeError, json.JSONDecodeError):
                logger.warning("Skipping invalid legacy lyric JSON for song %s", legacy["song_id"])
                continue

            for index, line in enumerate(lines):
                connection.execute(
                    text(
                        "INSERT OR IGNORE INTO lyrics "
                        "(song_id, line_no, time, original, reading, kr, jp, en, user_edit, reason_tags) "
                        "VALUES (:song_id, :line_no, :time, :original, :reading, :kr, :jp, :en, 0, '[]')"
                    ),
                    {
                        "song_id": legacy["song_id"],
                        "line_no": index,
                        "time": line.get("time"),
                        "original": line.get("original") or "",
                        "reading": line.get("reading") or line.get("hiragana") or None,
                        "kr": line.get("kr") or line.get("korean_pronunciation") or None,
                        "jp": line.get("jp") or line.get("hard_mapped_pronunciation") or None,
                        "en": line.get("en") or line.get("english_pronunciation") or None,
                    },
                )

            completed = sum(
                1
                for line in lines
                if line.get("reading")
                or line.get("hiragana")
                or line.get("kr")
                or line.get("korean_pronunciation")
            )
            status = "completed" if lines and completed == len(lines) else "processing"
            connection.execute(
                text(
                    "UPDATE song_info SET status=:status, progress_total=:total, "
                    "progress_completed=:completed WHERE id=:song_id"
                ),
                {
                    "song_id": legacy["song_id"],
                    "status": status,
                    "total": len(lines),
                    "completed": completed,
                },
            )


def init_database() -> None:
    from app import models  # noqa: F401 - registers SQLAlchemy metadata

    Base.metadata.create_all(bind=engine)
    if settings.database_url.startswith("sqlite"):
        _migrate_song_info_columns()
        _migrate_lyric_columns()
        _migrate_analysis_job_columns()
        Base.metadata.create_all(bind=engine)
        _backfill_recording_metadata()
        _migrate_legacy_lyric_rows()
