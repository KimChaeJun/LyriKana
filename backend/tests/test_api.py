from __future__ import annotations

import time

from sqlalchemy import func, select

from app.models import Lyric, SongInfo
from app.services import jobs
from app.services.normalization import make_song_id


SAMPLE_LRC = "[00:01.00]日本語の歌詞\n[00:03.50]次の行"


def wait_for_status(client, song_id: str, expected: set[str]) -> dict:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        response = client.get(f"/api/v1/songs/{song_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["status"] in expected:
            return payload
        time.sleep(0.01)
    raise AssertionError(f"Song did not reach one of {expected}")


def test_resolve_cache_conversion_and_status(api_client, monkeypatch):
    client, test_session = api_client
    calls = 0

    async def fake_fetch(**_kwargs):
        nonlocal calls
        calls += 1
        return {
            "trackName": "Song",
            "artistName": "Artist",
            "albumName": "Album",
            "duration": 180.2,
            "syncedLyrics": SAMPLE_LRC,
        }

    monkeypatch.setattr(jobs, "fetch_best_lrclib_lyrics", fake_fetch)
    first = client.post(
        "/api/v1/songs/resolve",
        json={"title": " Song ", "artist": "ARTIST", "duration": 180},
    )
    assert first.status_code == 202
    assert first.json()["cacheHit"] is False
    song_id = first.json()["song"]["id"]

    prepared = wait_for_status(client, song_id, {"processing"})
    assert prepared["progress"] == {"total": 2, "completed": 0, "failed": 0}
    assert [line["lineNo"] for line in prepared["lyrics"]] == [0, 1]
    assert prepared["lyrics"][0]["time"] == 1.0
    assert prepared["lyrics"][0]["en"] is None

    converted = client.patch(
        f"/api/v1/songs/{song_id}/lyrics",
        json={
            "lyrics": [
                {"lineNo": 0, "reading": "にほんごのかし", "kr": "니혼고노카시", "jp": "nihongo no kashi", "en": ""},
                {"lineNo": 1, "reading": "つぎのぎょう", "kr": "츠기노교", "jp": "tsugi no gyou", "en": ""},
            ]
        },
    )
    assert converted.status_code == 200
    assert converted.json()["status"] == "completed"
    assert converted.json()["lyrics"][0]["en"] is None

    status = client.get(f"/api/v1/songs/{song_id}/status")
    assert status.json()["lyrics"] == []
    assert status.json()["progress"]["completed"] == 2

    second = client.post(
        "/api/v1/songs/resolve",
        json={"title": "song", "artist": "artist", "duration": 181},
    )
    assert second.status_code == 202
    assert second.json()["song"]["id"] == song_id
    assert second.json()["status"] == "completed"
    assert second.json()["cacheHit"] is True
    assert calls == 1

    with test_session() as db:
        assert db.scalar(select(func.count()).select_from(SongInfo)) == 1
        assert db.scalar(select(func.count()).select_from(Lyric)) == 2


def test_duplicate_requests_share_one_background_job(api_client, monkeypatch):
    client, _test_session = api_client
    calls = 0

    async def fake_fetch(**_kwargs):
        nonlocal calls
        calls += 1
        return {"trackName": "Race", "artistName": "Artist", "syncedLyrics": SAMPLE_LRC}

    monkeypatch.setattr(jobs, "fetch_best_lrclib_lyrics", fake_fetch)
    first = client.post("/api/v1/songs/resolve", json={"title": "Race", "artist": "Artist"})
    second = client.post("/api/v1/songs/resolve", json={"title": "race", "artist": "artist"})

    assert first.json()["song"]["id"] == second.json()["song"]["id"]
    wait_for_status(client, first.json()["song"]["id"], {"processing"})
    assert calls == 1


def test_provider_metadata_does_not_overwrite_request_identity(api_client, monkeypatch):
    client, test_session = api_client

    async def fake_fetch(**_kwargs):
        return {
            "trackName": "GOOD DAY",
            "artistName": "Song, Mrs. GREEN APPLE",
            "albumName": None,
            "duration": 257,
            "syncedLyrics": SAMPLE_LRC,
        }

    monkeypatch.setattr(jobs, "fetch_best_lrclib_lyrics", fake_fetch)
    response = client.post(
        "/api/v1/songs/resolve",
        json={"title": "GOOD DAY", "artist": "Mrs. GREEN APPLE", "duration": 258},
    )
    song_id = response.json()["song"]["id"]
    prepared = wait_for_status(client, song_id, {"processing"})

    assert prepared["song"]["title"] == "GOOD DAY"
    assert prepared["song"]["artist"] == "Mrs. GREEN APPLE"
    with test_session() as db:
        song = db.get(SongInfo, song_id)
        assert song.normalized_artist == "mrs. green apple"


def test_resolve_repairs_provider_mutated_identity_without_losing_cache(api_client):
    client, test_session = api_client
    song_id = make_song_id("GOOD DAY", "Mrs. GREEN APPLE")

    with test_session() as db:
        db.add(
            SongInfo(
                id=song_id,
                title="GOOD DAY",
                artist="Song, Mrs. GREEN APPLE",
                normalized_title="good day",
                normalized_artist="song, mrs. green apple",
                duration=257,
                source="lrclib",
                raw_lrc="[00:01.00]cached line",
                status="completed",
                progress_total=1,
                progress_completed=1,
            )
        )
        db.add(
            Lyric(
                song_id=song_id,
                line_no=0,
                time=1.0,
                original="cached line",
                reading="cached line",
            )
        )
        db.commit()

    response = client.post(
        "/api/v1/songs/resolve",
        json={"title": "GOOD DAY", "artist": "Mrs. GREEN APPLE", "duration": 258},
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["cacheHit"] is True
    assert payload["status"] == "completed"
    assert payload["song"]["id"] == song_id
    assert payload["song"]["artist"] == "Mrs. GREEN APPLE"
    assert [line["original"] for line in payload["lyrics"]] == ["cached line"]
    with test_session() as db:
        assert db.scalar(select(func.count()).select_from(SongInfo)) == 1
        repaired = db.get(SongInfo, song_id)
        assert repaired.normalized_artist == "mrs. green apple"


def test_lrclib_no_result_is_reported_as_failed(api_client, monkeypatch):
    client, _test_session = api_client

    async def fake_fetch(**_kwargs):
        return None

    monkeypatch.setattr(jobs, "fetch_best_lrclib_lyrics", fake_fetch)
    response = client.post(
        "/api/v1/songs/resolve", json={"title": "Missing", "artist": "Nobody"}
    )
    song_id = response.json()["song"]["id"]
    failed = wait_for_status(client, song_id, {"failed"})
    assert failed["error"] == "lyrics_not_found"
    assert failed["lyrics"] == []


def test_transient_provider_timeout_is_retried_on_next_resolve(api_client, monkeypatch):
    client, _test_session = api_client
    calls = 0

    async def flaky_fetch(**_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise jobs.httpx.ReadTimeout("slow provider")
        return {
            "trackName": "Retry Song",
            "artistName": "Artist",
            "syncedLyrics": SAMPLE_LRC,
        }

    monkeypatch.setattr(jobs, "fetch_best_lrclib_lyrics", flaky_fetch)
    first = client.post(
        "/api/v1/songs/resolve",
        json={"title": "Retry Song", "artist": "Artist"},
    )
    song_id = first.json()["song"]["id"]
    failed = wait_for_status(client, song_id, {"failed"})
    assert failed["error"] == "provider_timeout"

    second = client.post(
        "/api/v1/songs/resolve",
        json={"title": "Retry Song", "artist": "Artist"},
    )
    assert second.json()["cacheHit"] is True
    prepared = wait_for_status(client, song_id, {"processing"})
    assert prepared["error"] is None
    assert calls == 2


def test_partial_conversion_tracks_failed_lines(api_client, monkeypatch):
    client, _test_session = api_client

    async def fake_fetch(**_kwargs):
        return {"trackName": "Partial", "artistName": "Artist", "syncedLyrics": SAMPLE_LRC}

    monkeypatch.setattr(jobs, "fetch_best_lrclib_lyrics", fake_fetch)
    response = client.post(
        "/api/v1/songs/resolve", json={"title": "Partial", "artist": "Artist"}
    )
    song_id = response.json()["song"]["id"]
    wait_for_status(client, song_id, {"processing"})

    updated = client.patch(
        f"/api/v1/songs/{song_id}/lyrics",
        json={
            "lyrics": [
                {"lineNo": 0, "reading": "にほんご", "kr": "니혼고", "jp": "nihongo", "en": ""},
                {"lineNo": 1, "failed": True, "reasonTags": ["unsupported_language"]},
            ]
        },
    )
    assert updated.json()["status"] == "partial"
    assert updated.json()["progress"] == {"total": 2, "completed": 1, "failed": 1}
    assert "conversion_failed" in updated.json()["lyrics"][1]["reasonTags"]


def test_health_endpoint(api_client):
    client, _test_session = api_client
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
