const API_BASE = "http://127.0.0.1:8000";

export async function resolveLyrics(
  title: string,
  artist?: string
) {
  const params = new URLSearchParams({
    title,
  });

  if (artist) {
    params.set("artist", artist);
  }

  const response = await fetch(
    `${API_BASE}/api/lyrics/resolve?${params.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to resolve lyrics");
  }

  return response.json();
}

export async function saveConvertedLyrics(
  songId: string,
  payload: any
) {
  const response = await fetch(
    `${API_BASE}/api/lyrics/${songId}/conversion`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    throw new Error("Failed to save lyrics");
  }

  return response.json();
}