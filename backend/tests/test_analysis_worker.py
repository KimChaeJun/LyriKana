from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, select
from sqlalchemy.orm import selectinload, sessionmaker

from app.config import settings
from app.database import Base
from app.models import AnalysisJob, Lyric, SongInfo
from app.services.analysis_worker import AnalysisWorker


def test_worker_claims_and_persists_reviewable_timed_alignment(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'worker.db'}",
        connect_args={"check_same_thread": False},
    )
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    audio_path = tmp_path / "authorized.wav"
    audio_path.write_bytes(b"test audio")
    with sessions() as db:
        song = SongInfo(
            id="worker-song",
            title="A-priori",
            artist="Mrs. GREEN APPLE",
            normalized_title="a-priori",
            normalized_artist="mrs. green apple",
            recording_key="test:worker-song",
            status="analysis_queued",
            duration=8,
        )
        db.add(song)
        db.add_all(
            [
                Lyric(
                    song_id=song.id,
                    line_no=0,
                    time=1.0,
                    original="⌈私は⌋ 1991",
                    reason_tags="[]",
                ),
                Lyric(
                    song_id=song.id,
                    line_no=1,
                    time=4.0,
                    original="次の行",
                    reason_tags="[]",
                ),
            ]
        )
        db.add(
            AnalysisJob(
                id="worker-job",
                song_id=song.id,
                status="queued",
                current_stage="ingest",
                audio_path=str(audio_path),
            )
        )
        db.commit()

    configuration = replace(
        settings,
        analysis_data_dir=tmp_path / "analysis",
        analysis_separator="passthrough",
        analysis_aligner="timed",
        analysis_low_confidence_threshold=0.55,
        analysis_worker_lease_seconds=30,
    )
    worker = AnalysisWorker(
        session_factory=sessions,
        configuration=configuration,
        worker_id="test-worker",
    )

    assert worker.claim_next_job() == "worker-job"
    worker.process_job("worker-job")

    with sessions() as db:
        job = db.get(AnalysisJob, "worker-job")
        song = db.scalar(
            select(SongInfo)
            .options(selectinload(SongInfo.lyrics).selectinload(Lyric.units))
            .where(SongInfo.id == "worker-song")
        )
        assert job.status == "review_required"
        assert job.attempt_count == 1
        assert job.progress == 1.0
        assert json.loads(job.result_summary)["separator"] == "passthrough"
        assert json.loads(job.result_summary)["aligner"] == "timed_lyrics"
        assert song.status == "review_required"
        assert len(song.lyrics[0].units) >= 3
        assert song.lyrics[0].sung_reading.startswith("わたくしわ")
        assert "low_alignment_confidence" in json.loads(song.lyrics[0].reason_tags)

    Base.metadata.drop_all(engine)
    engine.dispose()


def test_worker_recovers_expired_leases_and_stops_after_max_attempts(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'recovery.db'}",
        connect_args={"check_same_thread": False},
    )
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(engine)
    expired = datetime.now(timezone.utc) - timedelta(minutes=1)
    with sessions() as db:
        for suffix, attempts in (("retry", 1), ("exhausted", 3)):
            song = SongInfo(
                id=f"song-{suffix}",
                title=suffix,
                normalized_title=suffix,
                normalized_artist="",
                recording_key=f"test:{suffix}",
                status="analysis_running",
            )
            db.add(song)
            db.add(
                AnalysisJob(
                    id=f"job-{suffix}",
                    song_id=song.id,
                    status="running",
                    attempt_count=attempts,
                    lease_expires_at=expired,
                    worker_id="dead-worker",
                )
            )
        db.commit()

    worker = AnalysisWorker(
        session_factory=sessions,
        configuration=replace(settings, analysis_worker_max_attempts=3),
        worker_id="recovery-worker",
    )
    assert worker.recover_stale_jobs() == 2

    with sessions() as db:
        assert db.get(AnalysisJob, "job-retry").status == "queued"
        assert db.get(AnalysisJob, "job-exhausted").status == "failed"
        assert db.get(SongInfo, "song-retry").status == "analysis_queued"
        assert db.get(SongInfo, "song-exhausted").status == "analysis_failed"

    Base.metadata.drop_all(engine)
    engine.dispose()
