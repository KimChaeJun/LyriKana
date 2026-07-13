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

        rows = connection.execute(text("SELECT id, title, artist FROM song_info")).mappings()
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

        try:
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_song_info_identity "
                    "ON song_info(normalized_title, normalized_artist)"
                )
            )
        except Exception:
            logger.warning("Could not create the legacy song identity index", exc_info=True)


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
        Base.metadata.create_all(bind=engine)
        _migrate_legacy_lyric_rows()
