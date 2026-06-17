from pydantic import BaseModel
from typing import Any


class LyricResolveQuery(BaseModel):
    title: str
    artist: str | None = None


class LyricLine(BaseModel):
    order: int
    time: float | None = None
    original: str
    hiragana: str | None = None
    korean_pronunciation: str | None = None
    english_pronunciation: str | None = None
    hard_mapped_pronunciation: str | None = None
    user_feedback: str | None = None


class ConversionUpdate(BaseModel):
    lyric_lines: list[LyricLine]
    hiragana: str | None = None
    korean_pronunciation: str | None = None
    english_pronunciation: str | None = None
    hard_mapped_pronunciation: str | None = None
    user_feedback: str | None = None


class LyricResponse(BaseModel):
    source: str
    song_id: str
    lyric_id: str
    title: str
    artist: str | None = None
    album: str | None = None
    duration: int | None = None
    status: str
    original_lrc: str
    lyric_lines: list[dict[str, Any]]
    needs_conversion: bool