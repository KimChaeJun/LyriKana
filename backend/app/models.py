from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class Work(Base):
    __tablename__ = "works"
    __table_args__ = (
        UniqueConstraint("normalized_title", "normalized_artist", name="uq_works_identity"),
    )

    id = Column(String(64), primary_key=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    artist = Column(String(255), nullable=True, index=True)
    normalized_title = Column(String(255), nullable=False, index=True)
    normalized_artist = Column(String(255), nullable=False, default="", index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    recordings = relationship("SongInfo", back_populates="work")


class SongInfo(Base):
    __tablename__ = "song_info"
    __table_args__ = (UniqueConstraint("recording_key", name="uq_song_info_recording_key"),)

    id = Column(String(64), primary_key=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    artist = Column(String(255), nullable=True, index=True)
    normalized_title = Column(String(255), nullable=False, index=True)
    normalized_artist = Column(String(255), nullable=False, default="", index=True)
    work_id = Column(String(64), ForeignKey("works.id"), nullable=True, index=True)
    recording_key = Column(String(320), nullable=True, index=True)
    provider = Column(
        String(50), nullable=False, default="youtube_music", server_default="youtube_music"
    )
    provider_recording_id = Column(String(255), nullable=True, index=True)
    performer = Column(String(255), nullable=True)
    version_type = Column(String(30), nullable=False, default="unknown", server_default="unknown")
    audio_fingerprint = Column(String(255), nullable=True, index=True)
    album = Column(String(255), nullable=True)
    duration = Column(Integer, nullable=True)
    source = Column(String(50), nullable=False, default="youtube_music")
    raw_lrc = Column(Text, nullable=True)

    status = Column(String(30), nullable=False, default="pending", index=True)
    progress_total = Column(Integer, nullable=False, default=0)
    progress_completed = Column(Integer, nullable=False, default=0)
    progress_failed = Column(Integer, nullable=False, default=0)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    work = relationship("Work", back_populates="recordings")
    lyrics = relationship(
        "Lyric",
        back_populates="song",
        cascade="all, delete-orphan",
        order_by="Lyric.line_no",
    )
    analysis_jobs = relationship(
        "AnalysisJob",
        back_populates="song",
        cascade="all, delete-orphan",
        order_by="AnalysisJob.created_at",
    )
    audio_assets = relationship(
        "AudioAsset",
        back_populates="song",
        cascade="all, delete-orphan",
        order_by="AudioAsset.created_at",
    )


class Lyric(Base):
    __tablename__ = "lyrics"
    __table_args__ = (UniqueConstraint("song_id", "line_no", name="uq_lyrics_song_line"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    song_id = Column(
        String(64), ForeignKey("song_info.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no = Column(Integer, nullable=False)
    time = Column(Float, nullable=True)
    end_time = Column(Float, nullable=True)
    original = Column(Text, nullable=False)
    reading = Column(Text, nullable=True)
    sung_reading = Column(Text, nullable=True)
    kr = Column(Text, nullable=True)
    jp = Column(Text, nullable=True)
    en = Column(Text, nullable=True)
    user_edit = Column(Boolean, nullable=False, default=False)
    confidence = Column(Float, nullable=True)
    source = Column(String(50), nullable=False, default="provider", server_default="provider")
    reason_tags = Column(Text, nullable=False, default="[]")

    song = relationship("SongInfo", back_populates="lyrics")
    units = relationship(
        "LyricUnit",
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="LyricUnit.unit_no",
    )
    reading_candidates = relationship(
        "LyricReadingCandidate",
        back_populates="line",
        cascade="all, delete-orphan",
        order_by="LyricReadingCandidate.score.desc()",
    )


class LyricReadingCandidate(Base):
    __tablename__ = "lyric_reading_candidates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lyric_id = Column(Integer, ForeignKey("lyrics.id", ondelete="CASCADE"), nullable=False, index=True)
    surface = Column(Text, nullable=False)
    surface_start = Column(Integer, nullable=True)
    surface_end = Column(Integer, nullable=True)
    reading = Column(Text, nullable=False)
    spoken_reading = Column(Text, nullable=True)
    source = Column(String(50), nullable=False)
    score = Column(Float, nullable=False, default=0.0)
    acoustic_score = Column(Float, nullable=True)
    selected = Column(Boolean, nullable=False, default=False)
    reasons = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    line = relationship("Lyric", back_populates="reading_candidates")


class LyricUnit(Base):
    __tablename__ = "lyric_units"
    __table_args__ = (UniqueConstraint("lyric_id", "unit_no", name="uq_lyric_units_line_unit"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    lyric_id = Column(Integer, ForeignKey("lyrics.id", ondelete="CASCADE"), nullable=False, index=True)
    unit_no = Column(Integer, nullable=False)
    unit_type = Column(String(20), nullable=False, default="mora")
    surface = Column(Text, nullable=False)
    reading = Column(Text, nullable=True)
    phoneme = Column(String(100), nullable=True)
    start_time = Column(Float, nullable=True)
    end_time = Column(Float, nullable=True)
    confidence = Column(Float, nullable=True)
    source = Column(String(50), nullable=False, default="generated")
    user_edit = Column(Boolean, nullable=False, default=False)

    line = relationship("Lyric", back_populates="units")


class AudioAsset(Base):
    __tablename__ = "audio_assets"
    __table_args__ = (
        UniqueConstraint("song_id", "sha256", name="uq_audio_assets_song_hash"),
        UniqueConstraint("stored_path", name="uq_audio_assets_stored_path"),
    )

    id = Column(String(64), primary_key=True, index=True)
    song_id = Column(
        String(64), ForeignKey("song_info.id", ondelete="CASCADE"), nullable=False, index=True
    )
    original_filename = Column(String(255), nullable=False)
    stored_path = Column(Text, nullable=False)
    media_type = Column(String(100), nullable=True)
    byte_size = Column(Integer, nullable=False)
    sha256 = Column(String(64), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    song = relationship("SongInfo", back_populates="audio_assets")
    analysis_jobs = relationship("AnalysisJob", back_populates="audio_asset")


class AnalysisJob(Base):
    __tablename__ = "analysis_jobs"

    id = Column(String(64), primary_key=True, index=True)
    song_id = Column(
        String(64), ForeignKey("song_info.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status = Column(String(30), nullable=False, default="queued", index=True)
    current_stage = Column(String(50), nullable=False, default="ingest")
    audio_path = Column(Text, nullable=True)
    audio_asset_id = Column(
        String(64), ForeignKey("audio_assets.id", ondelete="SET NULL"), nullable=True, index=True
    )
    pipeline_version = Column(String(50), nullable=False, default="karaoke-v2")
    aligner = Column(String(50), nullable=True)
    progress = Column(Float, nullable=False, default=0.0)
    attempt_count = Column(Integer, nullable=False, default=0)
    worker_id = Column(String(255), nullable=True, index=True)
    heartbeat_at = Column(DateTime(timezone=True), nullable=True)
    lease_expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    result_summary = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    song = relationship("SongInfo", back_populates="analysis_jobs")
    audio_asset = relationship("AudioAsset", back_populates="analysis_jobs")
