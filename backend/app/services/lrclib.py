from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import settings
from app.services.normalization import normalize_song_part


logger = logging.getLogger(__name__)


def _score_candidate(
    candidate: dict[str, Any],
    *,
    title: str,
    artist: str | None,
    album: str | None,
    duration: int | None,
) -> float:
    score = 1000.0 if candidate.get("syncedLyrics") else 100.0
    candidate_title = normalize_song_part(candidate.get("trackName"))
    candidate_artist = normalize_song_part(candidate.get("artistName"))
    candidate_album = normalize_song_part(candidate.get("albumName"))

    if candidate_title == normalize_song_part(title):
        score += 250
    elif normalize_song_part(title) in candidate_title or candidate_title in normalize_song_part(title):
        score += 80

    normalized_artist = normalize_song_part(artist)
    if normalized_artist and candidate_artist == normalized_artist:
        score += 180
    elif normalized_artist and normalized_artist in candidate_artist:
        score += 70

    if album and candidate_album == normalize_song_part(album):
        score += 90

    candidate_duration = candidate.get("duration")
    if duration and isinstance(candidate_duration, (int, float)):
        delta = abs(float(candidate_duration) - duration)
        score += max(0, 160 - delta * 25)

    return score


async def fetch_best_lrclib_lyrics(
    *,
    title: str,
    artist: str | None = None,
    album: str | None = None,
    duration: int | None = None,
) -> dict[str, Any] | None:
    params: dict[str, str | int] = {"track_name": title}
    if artist:
        params["artist_name"] = artist
    if album:
        params["album_name"] = album
    url = f"{settings.lrclib_base_url}/api/search"
    headers = {"User-Agent": "LyriKana/0.1 (https://github.com/KimChaeJun/LyriKana)"}
    async with httpx.AsyncClient(
        timeout=settings.lrclib_timeout_seconds,
        headers=headers,
    ) as client:
        response = await client.get(url, params=params)

    if response.status_code == 404:
        return None
    response.raise_for_status()
    payload = response.json()
    candidates = payload if isinstance(payload, list) else [payload]
    usable = [
        candidate
        for candidate in candidates
        if isinstance(candidate, dict)
        and (candidate.get("syncedLyrics") or candidate.get("plainLyrics"))
    ]
    logger.info("LRCLIB candidates received count=%d", len(usable))
    if not usable:
        return None

    selected = max(
        usable,
        key=lambda candidate: _score_candidate(
            candidate,
            title=title,
            artist=artist,
            album=album,
            duration=duration,
        ),
    )
    logger.info(
        "LRCLIB candidate selected track=%r artist=%r album=%r duration=%r synced=%s",
        selected.get("trackName"),
        selected.get("artistName"),
        selected.get("albumName"),
        selected.get("duration"),
        bool(selected.get("syncedLyrics")),
    )
    return selected
