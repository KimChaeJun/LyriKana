const API_BASE = (import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  ""
);

export type ProcessingStatus =
  | "pending"
  | "fetching"
  | "processing"
  | "completed"
  | "partial"
  | "failed";

export type BackendLyricLine = {
  lineNo: number;
  time: number | null;
  original: string;
  reading: string | null;
  kr: string | null;
  jp: string | null;
  en: string | null;
  userEdit: boolean;
  reasonTags: string[];
};

export type BackendSongResponse = {
  song: {
    id: string;
    title: string;
    artist: string | null;
    album: string | null;
    duration: number | null;
    source: string;
  };
  status: ProcessingStatus;
  progress: {
    total: number;
    completed: number;
    failed: number;
  };
  lyrics: BackendLyricLine[];
  rawLrc: string | null;
  error: string | null;
};

export type ConvertedLyricLine = {
  lineNo: number;
  reading: string;
  kr: string;
  jp: string;
  en: string;
  userEdit?: boolean;
  reasonTags?: string[];
  failed?: boolean;
};

export class BackendRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = "BackendRequestError";
  }
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BackendRequestError("backend_unavailable");
  }

  if (!response.ok) {
    let detail = `backend_http_${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail || detail;
    } catch {
      // Keep the stable HTTP fallback code when the body is not JSON.
    }
    throw new BackendRequestError(detail, response.status);
  }

  return response.json() as Promise<T>;
}

export function createSongKey(title: string, artist?: string): string {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  return `${normalize(title)}::${normalize(artist || "")}`;
}

export async function getSong(
  songId: string,
  signal?: AbortSignal
): Promise<BackendSongResponse> {
  return requestJson<BackendSongResponse>(`/api/v1/songs/${songId}`, { signal });
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Request aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export async function resolveLyrics(
  song: {
    title: string;
    artist?: string;
    album?: string;
    duration?: number;
    playbackTime?: number;
  },
  signal?: AbortSignal
): Promise<BackendSongResponse> {
  let result = await requestJson<BackendSongResponse>("/api/v1/songs/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(song),
    signal,
  });

  let backoff = 250;
  const deadline = Date.now() + 20_000;
  while (
    (result.status === "pending" || result.status === "fetching") &&
    Date.now() < deadline
  ) {
    await delay(backoff, signal);
    result = await getSong(result.song.id, signal);
    backoff = Math.min(1_500, Math.round(backoff * 1.6));
  }

  return result;
}

export async function saveConvertedLyrics(
  songId: string,
  lyrics: ConvertedLyricLine[],
  signal?: AbortSignal
): Promise<BackendSongResponse> {
  return requestJson<BackendSongResponse>(`/api/v1/songs/${songId}/lyrics`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lyrics }),
    signal,
  });
}

export const backendApiBase = API_BASE;
