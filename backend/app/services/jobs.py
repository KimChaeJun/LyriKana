from __future__ import annotations

import asyncio
import json
import logging
import time

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Lyric, SongInfo
from app.services.lrc import parse_lrc
from app.services.lrclib import fetch_best_lrclib_lyrics
from app.services.normalization import make_song_id, normalize_song_part


logger = logging.getLogger(__name__)


def _is_retryable_provider_failure(error_message: str | None) -> bool:
    if not error_message:
        return False
    return error_message in {
        "provider_timeout",
        "provider_unavailable",
        "provider_error:ReadTimeout",
        "provider_error:ConnectTimeout",
        "provider_error:ConnectError",
        "provider_http_408",
        "provider_http_425",
        "provider_http_429",
    } or error_message.startswith("provider_http_5")


class SongProcessor:
    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def get_or_create(
        self,
        db: Session,
        *,
        title: str,
        artist: str | None,
        album: str | None,
        duration: int | None,
        retry: bool = False,
    ) -> tuple[SongInfo, bool]:
        normalized_title = normalize_song_part(title)
        normalized_artist = normalize_song_part(artist)
        requested_id = make_song_id(title, artist)
        song = db.scalar(
            select(SongInfo).where(
                SongInfo.normalized_title == normalized_title,
                SongInfo.normalized_artist == normalized_artist,
            )
        )
        created = False

        if song is None:
            # Provider metadata used to overwrite the canonical title/artist.
            # A later startup then backfilled the mutated normalized fields while
            # the primary key still represented the original YouTube identity.
            # Recover that cached row by its stable ID instead of inserting a
            # duplicate and raising a primary-key conflict.
            song = db.get(SongInfo, requested_id)
            if song is not None:
                song.title = title.strip()
                song.artist = artist.strip() if artist else None
                song.normalized_title = normalized_title
                song.normalized_artist = normalized_artist
                db.commit()
                logger.warning(
                    "Repaired provider-mutated song identity song_id=%s title=%r artist=%r",
                    song.id,
                    song.title,
                    song.artist,
                )

        if song is None:
            song = SongInfo(
                id=requested_id,
                title=title.strip(),
                artist=artist.strip() if artist else None,
                normalized_title=normalized_title,
                normalized_artist=normalized_artist,
                album=album,
                duration=duration,
                source="youtube_music",
                status="pending",
            )
            db.add(song)
            try:
                db.commit()
                created = True
            except IntegrityError:
                db.rollback()
                song = db.scalar(
                    select(SongInfo).where(
                        SongInfo.normalized_title == normalized_title,
                        SongInfo.normalized_artist == normalized_artist,
                    )
                )
                if song is None:
                    song = db.get(SongInfo, requested_id)
                    if song is not None:
                        song.title = title.strip()
                        song.artist = artist.strip() if artist else None
                        song.normalized_title = normalized_title
                        song.normalized_artist = normalized_artist
                        db.commit()
                if song is None:
                    raise
        elif song.status == "failed" and (
            retry or _is_retryable_provider_failure(song.error_message)
        ):
            song.status = "pending"
            song.error_message = None
            song.progress_total = 0
            song.progress_completed = 0
            song.progress_failed = 0
            db.commit()

        logger.info(
            "Song resolve requested song_id=%s cache=%s status=%s",
            song.id,
            "miss" if created else "hit",
            song.status,
        )
        return song, created

    def start_if_needed(self, song_id: str, status: str) -> None:
        current = self._tasks.get(song_id)
        if current is not None and not current.done():
            if status == "pending":
                current.add_done_callback(
                    lambda _completed, key=song_id: self.start_if_needed(key, "pending")
                )
            return
        if status not in {"pending", "fetching"}:
            return

        task = asyncio.create_task(self._process(song_id), name=f"resolve-song-{song_id[:8]}")
        self._tasks[song_id] = task
        task.add_done_callback(lambda completed, key=song_id: self._discard(key, completed))

    def _discard(self, song_id: str, task: asyncio.Task[None]) -> None:
        self._tasks.pop(song_id, None)
        if not task.cancelled() and task.exception() is not None:
            logger.error("Unhandled song processing task error song_id=%s", song_id, exc_info=task.exception())

    async def _process(self, song_id: str) -> None:
        started_at = time.monotonic()
        with SessionLocal() as db:
            song = db.get(SongInfo, song_id)
            if song is None or song.status in {"processing", "completed", "partial"}:
                return
            song.status = "fetching"
            song.error_message = None
            db.commit()
            title, artist, album, duration = song.title, song.artist, song.album, song.duration

        try:
            fetched = await fetch_best_lrclib_lyrics(
                title=title,
                artist=artist,
                album=album,
                duration=duration,
            )
            if not fetched:
                self._mark_failed(song_id, "lyrics_not_found")
                return

            raw_lrc = fetched.get("syncedLyrics") or fetched.get("plainLyrics") or ""
            parsed_lines = parse_lrc(raw_lrc)
            if not parsed_lines:
                self._mark_failed(song_id, "lyrics_empty")
                return

            with SessionLocal() as db:
                song = db.get(SongInfo, song_id)
                if song is None:
                    return
                if not song.lyrics:
                    for line in parsed_lines:
                        line_payload = {**line, "reason_tags": json.dumps([])}
                        db.add(Lyric(song_id=song_id, **line_payload))

                # LRCLIB metadata describes a search candidate, not the stable
                # YouTube Music identity used for cache keys. Keep the original
                # request title/artist so future lookups cannot drift.
                song.album = fetched.get("albumName") or song.album
                fetched_duration = fetched.get("duration")
                song.duration = round(fetched_duration) if fetched_duration else song.duration
                song.source = "lrclib"
                song.raw_lrc = raw_lrc
                song.progress_total = len(parsed_lines)
                song.progress_completed = 0
                song.progress_failed = 0
                song.status = "processing"
                db.commit()

            logger.info(
                "Song lyrics stored song_id=%s lines=%d elapsed_ms=%d",
                song_id,
                len(parsed_lines),
                round((time.monotonic() - started_at) * 1000),
            )
        except asyncio.CancelledError:
            raise
        except httpx.TimeoutException:
            logger.exception("Song provider timed out song_id=%s", song_id)
            self._mark_failed(song_id, "provider_timeout")
        except httpx.TransportError:
            logger.exception("Song provider unavailable song_id=%s", song_id)
            self._mark_failed(song_id, "provider_unavailable")
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            logger.exception(
                "Song provider HTTP error song_id=%s status=%d", song_id, status_code
            )
            self._mark_failed(song_id, f"provider_http_{status_code}")
        except Exception as error:
            logger.exception("Song processing failed song_id=%s", song_id)
            self._mark_failed(song_id, f"provider_error:{type(error).__name__}")

    def _mark_failed(self, song_id: str, message: str) -> None:
        with SessionLocal() as db:
            song = db.get(SongInfo, song_id)
            if song is None:
                return
            song.status = "failed"
            song.error_message = message
            db.commit()
        logger.warning("Song processing failed song_id=%s reason=%s", song_id, message)

    def recover_incomplete(self) -> None:
        with SessionLocal() as db:
            songs = db.scalars(select(SongInfo).where(SongInfo.status.in_(["pending", "fetching"]))).all()
            for song in songs:
                song.status = "pending"
            db.commit()
            for song in songs:
                self.start_if_needed(song.id, song.status)

    async def shutdown(self) -> None:
        tasks = [task for task in self._tasks.values() if not task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()


processor = SongProcessor()
