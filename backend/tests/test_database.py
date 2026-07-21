from sqlalchemy import create_engine, text

from app import database
from app.models import SongInfo, Work  # noqa: F401 - registers table metadata


def test_migration_preserves_existing_canonical_normalized_identity(tmp_path, monkeypatch):
    test_engine = create_engine(f"sqlite:///{tmp_path / 'migration.db'}")
    database.Base.metadata.create_all(test_engine)
    with test_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO song_info "
                "(id, title, artist, normalized_title, normalized_artist, source, status, "
                "progress_total, progress_completed, progress_failed) "
                "VALUES ('song-id', 'GOOD DAY', 'Song, Mrs. GREEN APPLE', "
                "'good day', 'mrs. green apple', 'lrclib', 'completed', 1, 1, 0)"
            )
        )

    monkeypatch.setattr(database, "engine", test_engine)
    database._migrate_song_info_columns()

    with test_engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT normalized_title, normalized_artist "
                "FROM song_info WHERE id='song-id'"
            )
        ).mappings().one()

    assert row["normalized_title"] == "good day"
    assert row["normalized_artist"] == "mrs. green apple"
    test_engine.dispose()


def test_migration_replaces_title_artist_uniqueness_with_recording_identity(
    tmp_path, monkeypatch
):
    test_engine = create_engine(f"sqlite:///{tmp_path / 'recording-migration.db'}")
    Work.__table__.create(test_engine)
    with test_engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE song_info ("
                "id VARCHAR(64) PRIMARY KEY, title VARCHAR(255) NOT NULL, artist VARCHAR(255), "
                "normalized_title VARCHAR(255) NOT NULL, normalized_artist VARCHAR(255) NOT NULL, "
                "album VARCHAR(255), duration INTEGER, source VARCHAR(50) NOT NULL, raw_lrc TEXT, "
                "status VARCHAR(30) NOT NULL, progress_total INTEGER NOT NULL DEFAULT 0, "
                "progress_completed INTEGER NOT NULL DEFAULT 0, progress_failed INTEGER NOT NULL DEFAULT 0, "
                "error_message TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME, CONSTRAINT uq_song_info_identity "
                "UNIQUE (normalized_title, normalized_artist))"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE lyrics (id INTEGER PRIMARY KEY, song_id VARCHAR(64) NOT NULL, "
                "line_no INTEGER NOT NULL, time FLOAT, original TEXT NOT NULL, reading TEXT, "
                "kr TEXT, jp TEXT, en TEXT, user_edit BOOLEAN NOT NULL DEFAULT 0, "
                "reason_tags TEXT NOT NULL DEFAULT '[]', FOREIGN KEY(song_id) REFERENCES song_info(id))"
            )
        )
        connection.execute(
            text(
                "INSERT INTO song_info "
                "(id, title, artist, normalized_title, normalized_artist, source, status) "
                "VALUES ('legacy-recording', 'Song', 'Artist', 'song', 'artist', 'lrclib', 'completed')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO lyrics (id, song_id, line_no, time, original) "
                "VALUES (1, 'legacy-recording', 0, 1.0, 'line')"
            )
        )

    monkeypatch.setattr(database, "engine", test_engine)
    database._migrate_song_info_columns()

    with test_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO song_info "
                "(id, title, artist, normalized_title, normalized_artist, recording_key, source, status) "
                "VALUES ('live-recording', 'Song', 'Artist', 'song', 'artist', "
                "'youtube_music:live', 'manual', 'pending')"
            )
        )
        assert connection.execute(text("SELECT COUNT(*) FROM song_info")).scalar_one() == 2
        assert connection.execute(
            text("SELECT original FROM lyrics WHERE song_id='legacy-recording'")
        ).scalar_one() == "line"

    test_engine.dispose()
