import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SongInfo, Lyric
from app.schemas import ConversionUpdate
from app.services.lrclib import fetch_lrclib_lyrics
from app.services.lrc import parse_lrc

router = APIRouter(prefix="/api/lyrics", tags=["lyrics"])


def make_hash_id(*values: str | None) -> str:
    raw = "|".join([value or "" for value in values])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def to_response(song: SongInfo, lyric: Lyric) -> dict:
    lyric_lines = json.loads(lyric.lyric_lines_json)

    return {
        "source": song.source,
        "song_id": song.id,
        "lyric_id": lyric.id,
        "title": song.title,
        "artist": song.artist,
        "album": song.album,
        "duration": song.duration,
        "status": lyric.status,
        "original_lrc": lyric.original_lrc,
        "lyric_lines": lyric_lines,
        "needs_conversion": lyric.status != "converted",
    }


@router.get("/resolve")
async def resolve_lyrics(
    title: str,
    artist: str | None = None,
    db: Session = Depends(get_db),
):
    song_id = make_hash_id("youtube_music", artist, title)

    song = db.query(SongInfo).filter(SongInfo.id == song_id).first()

    if song:
        lyric = db.query(Lyric).filter(Lyric.song_id == song.id).first()
        if lyric:
            return to_response(song, lyric)

    fetched = await fetch_lrclib_lyrics(title=title, artist=artist)

    if not fetched:
        raise HTTPException(status_code=404, detail="Lyrics not found from LRCLIB")

    song = SongInfo(
        id=song_id,
        source="youtube_music",
        title=title,
        artist=artist,
        album=fetched.get("album"),
        duration=fetched.get("duration"),
    )

    original_lrc = fetched["original_lrc"]
    lyric_id = make_hash_id(song_id, original_lrc)
    parsed_lines = parse_lrc(original_lrc)

    lyric = Lyric(
        id=lyric_id,
        song_id=song_id,
        status="fetched",
        original_lrc=original_lrc,
        lyric_lines_json=json.dumps(parsed_lines, ensure_ascii=False),
    )

    db.add(song)
    db.add(lyric)
    db.commit()
    db.refresh(song)
    db.refresh(lyric)

    return to_response(song, lyric)


@router.patch("/{song_id}/conversion")
def update_conversion(
    song_id: str,
    payload: ConversionUpdate,
    db: Session = Depends(get_db),
):
    song = db.query(SongInfo).filter(SongInfo.id == song_id).first()

    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    lyric = db.query(Lyric).filter(Lyric.song_id == song_id).first()

    if not lyric:
        raise HTTPException(status_code=404, detail="Lyric not found")

    lyric.lyric_lines_json = json.dumps(
        [line.model_dump() for line in payload.lyric_lines],
        ensure_ascii=False,
    )
    lyric.hiragana = payload.hiragana
    lyric.korean_pronunciation = payload.korean_pronunciation
    lyric.english_pronunciation = payload.english_pronunciation
    lyric.hard_mapped_pronunciation = payload.hard_mapped_pronunciation
    lyric.user_feedback = payload.user_feedback
    lyric.status = "converted"

    db.commit()
    db.refresh(lyric)

    return to_response(song, lyric)


@router.get("/{song_id}")
def get_lyrics_by_song_id(
    song_id: str,
    db: Session = Depends(get_db),
):
    song = db.query(SongInfo).filter(SongInfo.id == song_id).first()

    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    lyric = db.query(Lyric).filter(Lyric.song_id == song_id).first()

    if not lyric:
        raise HTTPException(status_code=404, detail="Lyric not found")

    return to_response(song, lyric)