from __future__ import annotations

import json
import unicodedata
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Literal, Protocol, Sequence

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.models import AnalysisJob, AudioAsset, Lyric, SongInfo
from app.services.lrc import parse_lrc


PIPELINE_VERSION = "karaoke-v2"
SUPPORTED_AUDIO_SUFFIXES = {".flac", ".m4a", ".mp3", ".ogg", ".wav", ".webm"}
PIPELINE_STAGES = (
    "ingest",
    "separate_vocals",
    "normalize_lyrics",
    "generate_reading_candidates",
    "forced_align",
    "segment_lines",
    "quality_review",
    "completed",
)


@dataclass(frozen=True)
class NormalizedLyrics:
    original: str
    analysis_text: str
    analysis_to_original: tuple[int, ...]


@dataclass(frozen=True)
class ReadingCandidate:
    surface: str
    reading: str
    source: str
    score: float
    line_no: int = 0
    surface_start: int | None = None
    surface_end: int | None = None
    spoken_reading: str | None = None
    acoustic_score: float | None = None
    reasons: tuple[str, ...] = ()


@dataclass(frozen=True)
class AlignedUnit:
    surface: str
    reading: str
    phoneme: str | None
    start_time: float
    end_time: float
    confidence: float
    line_no: int = 0
    unit_type: str = "token"
    source: str = "generated"
    acoustic_score: float | None = None


class VocalSeparator(Protocol):
    def separate(self, audio_path: Path, work_dir: Path) -> Path: ...


class ReadingCandidateGenerator(Protocol):
    def generate(self, lyrics: NormalizedLyrics) -> Sequence[ReadingCandidate]: ...


class ForcedAligner(Protocol):
    def align(
        self,
        vocal_path: Path,
        candidates: Sequence[ReadingCandidate],
    ) -> Sequence[AlignedUnit]: ...


class LineSegmenter(Protocol):
    def segment(self, units: Sequence[AlignedUnit]) -> Sequence[Sequence[AlignedUnit]]: ...


@dataclass(frozen=True)
class PipelineComponents:
    vocal_separator: VocalSeparator
    candidate_generator: ReadingCandidateGenerator
    forced_aligner: ForcedAligner
    line_segmenter: LineSegmenter


@dataclass(frozen=True)
class PipelineResult:
    normalized_lyrics: NormalizedLyrics
    candidates: tuple[ReadingCandidate, ...]
    units: tuple[AlignedUnit, ...]
    lines: tuple[tuple[AlignedUnit, ...], ...]


class KaraokePipeline:
    """Model-agnostic orchestration; heavyweight adapters live outside the API process."""

    def __init__(self, components: PipelineComponents) -> None:
        self.components = components

    def run(
        self,
        *,
        audio_path: Path,
        lyrics: str,
        work_dir: Path,
        on_stage: Callable[[str, float], None] | None = None,
    ) -> PipelineResult:
        report = on_stage or (lambda _stage, _progress: None)
        report("ingest", 0.05)
        vocal_path = self.components.vocal_separator.separate(audio_path, work_dir)
        report("separate_vocals", 0.25)
        normalized = normalize_lyrics_for_analysis(lyrics)
        report("normalize_lyrics", 0.35)
        candidates = tuple(self.components.candidate_generator.generate(normalized))
        report("generate_reading_candidates", 0.5)
        units = tuple(self.components.forced_aligner.align(vocal_path, candidates))
        report("forced_align", 0.75)
        lines = tuple(tuple(line) for line in self.components.line_segmenter.segment(units))
        report("segment_lines", 0.9)
        report("quality_review", 0.95)
        return PipelineResult(
            normalized_lyrics=normalized,
            candidates=candidates,
            units=units,
            lines=lines,
        )


def normalize_lyrics_for_analysis(text: str) -> NormalizedLyrics:
    """Create punctuation-tolerant analysis text while retaining original offsets."""
    output: list[str] = []
    offsets: list[int] = []
    previous_was_space = False

    for original_index, original_character in enumerate(text):
        expanded = unicodedata.normalize("NFKC", original_character)
        for character in expanded:
            category = unicodedata.category(character)
            analysis_character = " " if category[0] in {"P", "S", "Z"} else character
            is_space = analysis_character.isspace()
            if is_space and previous_was_space:
                continue
            output.append(" " if is_space else analysis_character)
            offsets.append(original_index)
            previous_was_space = is_space

    while output and output[0] == " ":
        output.pop(0)
        offsets.pop(0)
    while output and output[-1] == " ":
        output.pop()
        offsets.pop()

    return NormalizedLyrics(
        original=text,
        analysis_text="".join(output),
        analysis_to_original=tuple(offsets),
    )


def ingest_source_lyrics(
    db: Session,
    song: SongInfo,
    *,
    lyrics: str,
    lyrics_format: Literal["auto", "lrc", "plain"] = "auto",
    source: str = "manual",
) -> list[Lyric]:
    if any(line.user_edit for line in song.lyrics):
        raise ValueError("user_edited_lyrics_require_explicit_merge")

    if lyrics_format == "plain":
        parsed = parse_lrc("\n".join(line for line in lyrics.splitlines() if line.strip()))
    else:
        parsed = parse_lrc(lyrics)
    if not parsed:
        raise ValueError("lyrics_empty")

    db.execute(delete(Lyric).where(Lyric.song_id == song.id))
    created: list[Lyric] = []
    for item in parsed:
        line = Lyric(
            song_id=song.id,
            line_no=item["line_no"],
            time=item["time"],
            original=item["original"],
            source=source,
            reason_tags="[]",
        )
        db.add(line)
        created.append(line)

    song.raw_lrc = lyrics
    song.source = source
    song.progress_total = len(created)
    song.progress_completed = 0
    song.progress_failed = 0
    song.error_message = None
    song.status = "processing" if all(line.time is not None for line in created) else "awaiting_alignment"
    db.commit()
    return created


def _validated_audio_path(value: str | None) -> Path | None:
    if not value:
        return None
    path = Path(value).expanduser().resolve()
    if not path.is_file():
        raise ValueError("audio_file_not_found")
    if path.suffix.casefold() not in SUPPORTED_AUDIO_SUFFIXES:
        raise ValueError("unsupported_audio_format")
    return path


def create_analysis_job(
    db: Session,
    song: SongInfo,
    *,
    audio_path: str | None,
    audio_asset_id: str | None = None,
    aligner: str | None = None,
) -> AnalysisJob:
    if audio_path and audio_asset_id:
        raise ValueError("choose_audio_path_or_asset")

    audio_asset: AudioAsset | None = None
    if audio_asset_id:
        audio_asset = db.get(AudioAsset, audio_asset_id)
        if audio_asset is None or audio_asset.song_id != song.id:
            raise ValueError("audio_asset_not_found")
        from app.services.audio_assets import audio_asset_path

        validated_audio = audio_asset_path(audio_asset)
    else:
        validated_audio = _validated_audio_path(audio_path)
    has_lyrics = bool(song.lyrics)
    if validated_audio is None:
        status = "awaiting_audio"
        stage = "ingest"
    elif not has_lyrics:
        status = "awaiting_lyrics"
        stage = "ingest"
    else:
        status = "queued"
        stage = "separate_vocals"

    job = AnalysisJob(
        id=uuid.uuid4().hex,
        song_id=song.id,
        status=status,
        current_stage=stage,
        audio_path=str(validated_audio) if validated_audio and audio_asset is None else None,
        audio_asset_id=audio_asset.id if audio_asset else None,
        pipeline_version=PIPELINE_VERSION,
        aligner=aligner,
        progress=0.0,
    )
    db.add(job)
    if status in {"awaiting_audio", "awaiting_lyrics"}:
        song.status = status
    else:
        song.status = "analysis_queued"
    db.commit()
    db.refresh(job)
    return job


def analysis_job_response(job: AnalysisJob) -> dict:
    try:
        result_summary = json.loads(job.result_summary) if job.result_summary else None
    except json.JSONDecodeError:
        result_summary = None
    return {
        "id": job.id,
        "songId": job.song_id,
        "status": job.status,
        "currentStage": job.current_stage,
        "audioPath": job.audio_path,
        "audioAssetId": job.audio_asset_id,
        "pipelineVersion": job.pipeline_version,
        "aligner": job.aligner,
        "progress": job.progress,
        "attemptCount": job.attempt_count,
        "workerId": job.worker_id,
        "startedAt": job.started_at.isoformat() if job.started_at else None,
        "completedAt": job.completed_at.isoformat() if job.completed_at else None,
        "result": result_summary,
        "error": job.error_message,
    }
