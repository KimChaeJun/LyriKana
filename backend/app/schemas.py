from __future__ import annotations

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
    retry: bool = False


class LyricLineUpdate(ApiModel):
    line_no: int = Field(ge=0)
    reading: str | None = None
    kr: str | None = None
    jp: str | None = None
    en: str | None = None
    user_edit: bool = False
    reason_tags: list[str] = Field(default_factory=list)
    failed: bool = False


class LyricsUpdate(ApiModel):
    lyrics: list[LyricLineUpdate]


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
