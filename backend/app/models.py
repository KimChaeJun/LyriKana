from __future__ import annotations

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.database import Base


class SongInfo(Base):
    __tablename__ = "song_info"
    __table_args__ = (
        UniqueConstraint("normalized_title", "normalized_artist", name="uq_song_info_identity"),
    )

    id = Column(String(64), primary_key=True, index=True)
    title = Column(String(255), nullable=False, index=True)
    artist = Column(String(255), nullable=True, index=True)
    normalized_title = Column(String(255), nullable=False, index=True)
    normalized_artist = Column(String(255), nullable=False, default="", index=True)
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

    lyrics = relationship(
        "Lyric",
        back_populates="song",
        cascade="all, delete-orphan",
        order_by="Lyric.line_no",
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
    original = Column(Text, nullable=False)
    reading = Column(Text, nullable=True)
    kr = Column(Text, nullable=True)
    jp = Column(Text, nullable=True)
    en = Column(Text, nullable=True)
    user_edit = Column(Boolean, nullable=False, default=False)
    reason_tags = Column(Text, nullable=False, default="[]")

    song = relationship("SongInfo", back_populates="lyrics")
