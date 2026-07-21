from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.config import settings
from app.models import AnalysisJob, AudioAsset, Lyric, SongInfo
from app.schemas import (
    AnalysisCreateRequest,
    ConversionUpdate,
    LyricsUpdate,
    SongResolveRequest,
    SourceLyricsUpdate,
)
from app.services.jobs import processor
from app.services.audio_assets import audio_asset_response, store_audio_asset
from app.services.karaoke_pipeline import (
    analysis_job_response,
    create_analysis_job,
    ingest_source_lyrics,
)


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
        "endTime": line.end_time,
        "original": line.original,
        "reading": line.reading,
        "sungReading": line.sung_reading,
        "kr": line.kr,
        "jp": line.jp,
        "en": line.en,
        "userEdit": line.user_edit,
        "confidence": line.confidence,
        "source": line.source,
        "reasonTags": _reason_tags(line.reason_tags),
        "units": [
            {
                "unitNo": unit.unit_no,
                "unitType": unit.unit_type,
                "surface": unit.surface,
                "reading": unit.reading,
                "phoneme": unit.phoneme,
                "startTime": unit.start_time,
                "endTime": unit.end_time,
                "confidence": unit.confidence,
                "source": unit.source,
                "userEdit": unit.user_edit,
            }
            for unit in line.units
        ],
        "readingCandidates": [
            {
                "surface": candidate.surface,
                "surfaceStart": candidate.surface_start,
                "surfaceEnd": candidate.surface_end,
                "reading": candidate.reading,
                "spokenReading": candidate.spoken_reading,
                "source": candidate.source,
                "score": candidate.score,
                "acousticScore": candidate.acoustic_score,
                "selected": candidate.selected,
                "reasons": _reason_tags(candidate.reasons),
            }
            for candidate in line.reading_candidates
        ],
    }


def _song_response(
    song: SongInfo, *, include_lyrics: bool = True, cache_hit: bool = True
) -> dict:
    return {
        "song": {
            "id": song.id,
            "recordingId": song.id,
            "workId": song.work_id,
            "title": song.title,
            "artist": song.artist,
            "performer": song.performer,
            "album": song.album,
            "duration": song.duration,
            "provider": song.provider,
            "videoId": song.provider_recording_id if song.provider == "youtube_music" else None,
            "recordingKey": song.recording_key,
            "versionType": song.version_type,
            "audioFingerprint": song.audio_fingerprint,
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
        provider=payload.provider,
        provider_recording_id=payload.video_id,
        version_type=payload.version_type,
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
        line.end_time = update.end_time
        line.reading = _optional_text(update.reading)
        line.sung_reading = _optional_text(update.sung_reading)
        line.kr = _optional_text(update.kr)
        line.jp = _optional_text(update.jp)
        line.en = _optional_text(update.en)
        line.user_edit = update.user_edit
        line.confidence = update.confidence
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


@router.put("/{song_id}/source-lyrics")
def update_source_lyrics(
    song_id: str,
    payload: SourceLyricsUpdate,
    db: Session = Depends(get_db),
):
    song = _load_song(db, song_id)
    try:
        ingest_source_lyrics(
            db,
            song,
            lyrics=payload.lyrics,
            lyrics_format=payload.lyrics_format,
            source=payload.source,
        )
    except ValueError as error:
        detail = str(error)
        status_code = 409 if detail == "user_edited_lyrics_require_explicit_merge" else 422
        raise HTTPException(status_code=status_code, detail=detail) from error
    waiting_jobs = db.scalars(
        select(AnalysisJob).where(
            AnalysisJob.song_id == song_id,
            AnalysisJob.status == "awaiting_lyrics",
        )
    ).all()
    if waiting_jobs:
        for job in waiting_jobs:
            if job.audio_asset_id or job.audio_path:
                job.status = "queued"
                job.current_stage = "ingest"
                job.progress = 0.0
        if any(job.status == "queued" for job in waiting_jobs):
            song.status = "analysis_queued"
        db.commit()
    return _song_response(_load_song(db, song_id))


@router.put("/{song_id}/audio", status_code=201)
async def upload_song_audio(
    song_id: str,
    request: Request,
    filename: str = Query(min_length=1, max_length=255),
    db: Session = Depends(get_db),
):
    song = _load_song(db, song_id)
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > settings.analysis_max_upload_bytes:
                raise HTTPException(status_code=413, detail="audio_file_too_large")
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid_content_length") from None
    try:
        asset, created = await store_audio_asset(
            db,
            song,
            filename=filename,
            media_type=request.headers.get("content-type"),
            chunks=request.stream(),
            data_dir=settings.analysis_data_dir,
            max_bytes=settings.analysis_max_upload_bytes,
        )
    except ValueError as error:
        detail = str(error)
        status_code = 413 if detail == "audio_file_too_large" else 422
        raise HTTPException(status_code=status_code, detail=detail) from error
    waiting_job = db.scalar(
        select(AnalysisJob)
        .where(
            AnalysisJob.song_id == song_id,
            AnalysisJob.status == "awaiting_audio",
        )
        .order_by(AnalysisJob.created_at.desc())
        .limit(1)
    )
    if waiting_job is not None:
        waiting_job.audio_asset_id = asset.id
        waiting_job.audio_path = None
        if song.lyrics:
            waiting_job.status = "queued"
            waiting_job.current_stage = "ingest"
            song.status = "analysis_queued"
        else:
            waiting_job.status = "awaiting_lyrics"
            song.status = "awaiting_lyrics"
        db.commit()
        db.refresh(waiting_job)
    return {
        "asset": audio_asset_response(asset),
        "created": created,
        "analysis": analysis_job_response(waiting_job) if waiting_job else None,
    }


@router.get("/{song_id}/audio")
def list_song_audio(song_id: str, db: Session = Depends(get_db)):
    _load_song(db, song_id)
    assets = db.scalars(
        select(AudioAsset)
        .where(AudioAsset.song_id == song_id)
        .order_by(AudioAsset.created_at.desc())
    ).all()
    return {"assets": [audio_asset_response(asset) for asset in assets]}


@router.post("/{song_id}/analysis", status_code=202)
def start_song_analysis(
    song_id: str,
    payload: AnalysisCreateRequest,
    db: Session = Depends(get_db),
):
    song = _load_song(db, song_id)
    if payload.lyrics and payload.lyrics.strip():
        try:
            ingest_source_lyrics(
                db,
                song,
                lyrics=payload.lyrics,
                lyrics_format=payload.lyrics_format,
                source="analysis_input",
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        song = _load_song(db, song_id)
    try:
        job = create_analysis_job(
            db,
            song,
            audio_path=payload.audio_path,
            audio_asset_id=payload.audio_asset_id,
            aligner=payload.aligner,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return analysis_job_response(job)


@router.get("/{song_id}/analysis/{job_id}")
def get_song_analysis(
    song_id: str,
    job_id: str,
    db: Session = Depends(get_db),
):
    _load_song(db, song_id)
    job = db.scalar(
        select(AnalysisJob).where(AnalysisJob.id == job_id, AnalysisJob.song_id == song_id)
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return analysis_job_response(job)


@router.post("/{song_id}/analysis/{job_id}/retry", status_code=202)
def retry_song_analysis(
    song_id: str,
    job_id: str,
    db: Session = Depends(get_db),
):
    song = _load_song(db, song_id)
    job = db.scalar(
        select(AnalysisJob).where(AnalysisJob.id == job_id, AnalysisJob.song_id == song_id)
    )
    if job is None:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    if job.status in {"queued", "running"}:
        raise HTTPException(status_code=409, detail="analysis_job_already_active")
    if not song.lyrics:
        raise HTTPException(status_code=409, detail="analysis_job_has_no_lyrics")
    if job.audio_asset_id:
        asset = db.get(AudioAsset, job.audio_asset_id)
        if asset is None:
            raise HTTPException(status_code=409, detail="audio_asset_not_found")
    elif not job.audio_path:
        raise HTTPException(status_code=409, detail="analysis_job_has_no_audio")

    job.status = "queued"
    job.current_stage = "ingest"
    job.progress = 0.0
    job.error_message = None
    job.worker_id = None
    job.heartbeat_at = None
    job.lease_expires_at = None
    job.completed_at = None
    job.started_at = None
    job.result_summary = None
    song.status = "analysis_queued"
    song.error_message = None
    db.commit()
    db.refresh(job)
    return analysis_job_response(job)


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
