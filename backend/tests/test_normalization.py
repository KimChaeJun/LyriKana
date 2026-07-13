from app.services.normalization import make_song_id, normalize_song_part


def test_song_normalization_is_unicode_case_and_space_stable():
    assert normalize_song_part("  ＳＯＮＧ   Title ") == "song title"
    assert make_song_id("ＳＯＮＧ", "ARTIST") == make_song_id("song", "artist")


def test_song_normalization_removes_non_identity_video_suffix():
    assert normalize_song_part("Song (Official Video)") == "song"
