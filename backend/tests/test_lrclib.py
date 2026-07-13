import asyncio

from app.services import lrclib


def test_lrclib_candidate_selection_uses_metadata_and_documented_search_params(monkeypatch):
    captured = {}
    candidates = [
        {
            "trackName": "Song",
            "artistName": "Artist",
            "albumName": "Wrong Album",
            "duration": 240,
            "syncedLyrics": "[00:01]wrong",
        },
        {
            "trackName": "Song",
            "artistName": "Artist",
            "albumName": "Album",
            "duration": 180,
            "syncedLyrics": "[00:01]right",
        },
    ]

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return candidates

    class FakeClient:
        def __init__(self, **kwargs):
            captured["client"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, url, params):
            captured["url"] = url
            captured["params"] = params
            return FakeResponse()

    monkeypatch.setattr(lrclib.httpx, "AsyncClient", FakeClient)
    selected = asyncio.run(
        lrclib.fetch_best_lrclib_lyrics(
            title="Song",
            artist="Artist",
            album="Album",
            duration=180,
        )
    )

    assert selected["syncedLyrics"] == "[00:01]right"
    assert captured["params"] == {
        "track_name": "Song",
        "artist_name": "Artist",
        "album_name": "Album",
    }
    assert "LyriKana" in captured["client"]["headers"]["User-Agent"]
