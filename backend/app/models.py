from sqlalchemy import Column, ForeignKey, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from .database import Base


class SongInfo(Base):
    __tablename__ = "song_info"

    id = Column(String(64), primary_key=True, index=True)
    source = Column(String(50), nullable=False, default="youtube_music")
    title = Column(String(255), nullable=False, index=True)
    artist = Column(String(255), nullable=True, index=True)
    album = Column(String(255), nullable=True)
    duration = Column(Integer, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Lyric(Base):
    __tablename__ = "lyric"

    id = Column(String(64), primary_key=True, index=True)
    song_id = Column(String(64), ForeignKey("song_info.id"), unique=True, nullable=False, index=True)

    status = Column(String(30), nullable=False, default="fetched")
    original_lrc = Column(Text, nullable=False)
    lyric_lines_json = Column(Text, nullable=False)

    user_feedback = Column(Text, nullable=True)
    hard_mapped_pronunciation = Column(Text, nullable=True)
    korean_pronunciation = Column(Text, nullable=True)
    english_pronunciation = Column(Text, nullable=True)
    hiragana = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())