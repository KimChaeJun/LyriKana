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
