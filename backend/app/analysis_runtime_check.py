from __future__ import annotations

import argparse
import json
import math
import struct
import tempfile
import time
import uuid
import wave
from dataclasses import replace
from pathlib import Path

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings
from app.database import Base
from app.models import AnalysisJob, Lyric, LyricUnit, SongInfo
from app.services.analysis_worker import AnalysisWorker


def _write_smoke_wav(path: Path, seconds: float) -> None:
    sample_rate = 44_100
    frame_count = max(sample_rate, round(sample_rate * seconds))
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        frames = bytearray()
        for index in range(frame_count):
            time_point = index / sample_rate
            envelope = min(1.0, time_point * 4, max(0.0, (seconds - time_point) * 4))
            sample = int(
                11_000
                * envelope
                * (
                    0.65 * math.sin(2 * math.pi * 220 * time_point)
                    + 0.35 * math.sin(2 * math.pi * 440 * time_point)
                )
            )
            frames.extend(struct.pack("<hh", sample, sample))
        output.writeframes(frames)


def run_runtime_check(*, seconds: float) -> dict:
    settings.analysis_data_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="lyrikana-runtime-check-",
        dir=settings.analysis_data_dir,
    ) as temporary:
        root = Path(temporary)
        audio_path = root / "synthetic-vocal.wav"
        _write_smoke_wav(audio_path, seconds)

        engine = create_engine(
            f"sqlite:///{root / 'runtime-check.db'}",
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )
        sessions = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(engine)
        unique = uuid.uuid4().hex
        song_id = f"runtime-{unique}"
        job_id = f"job-{unique}"
        with sessions() as db:
            db.add(
                SongInfo(
                    id=song_id,
                    title="LyriKana runtime check",
                    artist="local synthetic audio",
                    normalized_title="lyrikana runtime check",
                    normalized_artist="local synthetic audio",
                    recording_key=f"runtime:{unique}",
                    duration=round(seconds),
                    status="analysis_queued",
                )
            )
            db.add(
                Lyric(
                    song_id=song_id,
                    line_no=0,
                    time=0.0,
                    end_time=seconds,
                    original="⌈私は⌋ 1991",
                    source="runtime_check",
                    reason_tags="[]",
                )
            )
            db.add(
                AnalysisJob(
                    id=job_id,
                    song_id=song_id,
                    status="queued",
                    current_stage="ingest",
                    audio_path=str(audio_path),
                    aligner="timed",
                )
            )
            db.commit()

        configuration = replace(
            settings,
            analysis_data_dir=root / "work",
            analysis_separator="audio_separator",
            analysis_aligner="timed",
        )
        worker = AnalysisWorker(
            session_factory=sessions,
            configuration=configuration,
            worker_id="runtime-check",
        )
        started_at = time.monotonic()
        claimed = worker.claim_next_job()
        if claimed != job_id:
            raise RuntimeError("runtime_check_could_not_claim_job")
        worker.process_job(job_id)
        elapsed_seconds = time.monotonic() - started_at

        with sessions() as db:
            job = db.get(AnalysisJob, job_id)
            song = db.get(SongInfo, song_id)
            unit_count = db.scalar(select(func.count()).select_from(LyricUnit)) or 0
            if job is None or song is None:
                raise RuntimeError("runtime_check_result_missing")
            result = json.loads(job.result_summary or "{}")
            if job.status not in {"completed", "review_required"}:
                raise RuntimeError(f"runtime_check_failed:{job.error_message}")
            if result.get("separator") != "audio_separator":
                raise RuntimeError(f"unexpected_separator:{result.get('separator')}")
            if unit_count == 0:
                raise RuntimeError("runtime_check_created_no_units")
            vocal_outputs = list(
                (configuration.analysis_data_dir / "jobs" / job_id).rglob("*.wav")
            )
            check_result = {
                "status": "ok",
                "jobStatus": job.status,
                "separator": result.get("separator"),
                "aligner": result.get("aligner"),
                "unitCount": unit_count,
                "elapsedSeconds": round(elapsed_seconds, 3),
                "inputBytes": audio_path.stat().st_size,
                "vocalOutputBytes": sum(path.stat().st_size for path in vocal_outputs),
                "model": configuration.analysis_separator_model,
                "device": configuration.analysis_device,
            }
        engine.dispose()
        return check_result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run an isolated end-to-end check of the LyriKana analysis runtime"
    )
    parser.add_argument("--seconds", type=float, default=2.0)
    arguments = parser.parse_args()
    if not 0.5 <= arguments.seconds <= 10:
        parser.error("--seconds must be between 0.5 and 10")
    print(json.dumps(run_runtime_check(seconds=arguments.seconds), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
