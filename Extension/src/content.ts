import {
  enrichLyricsInBackground,
  parseLrcBase,
} from "./utils/lyrics/parseLrcWithPronunciation";
import { getTokenizer } from "./utils/pronunciation/reading";

type LyriKanaSettings = {
  enabled: boolean;
  showReading: boolean;
  showTranslation: boolean;
  showNextLine: boolean;
  originalFontSize: number;
  readingFontSize: number;
  translationFontSize: number;
  overlayOpacity: number;
  themeMode: "system" | "dark" | "light";
  bottomOffset: number;
  previewLeadTime: number;
};

const SETTINGS_KEY = "lyrikana_settings";
const DEFAULT_SETTINGS: LyriKanaSettings = {
  enabled: true,
  showReading: true,
  showTranslation: true,
  showNextLine: true,
  originalFontSize: 24,
  readingFontSize: 18,
  translationFontSize: 17,
  overlayOpacity: 0.74,
  themeMode: "system",
  bottomOffset: 120,
  previewLeadTime: 0.3,
};

type LyricLine = {
  time: number;
  original: string;
  reading: string;
  kr: string;
  jp: string;
  en: string;
};

type SongInfo = {
  title: string;
  artist: string;
  releaseYear?: string;
  duration?: number;
};

type LrcLibSong = {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  releaseDate?: string | null;
};

let lastSongKey: string | null = null;
let currentLyrics: LyricLine[] = [];
let currentLineIndex = -1;
let activeLyricsRequestId = 0;
let lastObservedTitle = "";
let lastObservedArtist = "";
let settings: LyriKanaSettings = { ...DEFAULT_SETTINGS };
let lyricsLoadedAt = 0;
let currentSongLabel = "LyriKana";
let cachedPreciseLineIndexes = new Set<number>();

const INTRO_TEXT = "♪ 전주 ♪";
const INSTRUMENTAL_TEXT = "♪ 간주 ♪";
const INSTRUMENTAL_MIN_GAP_SECONDS = 9;
const ELECTRON_OVERLAY_URL = "http://127.0.0.1:17654";
const READING_CACHE_VERSION = 3;
function cleanTitle(title: string): string {
  if (title.includes(" - ")) {
    title = title.split(" - ")[0];
  }
  return title.trim();
}

function cleanArtist(artist: string): string {
  if (artist.includes("•")) {
    artist = artist.split("•")[0];
  }
  return artist.trim();
}

function normalizeSettings(value: unknown): LyriKanaSettings {
  if (typeof value !== "object" || value === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const candidate = value as Partial<LyriKanaSettings>;

  return {
    enabled: candidate.enabled ?? DEFAULT_SETTINGS.enabled,
    showReading: candidate.showReading ?? DEFAULT_SETTINGS.showReading,
    showTranslation: candidate.showTranslation ?? DEFAULT_SETTINGS.showTranslation,
    showNextLine: candidate.showNextLine ?? DEFAULT_SETTINGS.showNextLine,
    originalFontSize:
      candidate.originalFontSize ?? DEFAULT_SETTINGS.originalFontSize,
    readingFontSize: candidate.readingFontSize ?? DEFAULT_SETTINGS.readingFontSize,
    translationFontSize:
      candidate.translationFontSize ?? DEFAULT_SETTINGS.translationFontSize,
    overlayOpacity: candidate.overlayOpacity ?? DEFAULT_SETTINGS.overlayOpacity,
    themeMode: candidate.themeMode ?? DEFAULT_SETTINGS.themeMode,
    bottomOffset: candidate.bottomOffset ?? DEFAULT_SETTINGS.bottomOffset,
    previewLeadTime: candidate.previewLeadTime ?? DEFAULT_SETTINGS.previewLeadTime,
  };
}

async function loadSettings(): Promise<LyriKanaSettings> {
  const result = await chrome.storage.sync.get(SETTINGS_KEY);
  return normalizeSettings(result[SETTINGS_KEY]);
}

function watchSettings(onChange: (settings: LyriKanaSettings) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") return;
    const change = changes[SETTINGS_KEY];
    if (!change) return;
    onChange(normalizeSettings(change.newValue));
  });
}

function getVideoDuration(): number | undefined {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || !Number.isFinite(player.duration)) return undefined;
  return Math.round(player.duration);
}

function findReleaseYearCandidate(): string | undefined {
  const selectors = [
    "ytmusic-player-bar",
    "ytmusic-player-page",
    "ytmusic-detail-header-renderer",
  ];

  for (const selector of selectors) {
    const text = document.querySelector(selector)?.textContent ?? "";
    const match = text.match(/\b(19|20)\d{2}\b/);
    if (match) return match[0];
  }

  return undefined;
}

function getSongInfo(): SongInfo | null {
  const titleElement =
    document.querySelector("ytmusic-player-bar .title") ??
    document.querySelector("#layout ytmusic-player-bar .title");

  const artistElement =
    document.querySelector("ytmusic-player-bar .byline") ??
    document.querySelector("#layout ytmusic-player-bar .byline");

  if (!titleElement || !artistElement) return null;

  const title = cleanTitle(titleElement.textContent?.trim() || "");
  const artist = cleanArtist(artistElement.textContent?.trim() || "");

  if (!title || !artist) return null;

  return {
    title,
    artist,
    releaseYear: findReleaseYearCandidate(),
    duration: getVideoDuration(),
  };
}

function openLyricsOverlay(): void {
  // Electron companion owns the always-on-top overlay window.
}

function postToElectronOverlay(path: "/overlay" | "/settings", payload: unknown): void {
  fetch(`${ELECTRON_OVERLAY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }).catch(() => {
    // The companion app is optional; lyric processing should continue if closed.
  });
}

async function requestElectronJson<T>(
  path: string,
  payload: unknown
): Promise<T | null> {
  try {
    const response = await fetch(`${ELECTRON_OVERLAY_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) return null;

    const json = (await response.json()) as { ok?: boolean; data?: T };
    return json.ok ? json.data ?? null : null;
  } catch {
    return null;
  }
}

function applySettingsToOverlay(): void {
  postToElectronOverlay("/settings", settings);
}

function setSettings(nextSettings: LyriKanaSettings): void {
  settings = nextSettings;
  applySettingsToOverlay();
  refreshCurrentLineIfVisible(currentLineIndex);
}

function updateLyricsDisplay(
  current?: Partial<LyricLine> | null,
  next?: Partial<LyricLine> | null,
  overrideOriginal = ""
): void {
  postToElectronOverlay("/overlay", {
    songLabel: currentSongLabel,
    original: overrideOriginal || current?.original || "",
    reading:
      overrideOriginal || !settings.showReading ? "" : current?.reading || "",
    translation:
      overrideOriginal || !settings.showTranslation ? "" : current?.kr || "",
    next: settings.showNextLine && next?.original ? `다음: ${next.original}` : "",
    settings,
  });
}

function resetLyrics(message: string): void {
  currentLyrics = [];
  cachedPreciseLineIndexes = new Set();
  currentLineIndex = -1;
  updateLyricsDisplay(null, null, message);
}

function estimateLineDuration(line: LyricLine): number {
  const baseText = (line.reading || line.original || "").replace(/\s+/g, "");

  if (!baseText) return 2.5;

  let units = 0;

  for (const ch of baseText) {
    if (ch === "ー") {
      units += 1.2;
    } else if (ch === "っ" || ch === "ッ") {
      units += 0.4;
    } else if (/[ぁ-んァ-ン]/.test(ch)) {
      units += 1;
    } else if (/[一-龯々]/.test(ch)) {
      units += 1.1;
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      units += 0.8;
    } else {
      units += 0.6;
    }
  }

  const estimated = units * 0.24 + 0.9;
  return Math.min(8.5, Math.max(2.4, estimated));
}

function refreshCurrentLineIfVisible(index: number): void {
  if (index !== currentLineIndex) return;

  const currentLine = currentLyrics[index];
  const nextLine = currentLyrics[index + 1];
  updateLyricsDisplay(currentLine, nextLine);
}

function getCurrentPlaybackTime(): number {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  return player?.currentTime ?? 0;
}

function getLyricIndexForTime(lyrics: LyricLine[], currentTime: number): number {
  let index = -1;

  for (let i = 0; i < lyrics.length; i++) {
    if (currentTime >= lyrics[i].time - settings.previewLeadTime) {
      index = i;
    } else {
      break;
    }
  }

  return Math.max(0, index);
}

function buildPlaybackPriorityIndices(
  lyrics: LyricLine[],
  currentTime = getCurrentPlaybackTime()
): number[] {
  const anchor = getLyricIndexForTime(lyrics, currentTime);
  const priority: number[] = [];

  for (let index = anchor; index <= Math.min(lyrics.length - 1, anchor + 10); index += 1) {
    priority.push(index);
  }

  for (let index = Math.max(0, anchor - 2); index < anchor; index += 1) {
    priority.push(index);
  }

  for (let index = 0; index < lyrics.length; index += 1) {
    priority.push(index);
  }

  return [...new Set(priority)];
}

async function hydrateCachedLineReadings(
  lyrics: LyricLine[],
  requestId: number
): Promise<void> {
  const result = await requestElectronJson<{
    lines: Array<Pick<LyricLine, "original" | "reading" | "kr" | "jp" | "en">>;
  }>("/cache/lines/get", {
    engineVersion: READING_CACHE_VERSION,
    originals: [...new Set(lyrics.map((line) => line.original))],
  });

  if (requestId !== activeLyricsRequestId || !result?.lines?.length) return;

  const cachedByOriginal = new Map(
    result.lines.map((line) => [line.original, line])
  );
  cachedPreciseLineIndexes = new Set();

  lyrics.forEach((line, index) => {
    const cached = cachedByOriginal.get(line.original);
    if (!cached || !currentLyrics[index]) return;

    currentLyrics[index] = {
      ...currentLyrics[index],
      reading: cached.reading,
      kr: cached.kr,
      jp: cached.jp,
      en: cached.en,
    };
    cachedPreciseLineIndexes.add(index);
  });

  refreshCurrentLineIfVisible(currentLineIndex);
}

function saveLineReadingToCache(line: LyricLine): void {
  void requestElectronJson("/cache/lines/save", {
    engineVersion: READING_CACHE_VERSION,
    line,
  });
}

function updateLyricsByTime(): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || currentLyrics.length === 0) return;

  const currentTime = player.currentTime;
  const lastLine = currentLyrics[currentLyrics.length - 1];

  if (
    lastLine &&
    Date.now() - lyricsLoadedAt < 5000 &&
    currentTime > lastLine.time + 5
  ) {
    if (currentLineIndex !== -4) {
      currentLineIndex = -4;
      updateLyricsDisplay(currentLyrics[0], currentLyrics[1] ?? null);
    }
    return;
  }

  let newIndex = -1;

  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentTime >= currentLyrics[i].time - settings.previewLeadTime) {
      newIndex = i;
    } else {
      break;
    }
  }

  if (newIndex === -1) {
    if (currentLineIndex !== -3) {
      currentLineIndex = -3;
      updateLyricsDisplay(null, currentLyrics[0], INTRO_TEXT);
    }
    return;
  }

  const currentLine = currentLyrics[newIndex];
  const nextLine = currentLyrics[newIndex + 1];

  /*
  if (nextLine) {
    const gap = nextLine.time - currentLine.time;
    const estimatedEnd = currentLine.time + estimateLineDuration(currentLine);
    const remainingToNext = nextLine.time - currentTime;

    const isLikelyInstrumental =
      gap >= INSTRUMENTAL_MIN_GAP_SECONDS &&
      currentTime >= estimatedEnd &&
      remainingToNext >= settings.previewLeadTime;

    if (isLikelyInstrumental) {
      if (currentLineIndex !== -2) {
        currentLineIndex = -2;
        updateLyricsDisplay(null, nextLine, INSTRUMENTAL_TEXT);
      }
      return;
    }
  }
  */

  if (newIndex !== currentLineIndex) {
    console.log("[LyriKana] line change:", {
      newIndex,
      currentTime,
      currentLine: currentLyrics[newIndex],
      nextLine: currentLyrics[newIndex + 1],
    });

    currentLineIndex = newIndex;
    updateLyricsDisplay(currentLine, nextLine);
  }
}

async function enhanceLyricsProgressively(
  lyrics: LyricLine[],
  requestId: number
): Promise<void> {
  await enrichLyricsInBackground(lyrics, {
    concurrency: 3,
    buildMode: "precise",
    indices: buildPlaybackPriorityIndices(lyrics).filter(
      (index) => !cachedPreciseLineIndexes.has(index)
    ),
    shouldStop: () => requestId !== activeLyricsRequestId,
    onLine: (index, builtLine) => {
      if (requestId !== activeLyricsRequestId) return;
      if (!currentLyrics[index]) return;

      const originalBefore = currentLyrics[index].original;

      currentLyrics[index] = {
        ...currentLyrics[index],
        ...builtLine,
        original: originalBefore,
      };

      if (originalBefore !== builtLine.original) {
        console.warn("[LyriKana] original mismatch detected:", {
          index,
          originalBefore,
          builtOriginal: builtLine.original,
        });
      }

      console.log("[LyriKana] progressive line update:", {
        requestId,
        index,
        original: currentLyrics[index].original,
        reading: currentLyrics[index].reading,
      });

      saveLineReadingToCache(currentLyrics[index]);
      refreshCurrentLineIfVisible(index);
    },
    onError: (index, original, error) => {
      if (requestId !== activeLyricsRequestId) return;
      console.warn("[LyriKana] progressive build skipped:", {
        requestId,
        index,
        original,
        error,
      });
    },
  });
}

async function enhanceLyricsFast(
  lyrics: LyricLine[],
  requestId: number
): Promise<void> {
  await enrichLyricsInBackground(lyrics, {
    concurrency: 6,
    buildMode: "fast",
    indices: buildPlaybackPriorityIndices(lyrics).filter(
      (index) => !cachedPreciseLineIndexes.has(index)
    ),
    shouldStop: () => requestId !== activeLyricsRequestId,
    onLine: (index, builtLine) => {
      if (requestId !== activeLyricsRequestId) return;
      if (!currentLyrics[index]) return;

      const originalBefore = currentLyrics[index].original;
      currentLyrics[index] = {
        ...currentLyrics[index],
        ...builtLine,
        original: originalBefore,
      };

      console.log("[LyriKana] fast line update:", {
        requestId,
        index,
        original: currentLyrics[index].original,
        reading: currentLyrics[index].reading,
      });

      refreshCurrentLineIfVisible(index);
    },
    onError: (index, original, error) => {
      if (requestId !== activeLyricsRequestId) return;
      console.warn("[LyriKana] fast build skipped:", {
        requestId,
        index,
        original,
        error,
      });
    },
  });
}

async function enhanceLyricsFastThenPrecise(
  lyrics: LyricLine[],
  requestId: number
): Promise<void> {
  await enhanceLyricsFast(lyrics, requestId);
  if (requestId !== activeLyricsRequestId) return;
  await enhanceLyricsProgressively(lyrics, requestId);
}

function normalizeForMatch(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function getDurationDelta(song: LrcLibSong, songInfo: SongInfo): number | null {
  if (!songInfo.duration || typeof song.duration !== "number") {
    return null;
  }

  return Math.abs(song.duration - songInfo.duration);
}

function buildLrcLibSearchUrls(song: SongInfo): string[] {
  const urls: string[] = [];
  const base = "https://lrclib.net/api/search";

  if (song.releaseYear) {
    const params = new URLSearchParams({
      query: `${song.title} ${song.artist} ${song.releaseYear}`,
    });
    if (song.duration) {
      params.set("duration", String(song.duration));
    }
    urls.push(`${base}?${params.toString()}`);
  }

  const detailParams = new URLSearchParams({
    track_name: song.title,
    artist_name: song.artist,
  });
  if (song.duration) {
    detailParams.set("duration", String(song.duration));
  }
  urls.push(`${base}?${detailParams.toString()}`);

  return [...new Set(urls)];
}

function scoreLrcLibSong(song: LrcLibSong, songInfo: SongInfo): number {
  let score = 0;

  if (song.syncedLyrics) score += 1000;
  if (normalizeForMatch(song.trackName) === normalizeForMatch(songInfo.title)) {
    score += 120;
  }
  if (normalizeForMatch(song.artistName).includes(normalizeForMatch(songInfo.artist))) {
    score += 80;
  }
  if (songInfo.releaseYear && song.releaseDate?.startsWith(songInfo.releaseYear)) {
    score += 160;
  }
  const durationDelta = getDurationDelta(song, songInfo);
  if (durationDelta !== null) {
    score += Math.max(0, 260 - durationDelta * 60);
  }

  return score;
}

async function searchLrcLibLyrics(song: SongInfo): Promise<LrcLibSong[]> {
  const results: LrcLibSong[] = [];

  for (const url of buildLrcLibSearchUrls(song)) {
    console.log("[LyriKana] fetching lyrics:", { song, url });

    const res = await fetch(url);
    const data: unknown = await res.json();

    if (Array.isArray(data)) {
      results.push(...(data as LrcLibSong[]));
    }

    if (results.some((item) => item.syncedLyrics)) {
      break;
    }
  }

  return results;
}

async function fetchLyrics(
  songInfo: SongInfo,
  requestId: number
): Promise<void> {
  try {
    const cachedLyrics = await requestElectronJson<{
      providerPayload: LrcLibSong;
      syncedLyrics: string;
    }>("/cache/lyrics/get", { songInfo });

    let data: LrcLibSong[] = [];
    let song: LrcLibSong | undefined;

    if (cachedLyrics?.syncedLyrics) {
      song = {
        ...cachedLyrics.providerPayload,
        syncedLyrics: cachedLyrics.syncedLyrics,
      };
      data = [song];
      console.log("[LyriKana] lyrics cache hit:", {
        title: songInfo.title,
        artist: songInfo.artist,
        duration: songInfo.duration,
      });
    } else {
      data = await searchLrcLibLyrics(songInfo);
    }

    if (requestId !== activeLyricsRequestId) {
      console.log("[LyriKana] stale lyrics response ignored", { requestId });
      return;
    }

    console.log("[LyriKana] lyrics api response:", data);

    if (data.length === 0) {
      resetLyrics("Lyrics not found");
      return;
    }

    if (!song) {
      const syncedCandidates = [...data].filter((item) => item?.syncedLyrics);
      song = syncedCandidates
        .sort(
          (first, second) =>
            scoreLrcLibSong(second, songInfo) - scoreLrcLibSong(first, songInfo)
        )[0] ?? data[0];
    }

    console.log("[LyriKana] selected song:", song);

    if (!song?.syncedLyrics) {
      resetLyrics("Synced lyrics not available");
      return;
    }

    if (!cachedLyrics?.syncedLyrics) {
      void requestElectronJson("/cache/lyrics/save", {
        songInfo,
        providerPayload: song,
        syncedLyrics: song.syncedLyrics,
      });
    }

    const baseLyrics = parseLrcBase(song.syncedLyrics) as LyricLine[];
    currentLyrics = baseLyrics.map((line) => ({ ...line }));
    cachedPreciseLineIndexes = new Set();
    currentLineIndex = -1;
    lyricsLoadedAt = Date.now();

    console.log("[LyriKana] base lyrics parsed:", {
      requestId,
      count: currentLyrics.length,
      sample: currentLyrics.slice(0, 3),
    });

    if (currentLyrics.length === 0) {
      resetLyrics("No lyric lines");
      return;
    }

    updateLyricsByTime();
    void (async () => {
      await hydrateCachedLineReadings(currentLyrics, requestId);
      if (requestId !== activeLyricsRequestId) return;
      updateLyricsByTime();
      await enhanceLyricsFastThenPrecise(currentLyrics, requestId);
    })();
  } catch (error) {
    if (requestId !== activeLyricsRequestId) return;
    console.error("[LyriKana] fetchLyrics error:", error);
    resetLyrics("Lyrics error");
  }
}

async function handleSongChange(): Promise<void> {
  const song = getSongInfo();
  if (!song) return;

  const songKey = `${song.title} - ${song.artist}`;
  if (songKey === lastSongKey) return;

  console.log("[LyriKana] song info:", song);
  console.log("[LyriKana] song key:", songKey);

  lastSongKey = songKey;
  currentSongLabel = songKey;
  activeLyricsRequestId += 1;
  const requestId = activeLyricsRequestId;

  resetLyrics("Loading lyrics...");
  await fetchLyrics(song, requestId);
}

function startObserver(): void {
  const target = document.querySelector("ytmusic-player-bar");
  if (!target) {
    console.log("[LyriKana] player not found");
    return;
  }

  const observer = new MutationObserver(() => {
    const song = getSongInfo();
    if (!song) return;

    if (song.title === lastObservedTitle && song.artist === lastObservedArtist) {
      return;
    }

    lastObservedTitle = song.title;
    lastObservedArtist = song.artist;
    void handleSongChange();
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  console.log("[LyriKana] observer started");
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "LYRIKANA_OVERLAY_READY") {
    if (currentLineIndex >= 0) {
      refreshCurrentLineIfVisible(currentLineIndex);
    } else if (currentLyrics.length > 0) {
      updateLyricsDisplay(currentLyrics[0], currentLyrics[1] ?? null);
    } else {
      updateLyricsDisplay(null, null, "LyriKana loading...");
    }
  }
});

window.addEventListener("load", () => {
  openLyricsOverlay();
  void loadSettings().then(setSettings);
  watchSettings(setSettings);
  console.log("[LyriKana] window loaded");

  void getTokenizer().catch((error) => {
    console.warn("[LyriKana] tokenizer preload failed:", error);
  });

  startObserver();
  void handleSongChange();
  setInterval(updateLyricsByTime, 200);
});
