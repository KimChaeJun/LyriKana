import httpx


LRCLIB_URL = "https://lrclib.net/api/get"


async def fetch_lrclib_lyrics(title: str, artist: str | None = None) -> dict | None:
    params = {"track_name": title}

    if artist:
        params["artist_name"] = artist

    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(LRCLIB_URL, params=params)

    if response.status_code == 404:
        return None

    response.raise_for_status()
    data = response.json()

    synced_lyrics = data.get("syncedLyrics")
    plain_lyrics = data.get("plainLyrics")

    if not synced_lyrics and not plain_lyrics:
        return None

    return {
        "source": "lrclib",
        "title": data.get("trackName") or title,
        "artist": data.get("artistName") or artist,
        "album": data.get("albumName"),
        "duration": int(data.get("duration") or 0) or None,
        "original_lrc": synced_lyrics or plain_lyrics,
    }