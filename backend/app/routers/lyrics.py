from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.models import Lyric, SongInfo
from app.schemas import ConversionUpdate, LyricsUpdate, SongResolveRequest
from app.services.jobs import processor


router = APIRouter(prefix="/api/v1/songs", tags=["songs"])
legacy_router = APIRouter(prefix="/api/lyrics", tags=["lyrics-compatibility"])


def _reason_tags(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def _line_response(line: Lyric) -> dict:
    return {
        "lineNo": line.line_no,
        "time": line.time,
        "original": line.original,
        "reading": line.reading,
        "kr": line.kr,
        "jp": line.jp,
        "en": line.en,
        "userEdit": line.user_edit,
        "reasonTags": _reason_tags(line.reason_tags),
    }


def _song_response(
    song: SongInfo, *, include_lyrics: bool = True, cache_hit: bool = True
) -> dict:
    return {
        "song": {
            "id": song.id,
            "title": song.title,
            "artist": song.artist,
            "album": song.album,
            "duration": song.duration,
            "source": song.source,
        },
        "status": song.status,
        "progress": {
            "total": song.progress_total,
            "completed": song.progress_completed,
            "failed": song.progress_failed,
        },
        "lyrics": [_line_response(line) for line in song.lyrics] if include_lyrics else [],
        "rawLrc": song.raw_lrc,
        "error": song.error_message,
        "cacheHit": cache_hit,
    }


def _load_song(db: Session, song_id: str) -> SongInfo:
    song = db.scalar(
        select(SongInfo).options(selectinload(SongInfo.lyrics)).where(SongInfo.id == song_id)
    )
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@router.post("/resolve", status_code=202)
async def resolve_song(payload: SongResolveRequest, db: Session = Depends(get_db)):
    song, created = processor.get_or_create(
        db,
        title=payload.title,
        artist=payload.artist,
        album=payload.album,
        duration=payload.duration,
        retry=payload.retry,
    )
    processor.start_if_needed(song.id, song.status)
    song = _load_song(db, song.id)
    return _song_response(song, cache_hit=not created)


@router.get("/{song_id}")
def get_song(song_id: str, db: Session = Depends(get_db)):
    return _song_response(_load_song(db, song_id))


@router.get("/{song_id}/lyrics")
def get_song_lyrics(song_id: str, db: Session = Depends(get_db)):
    return _song_response(_load_song(db, song_id))


@router.get("/{song_id}/status")
def get_song_status(song_id: str, db: Session = Depends(get_db)):
    song = _load_song(db, song_id)
    return _song_response(song, include_lyrics=False)


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


@router.patch("/{song_id}/lyrics")
def update_song_lyrics(song_id: str, payload: LyricsUpdate, db: Session = Depends(get_db)):
    song = _load_song(db, song_id)
    by_line_no = {line.line_no: line for line in song.lyrics}

    for update in payload.lyrics:
        line = by_line_no.get(update.line_no)
        if line is None:
            raise HTTPException(status_code=404, detail=f"Lyric line {update.line_no} not found")
        line.reading = _optional_text(update.reading)
        line.kr = _optional_text(update.kr)
        line.jp = _optional_text(update.jp)
        line.en = _optional_text(update.en)
        line.user_edit = update.user_edit
        tags = list(dict.fromkeys(update.reason_tags + (["conversion_failed"] if update.failed else [])))
        line.reason_tags = json.dumps(tags, ensure_ascii=False)

    completed = sum(
        1 for line in song.lyrics if any((line.reading, line.kr, line.jp, line.en))
    )
    failed = sum(1 for line in song.lyrics if "conversion_failed" in _reason_tags(line.reason_tags))
    song.progress_total = len(song.lyrics)
    song.progress_completed = completed
    song.progress_failed = failed
    if song.progress_total and completed == song.progress_total:
        song.status = "completed"
    elif failed and completed + failed >= song.progress_total:
        song.status = "partial"
    else:
        song.status = "processing"

    db.commit()
    return _song_response(_load_song(db, song_id))


@legacy_router.get("/resolve")
async def legacy_resolve(
    title: str = Query(min_length=1),
    artist: str | None = None,
    db: Session = Depends(get_db),
):
    song, created = processor.get_or_create(
        db, title=title, artist=artist, album=None, duration=None
    )
    processor.start_if_needed(song.id, song.status)
    return _song_response(_load_song(db, song.id), cache_hit=not created)


@legacy_router.get("/{song_id}")
def legacy_get(song_id: str, db: Session = Depends(get_db)):
    return _song_response(_load_song(db, song_id))


@legacy_router.patch("/{song_id}/conversion")
def legacy_update_conversion(
    song_id: str,
    payload: ConversionUpdate,
    db: Session = Depends(get_db),
):
    updates = []
    for index, line in enumerate(payload.lyric_lines):
        updates.append(
            {
                "lineNo": max(0, line.order - 1) if line.order else index,
                "reading": line.hiragana,
                "kr": line.korean_pronunciation,
                "jp": line.hard_mapped_pronunciation,
                "en": line.english_pronunciation,
                "reasonTags": [],
            }
        )
    return update_song_lyrics(song_id, LyricsUpdate.model_validate({"lyrics": updates}), db)
