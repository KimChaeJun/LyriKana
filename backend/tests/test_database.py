from sqlalchemy import create_engine, text

from app import database
from app.models import SongInfo  # noqa: F401 - registers table metadata


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
