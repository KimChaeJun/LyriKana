from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel)


class SongResolveRequest(ApiModel):
    title: str = Field(min_length=1, max_length=255)
    artist: str | None = Field(default=None, max_length=255)
    album: str | None = Field(default=None, max_length=255)
    duration: int | None = Field(default=None, ge=0)
    playback_time: float | None = Field(default=None, ge=0)
    video_id: str | None = Field(default=None, min_length=1, max_length=255)
    provider: str = Field(default="youtube_music", min_length=1, max_length=50)
    version_type: Literal["studio", "live", "cover", "remix", "unknown"] = "unknown"
    retry: bool = False


class LyricLineUpdate(ApiModel):
    line_no: int = Field(ge=0)
    end_time: float | None = Field(default=None, ge=0)
    reading: str | None = None
    sung_reading: str | None = None
    kr: str | None = None
    jp: str | None = None
    en: str | None = None
    user_edit: bool = False
    confidence: float | None = Field(default=None, ge=0, le=1)
    reason_tags: list[str] = Field(default_factory=list)
    failed: bool = False


class LyricsUpdate(ApiModel):
    lyrics: list[LyricLineUpdate]


class SourceLyricsUpdate(ApiModel):
    lyrics: str = Field(min_length=1)
    lyrics_format: Literal["auto", "lrc", "plain"] = "auto"
    source: str = Field(default="manual", min_length=1, max_length=50)


class AnalysisCreateRequest(ApiModel):
    audio_path: str | None = Field(default=None, min_length=1)
    audio_asset_id: str | None = Field(default=None, min_length=1, max_length=64)
    lyrics: str | None = None
    lyrics_format: Literal["auto", "lrc", "plain"] = "auto"
    aligner: str | None = Field(default=None, max_length=50)


class LegacyLyricLine(BaseModel):
    order: int
    time: float | None = None
    original: str
    hiragana: str | None = None
    korean_pronunciation: str | None = None
    english_pronunciation: str | None = None
    hard_mapped_pronunciation: str | None = None
    user_feedback: str | None = None


class ConversionUpdate(BaseModel):
    lyric_lines: list[LegacyLyricLine]
    hiragana: str | None = None
    korean_pronunciation: str | None = None
    english_pronunciation: str | None = None
    hard_mapped_pronunciation: str | None = None
    user_feedback: str | None = None
