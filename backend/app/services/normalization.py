from __future__ import annotations

import hashlib
import re
import unicodedata


FEATURE_SUFFIX_RE = re.compile(
    r"\s*[\[(（【]\s*(?:feat\.?|ft\.?|featuring|official\s+(?:video|audio)|mv|music\s+video)[^\])）】]*[\])）】]",
    re.IGNORECASE,
)
WHITESPACE_RE = re.compile(r"\s+")


def normalize_song_part(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = FEATURE_SUFFIX_RE.sub("", normalized)
    normalized = WHITESPACE_RE.sub(" ", normalized).strip().casefold()
    return normalized


def make_song_id(title: str, artist: str | None) -> str:
    identity = f"{normalize_song_part(title)}|{normalize_song_part(artist)}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def make_work_id(title: str, artist: str | None) -> str:
    identity = f"work|{normalize_song_part(title)}|{normalize_song_part(artist)}"
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def make_recording_key(
    title: str,
    artist: str | None,
    *,
    provider: str = "youtube_music",
    provider_recording_id: str | None = None,
) -> str:
    normalized_provider = normalize_song_part(provider) or "local"
    normalized_recording_id = (provider_recording_id or "").strip()
    if normalized_recording_id:
        return f"{normalized_provider}:{normalized_recording_id}"
    return f"metadata:{make_song_id(title, artist)}"


def make_recording_id(
    title: str,
    artist: str | None,
    *,
    provider: str = "youtube_music",
    provider_recording_id: str | None = None,
) -> str:
    normalized_recording_id = (provider_recording_id or "").strip()
    if not normalized_recording_id:
        return make_song_id(title, artist)
    recording_key = make_recording_key(
        title,
        artist,
        provider=provider,
        provider_recording_id=normalized_recording_id,
    )
    return hashlib.sha256(f"recording|{recording_key}".encode("utf-8")).hexdigest()
