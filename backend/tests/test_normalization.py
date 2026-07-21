from app.services.normalization import (
    make_recording_id,
    make_recording_key,
    make_song_id,
    normalize_song_part,
)


def test_song_normalization_is_unicode_case_and_space_stable():
    assert normalize_song_part("  ＳＯＮＧ   Title ") == "song title"
    assert make_song_id("ＳＯＮＧ", "ARTIST") == make_song_id("song", "artist")


def test_song_normalization_removes_non_identity_video_suffix():
    assert normalize_song_part("Song (Official Video)") == "song"


def test_recording_identity_prefers_provider_id_over_mutable_metadata():
    first = make_recording_id(
        "Song cover", "Creator", provider_recording_id="video-123"
    )
    renamed = make_recording_id(
        "Song / covered by Creator", "Creator", provider_recording_id="video-123"
    )

    assert first == renamed
    assert make_recording_key(
        "ignored", "ignored", provider_recording_id="video-123"
    ) == "youtube_music:video-123"
