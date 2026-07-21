from __future__ import annotations

import hashlib
import os
import uuid
from collections.abc import AsyncIterable
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import AudioAsset, SongInfo
from app.services.karaoke_pipeline import SUPPORTED_AUDIO_SUFFIXES


def _safe_audio_filename(value: str) -> str:
    filename = Path(value.strip()).name
    if not filename or filename in {".", ".."}:
        raise ValueError("audio_filename_required")
    if len(filename) > 255:
        raise ValueError("audio_filename_too_long")
    if Path(filename).suffix.casefold() not in SUPPORTED_AUDIO_SUFFIXES:
        raise ValueError("unsupported_audio_format")
    return filename


async def store_audio_asset(
    db: Session,
    song: SongInfo,
    *,
    filename: str,
    media_type: str | None,
    chunks: AsyncIterable[bytes],
    data_dir: Path,
    max_bytes: int,
) -> tuple[AudioAsset, bool]:
    """Stream an authorized local upload into managed storage and de-duplicate it."""
    safe_filename = _safe_audio_filename(filename)
    asset_id = uuid.uuid4().hex
    suffix = Path(safe_filename).suffix.casefold()
    asset_dir = data_dir / "audio" / song.id
    asset_dir.mkdir(parents=True, exist_ok=True)
    final_path = asset_dir / f"{asset_id}{suffix}"
    temporary_path = asset_dir / f".{asset_id}.part"
    digest = hashlib.sha256()
    byte_size = 0

    try:
        with temporary_path.open("xb") as output:
            async for chunk in chunks:
                if not chunk:
                    continue
                byte_size += len(chunk)
                if byte_size > max_bytes:
                    raise ValueError("audio_file_too_large")
                digest.update(chunk)
                output.write(chunk)
        if byte_size == 0:
            raise ValueError("audio_file_empty")

        sha256 = digest.hexdigest()
        existing = db.scalar(
            select(AudioAsset).where(
                AudioAsset.song_id == song.id,
                AudioAsset.sha256 == sha256,
            )
        )
        if existing is not None:
            temporary_path.unlink(missing_ok=True)
            return existing, False

        os.replace(temporary_path, final_path)
        asset = AudioAsset(
            id=asset_id,
            song_id=song.id,
            original_filename=safe_filename,
            stored_path=str(final_path.resolve()),
            media_type=(media_type or "").strip() or None,
            byte_size=byte_size,
            sha256=sha256,
        )
        db.add(asset)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            final_path.unlink(missing_ok=True)
            existing = db.scalar(
                select(AudioAsset).where(
                    AudioAsset.song_id == song.id,
                    AudioAsset.sha256 == sha256,
                )
            )
            if existing is None:
                raise
            return existing, False
        db.refresh(asset)
        return asset, True
    except Exception:
        temporary_path.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise


def audio_asset_response(asset: AudioAsset) -> dict:
    return {
        "id": asset.id,
        "songId": asset.song_id,
        "filename": asset.original_filename,
        "mediaType": asset.media_type,
        "byteSize": asset.byte_size,
        "sha256": asset.sha256,
        "createdAt": asset.created_at.isoformat() if asset.created_at else None,
    }


def audio_asset_path(asset: AudioAsset) -> Path:
    path = Path(asset.stored_path).resolve()
    if not path.is_file():
        raise ValueError("audio_file_not_found")
    if path.suffix.casefold() not in SUPPORTED_AUDIO_SUFFIXES:
        raise ValueError("unsupported_audio_format")
    return path
