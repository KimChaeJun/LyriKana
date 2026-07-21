from __future__ import annotations

import json
import logging
import socket
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import selectinload, sessionmaker

from app.config import Settings
from app.models import (
    AnalysisJob,
    Lyric,
    LyricReadingCandidate,
    LyricUnit,
    SongInfo,
)
from app.services.analysis_adapters import AdapterSelection, select_adapters
from app.services.audio_assets import audio_asset_path
from app.services.karaoke_pipeline import KaraokePipeline, PipelineResult


logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _line_timings(lines: list[Lyric], song_duration: int | None) -> dict[int, tuple[float | None, float | None]]:
    timings: dict[int, tuple[float | None, float | None]] = {}
    for index, line in enumerate(lines):
        start = line.time
        end = line.end_time
        if start is not None and end is None:
            for later in lines[index + 1 :]:
                if later.time is not None and later.time > start:
                    end = later.time
                    break
            if end is None and song_duration is not None and song_duration > start:
                end = float(song_duration)
        timings[index] = (start, end)
    return timings


class _LeaseHeartbeat:
    def __init__(
        self,
        *,
        session_factory: sessionmaker,
        job_id: str,
        worker_id: str,
        lease_seconds: int,
    ) -> None:
        self.session_factory = session_factory
        self.job_id = job_id
        self.worker_id = worker_id
        self.lease_seconds = lease_seconds
        self.interval = min(60.0, max(5.0, lease_seconds / 3))
        self._stop = threading.Event()
        self._thread = threading.Thread(
            target=self._run,
            name=f"analysis-heartbeat-{job_id[:8]}",
            daemon=True,
        )

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._thread.join(timeout=2)

    def _run(self) -> None:
        while not self._stop.wait(self.interval):
            now = _utcnow()
            try:
                with self.session_factory() as db:
                    db.execute(
                        update(AnalysisJob)
                        .where(
                            AnalysisJob.id == self.job_id,
                            AnalysisJob.status == "running",
                            AnalysisJob.worker_id == self.worker_id,
                        )
                        .values(
                            heartbeat_at=now,
                            lease_expires_at=now + timedelta(seconds=self.lease_seconds),
                        )
                    )
                    db.commit()
            except Exception:
                logger.exception("Analysis heartbeat failed job_id=%s", self.job_id)


class AnalysisWorker:
    def __init__(
        self,
        *,
        session_factory: sessionmaker,
        configuration: Settings,
        worker_id: str | None = None,
        adapter_selector: Callable[..., AdapterSelection] = select_adapters,
    ) -> None:
        self.session_factory = session_factory
        self.configuration = configuration
        self.worker_id = worker_id or f"{socket.gethostname()}-{uuid.uuid4().hex[:10]}"
        self.adapter_selector = adapter_selector

    def recover_stale_jobs(self) -> int:
        now = _utcnow()
        recovered = 0
        with self.session_factory() as db:
            jobs = db.scalars(
                select(AnalysisJob).where(
                    AnalysisJob.status == "running",
                    or_(
                        AnalysisJob.lease_expires_at.is_(None),
                        AnalysisJob.lease_expires_at < now,
                    ),
                )
            ).all()
            for job in jobs:
                song = db.get(SongInfo, job.song_id)
                if job.attempt_count >= self.configuration.analysis_worker_max_attempts:
                    job.status = "failed"
                    job.error_message = "worker_lease_expired:max_attempts_reached"
                    job.completed_at = now
                    if song is not None:
                        song.status = "analysis_failed"
                        song.error_message = job.error_message
                else:
                    job.status = "queued"
                    job.current_stage = "ingest"
                    job.error_message = "worker_lease_expired:requeued"
                    if song is not None:
                        song.status = "analysis_queued"
                job.worker_id = None
                job.heartbeat_at = None
                job.lease_expires_at = None
                recovered += 1
            db.commit()
        return recovered

    def claim_next_job(self) -> str | None:
        for _attempt in range(5):
            now = _utcnow()
            with self.session_factory() as db:
                job_id = db.scalar(
                    select(AnalysisJob.id)
                    .where(AnalysisJob.status == "queued")
                    .order_by(AnalysisJob.created_at, AnalysisJob.id)
                    .limit(1)
                )
                if job_id is None:
                    return None
                result = db.execute(
                    update(AnalysisJob)
                    .where(AnalysisJob.id == job_id, AnalysisJob.status == "queued")
                    .values(
                        status="running",
                        current_stage="ingest",
                        progress=0.01,
                        attempt_count=AnalysisJob.attempt_count + 1,
                        worker_id=self.worker_id,
                        heartbeat_at=now,
                        lease_expires_at=now
                        + timedelta(seconds=self.configuration.analysis_worker_lease_seconds),
                        started_at=now,
                        completed_at=None,
                        error_message=None,
                    )
                )
                if result.rowcount != 1:
                    db.rollback()
                    continue
                job = db.get(AnalysisJob, job_id)
                song = db.get(SongInfo, job.song_id) if job else None
                if song is not None:
                    song.status = "analysis_running"
                    song.error_message = None
                db.commit()
                return job_id
        return None

    def process_job(self, job_id: str) -> None:
        heartbeat = _LeaseHeartbeat(
            session_factory=self.session_factory,
            job_id=job_id,
            worker_id=self.worker_id,
            lease_seconds=self.configuration.analysis_worker_lease_seconds,
        )
        heartbeat.start()
        try:
            with self.session_factory() as db:
                job = db.scalar(
                    select(AnalysisJob)
                    .options(
                        selectinload(AnalysisJob.song).selectinload(SongInfo.lyrics),
                        selectinload(AnalysisJob.audio_asset),
                    )
                    .where(AnalysisJob.id == job_id)
                )
                if job is None:
                    return
                if job.status != "running" or job.worker_id != self.worker_id:
                    return
                song = job.song
                lines = sorted(song.lyrics, key=lambda item: item.line_no)
                if not lines:
                    raise ValueError("analysis_job_has_no_lyrics")
                audio_path = self._resolve_audio_path(job)
                lyrics_text = "\n".join(line.original for line in lines)
                line_timings = _line_timings(lines, song.duration)
                requested_aligner = job.aligner

            work_dir = self.configuration.analysis_data_dir / "jobs" / job_id
            work_dir.mkdir(parents=True, exist_ok=True)
            selection = self.adapter_selector(
                configuration=self.configuration,
                work_dir=work_dir,
                line_timings=line_timings,
                requested_aligner=requested_aligner,
            )
            pipeline = KaraokePipeline(selection.components)
            result = pipeline.run(
                audio_path=audio_path,
                lyrics=lyrics_text,
                work_dir=work_dir,
                on_stage=lambda stage, progress: self._report_stage(job_id, stage, progress),
            )
            self._persist_result(job_id, result, selection)
        except Exception as error:
            logger.exception("Analysis job failed job_id=%s", job_id)
            self._mark_failed(job_id, error)
        finally:
            heartbeat.stop()

    def _resolve_audio_path(self, job: AnalysisJob) -> Path:
        if job.audio_asset is not None:
            return audio_asset_path(job.audio_asset)
        if job.audio_path:
            path = Path(job.audio_path).expanduser().resolve()
            if path.is_file():
                return path
        raise ValueError("audio_file_not_found")

    def _report_stage(self, job_id: str, stage: str, progress: float) -> None:
        now = _utcnow()
        with self.session_factory() as db:
            job = db.get(AnalysisJob, job_id)
            if job is None or job.status != "running" or job.worker_id != self.worker_id:
                raise RuntimeError("analysis_job_lease_lost")
            job.current_stage = stage
            job.progress = min(0.99, max(job.progress, progress))
            job.heartbeat_at = now
            job.lease_expires_at = now + timedelta(
                seconds=self.configuration.analysis_worker_lease_seconds
            )
            db.commit()

    def _persist_result(
        self,
        job_id: str,
        result: PipelineResult,
        selection: AdapterSelection,
    ) -> None:
        now = _utcnow()
        with self.session_factory() as db:
            job = db.scalar(
                select(AnalysisJob)
                .options(selectinload(AnalysisJob.song).selectinload(SongInfo.lyrics))
                .where(AnalysisJob.id == job_id)
            )
            if job is None or job.status != "running" or job.worker_id != self.worker_id:
                raise RuntimeError("analysis_job_lease_lost")
            song = job.song
            lines = sorted(song.lyrics, key=lambda item: item.line_no)
            line_by_pipeline_no = {index: line for index, line in enumerate(lines)}
            writable_ids = [line.id for line in lines if not line.user_edit]
            if writable_ids:
                db.execute(delete(LyricUnit).where(LyricUnit.lyric_id.in_(writable_ids)))
                db.execute(
                    delete(LyricReadingCandidate).where(
                        LyricReadingCandidate.lyric_id.in_(writable_ids)
                    )
                )

            units_by_line: dict[int, list] = {}
            for unit in result.units:
                units_by_line.setdefault(unit.line_no, []).append(unit)
            candidates_by_line: dict[int, list] = {}
            for candidate in result.candidates:
                candidates_by_line.setdefault(candidate.line_no, []).append(candidate)

            review_line_nos: list[int] = []
            processed = sum(1 for line in lines if line.user_edit)
            for pipeline_line_no, line in line_by_pipeline_no.items():
                if line.user_edit:
                    continue
                aligned_units = sorted(
                    units_by_line.get(pipeline_line_no, []),
                    key=lambda item: (item.start_time, item.end_time),
                )
                line_candidates = candidates_by_line.get(pipeline_line_no, [])
                selected_candidate_ids: set[int] = set()
                canonical_readings: list[str] = []
                for unit in aligned_units:
                    matches = [
                        (index, candidate)
                        for index, candidate in enumerate(line_candidates)
                        if index not in selected_candidate_ids
                        and candidate.surface == unit.surface
                    ]
                    if matches:
                        matching_reading = [
                            item
                            for item in matches
                            if unit.reading in {item[1].reading, item[1].spoken_reading}
                        ]
                        index, selected = max(
                            matching_reading or matches,
                            key=lambda item: item[1].score,
                        )
                        selected_candidate_ids.add(index)
                        canonical_readings.append(selected.reading)

                for index, candidate in enumerate(line_candidates):
                    selected_unit = next(
                        (
                            unit
                            for unit in aligned_units
                            if unit.surface == candidate.surface
                            and unit.reading in {candidate.reading, candidate.spoken_reading}
                        ),
                        None,
                    )
                    db.add(
                        LyricReadingCandidate(
                            lyric_id=line.id,
                            surface=candidate.surface,
                            surface_start=candidate.surface_start,
                            surface_end=candidate.surface_end,
                            reading=candidate.reading,
                            spoken_reading=candidate.spoken_reading,
                            source=candidate.source,
                            score=candidate.score,
                            acoustic_score=(
                                selected_unit.acoustic_score
                                if selected_unit is not None
                                else candidate.acoustic_score
                            ),
                            selected=index in selected_candidate_ids,
                            reasons=json.dumps(candidate.reasons, ensure_ascii=False),
                        )
                    )

                for unit_no, unit in enumerate(aligned_units):
                    db.add(
                        LyricUnit(
                            lyric_id=line.id,
                            unit_no=unit_no,
                            unit_type=unit.unit_type,
                            surface=unit.surface,
                            reading=unit.reading,
                            phoneme=unit.phoneme,
                            start_time=unit.start_time,
                            end_time=unit.end_time,
                            confidence=unit.confidence,
                            source=unit.source,
                        )
                    )

                confidences = [unit.confidence for unit in aligned_units]
                line_confidence = (
                    sum(confidences) / len(confidences) if confidences else 0.0
                )
                existing_tags = _json_string_list(line.reason_tags)
                existing_tags = [
                    tag
                    for tag in existing_tags
                    if tag not in {"low_alignment_confidence", "synthetic_timing"}
                ]
                synthetic = any(unit.source == "synthetic_timing" for unit in aligned_units)
                needs_review = (
                    not aligned_units
                    or line_confidence < self.configuration.analysis_low_confidence_threshold
                    or synthetic
                )
                if needs_review:
                    existing_tags.append("low_alignment_confidence")
                    if synthetic:
                        existing_tags.append("synthetic_timing")
                    review_line_nos.append(line.line_no)
                line.reason_tags = json.dumps(list(dict.fromkeys(existing_tags)), ensure_ascii=False)
                if aligned_units:
                    line.time = aligned_units[0].start_time
                    line.end_time = aligned_units[-1].end_time
                    line.sung_reading = "".join(unit.reading for unit in aligned_units)
                    line.reading = "".join(canonical_readings) or line.sung_reading
                    line.confidence = line_confidence
                    line.source = "analysis"
                    processed += 1

            review_required = bool(review_line_nos)
            job.status = "review_required" if review_required else "completed"
            job.current_stage = "quality_review" if review_required else "completed"
            job.progress = 1.0
            job.aligner = selection.aligner_name
            job.completed_at = now
            job.heartbeat_at = None
            job.lease_expires_at = None
            job.result_summary = json.dumps(
                {
                    "separator": selection.separator_name,
                    "aligner": selection.aligner_name,
                    "lineCount": len(lines),
                    "processedLineCount": processed,
                    "unitCount": len(result.units),
                    "reviewLineNos": review_line_nos,
                },
                ensure_ascii=False,
            )
            song.status = job.status
            song.progress_total = len(lines)
            song.progress_completed = processed
            song.progress_failed = len(review_line_nos)
            song.error_message = None
            db.commit()

    def _mark_failed(self, job_id: str, error: Exception) -> None:
        now = _utcnow()
        message = f"{type(error).__name__}:{error}"[:4000]
        with self.session_factory() as db:
            job = db.get(AnalysisJob, job_id)
            if (
                job is None
                or job.status != "running"
                or job.worker_id != self.worker_id
            ):
                return
            job.status = "failed"
            job.error_message = message
            job.completed_at = now
            job.heartbeat_at = None
            job.lease_expires_at = None
            song = db.get(SongInfo, job.song_id)
            if song is not None:
                song.status = "analysis_failed"
                song.error_message = message
            db.commit()

    def run(self, *, once: bool = False) -> None:
        recovered = self.recover_stale_jobs()
        if recovered:
            logger.info("Recovered stale analysis jobs count=%d", recovered)
        while True:
            job_id = self.claim_next_job()
            if job_id is None:
                if once:
                    return
                time.sleep(self.configuration.analysis_worker_poll_seconds)
                continue
            self.process_job(job_id)
            if once:
                return


def _json_string_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    return [str(item) for item in parsed] if isinstance(parsed, list) else []
