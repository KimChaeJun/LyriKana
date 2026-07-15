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


def test_lrclib_retries_transient_read_timeouts(monkeypatch):
    calls = 0
    delays = []

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return [
                {
                    "trackName": "Song",
                    "artistName": "Artist",
                    "syncedLyrics": "[00:01]line",
                }
            ]

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, params):
            nonlocal calls
            calls += 1
            if calls < 3:
                raise lrclib.httpx.ReadTimeout("slow provider")
            assert params["track_name"] == "Song"
            return FakeResponse()

    async def fake_sleep(delay):
        delays.append(delay)

    monkeypatch.setattr(lrclib.httpx, "AsyncClient", FakeClient)
    monkeypatch.setattr(lrclib.asyncio, "sleep", fake_sleep)

    selected = asyncio.run(
        lrclib.fetch_best_lrclib_lyrics(title="Song", artist="Artist")
    )

    assert selected["syncedLyrics"] == "[00:01]line"
    assert calls == 3
    assert delays == [0.4, 0.8]


def test_lrclib_prefers_artist_prefix_over_unrelated_artist_prefix(monkeypatch):
    candidates = [
        {
            "trackName": "GOOD DAY",
            "artistName": "Song, Mrs. GREEN APPLE",
            "albumName": None,
            "duration": 257,
            "syncedLyrics": "[00:01]wrong",
        },
        {
            "trackName": "GOOD DAY",
            "artistName": "Mrs. GREEN APPLE, 20M plays",
            "albumName": "GOOD DAY",
            "duration": 257,
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
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url, params):
            assert params["artist_name"] == "Mrs. GREEN APPLE"
            return FakeResponse()

    monkeypatch.setattr(lrclib.httpx, "AsyncClient", FakeClient)

    selected = asyncio.run(
        lrclib.fetch_best_lrclib_lyrics(
            title="GOOD DAY",
            artist="Mrs. GREEN APPLE",
            duration=258,
        )
    )

    assert selected["syncedLyrics"] == "[00:01]right"
