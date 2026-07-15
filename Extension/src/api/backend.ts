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
  cacheHit: boolean;
};

export type InitialResolveListener = (response: BackendSongResponse) => void;

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

type BackendRelayResponse = {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
};

function canUseExtensionBackendRelay(): boolean {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.runtime?.id && chrome.runtime.sendMessage)
  );
}

async function requestThroughExtension(
  path: string,
  init: RequestInit
): Promise<BackendRelayResponse> {
  if (init.signal?.aborted) throw new DOMException("Request aborted", "AbortError");

  const headers = Object.fromEntries(new Headers(init.headers).entries());
  const pending = chrome.runtime.sendMessage({
    type: "LYRIKANA_BACKEND_REQUEST",
    path,
    method: init.method || "GET",
    headers,
    body: typeof init.body === "string" ? init.body : undefined,
  }) as Promise<BackendRelayResponse>;

  if (!init.signal) return pending;
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException("Request aborted", "AbortError"));
    init.signal?.addEventListener("abort", abort, { once: true });
    pending.then(resolve, reject).finally(() => {
      init.signal?.removeEventListener("abort", abort);
    });
  });
}

function backendErrorDetail(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail?: unknown }).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  return `backend_http_${status}`;
}

async function requestJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  if (!canUseExtensionBackendRelay()) {
    throw new BackendRequestError("backend_unavailable");
  }

  let relayed: BackendRelayResponse;
  try {
    relayed = await requestThroughExtension(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BackendRequestError("backend_unavailable");
  }

  if (!relayed || relayed.status === 0 || relayed.error === "backend_unavailable") {
    throw new BackendRequestError("backend_unavailable");
  }
  if (!relayed.ok) {
    throw new BackendRequestError(
      backendErrorDetail(relayed.payload, relayed.status),
      relayed.status
    );
  }
  return relayed.payload as T;
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
  signal?: AbortSignal,
  onInitialResolve?: InitialResolveListener
): Promise<BackendSongResponse> {
  let result = await requestJson<BackendSongResponse>("/api/v1/songs/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(song),
    signal,
  });
  const cacheHit = result.cacheHit ?? false;
  result = { ...result, cacheHit };
  onInitialResolve?.(result);

  let backoff = 250;
  const deadline = Date.now() + 60_000;
  while (
    (result.status === "pending" || result.status === "fetching") &&
    Date.now() < deadline
  ) {
    await delay(backoff, signal);
    result = { ...(await getSong(result.song.id, signal)), cacheHit };
    backoff = Math.min(1_500, Math.round(backoff * 1.6));
  }

  if (result.status === "pending" || result.status === "fetching") {
    throw new BackendRequestError("lyrics_processing_timeout");
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
