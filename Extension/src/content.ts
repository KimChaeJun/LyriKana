import {
  enrichLyricsInBackground,
  parseLrcSyncMarkers,
} from "./utils/lyrics/parseLrcWithPronunciation";
import { getTokenizer } from "./utils/pronunciation/reading";
import {
  BackendRequestError,
  resolveLyrics,
  saveConvertedLyrics,
  type BackendLyricLine,
  type BackendSongResponse,
} from "./api/backend";

type LyriKanaSettings = {
  enabled: boolean;
  showReading: boolean;
  showTranslation: boolean;
  showNextLine: boolean;
  showInstrumental: boolean;
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
  showInstrumental: false,
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

type CachedLineReading = Pick<LyricLine, "original" | "reading" | "kr" | "jp" | "en">;

type PlayerCommand = "play-pause" | "next" | "previous";

type QueuedPlayerCommand = {
  command: PlayerCommand;
  createdAt: number;
};

let lastSongKey: string | null = null;
let currentLyrics: LyricLine[] = [];
let currentInstrumentalMarkers: number[] = [];
let currentLineIndex = -1;
let activeLyricsRequestId = 0;
let activeLyricsAbortController: AbortController | null = null;
let lastObservedTitle = "";
let lastObservedArtist = "";
let settings: LyriKanaSettings = { ...DEFAULT_SETTINGS };
let lyricsLoadedAt = 0;
let currentSongLabel = "LyriKana";
let cachedPreciseLineIndexes = new Set<number>();
let ignoreStalePlaybackTimeUntil = 0;
let stalePlaybackTimeGuardActive = false;
let observedVideo: HTMLVideoElement | null = null;
let lastPlaybackResetAt = 0;
let lastReportedIsPlaying: boolean | null = null;
let lastOverlayStateLogKey = "";

const INTRO_TEXT = "♪ 전주 ♪";
const INSTRUMENTAL_TEXT = "♪ 간주 ♪";
const EXPLICIT_INSTRUMENTAL_MIN_GAP_SECONDS = 4;
const INSTRUMENTAL_MIN_GAP_SECONDS = 9;
const ELECTRON_OVERLAY_URL = "http://127.0.0.1:17654";
const READING_CACHE_VERSION = 8;
const SONG_SWITCH_STALE_TIME_GUARD_MS = 45000;
const SONG_SWITCH_MAX_INITIAL_TIME_SECONDS = 15;
const SONG_SWITCH_STALE_TIME_GRACE_MS = 4500;
const FRESH_LYRICS_STALE_TIME_GUARD_MS = 20000;
const DEBUG_FLOW_LOGS = false;

type LocalNetworkRequestInit = RequestInit & {
  targetAddressSpace?: "loopback" | "local" | "private" | "public";
};
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
    showInstrumental:
      candidate.showInstrumental ?? DEFAULT_SETTINGS.showInstrumental,
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

function postToElectronOverlay(
  path: "/overlay" | "/settings" | "/playback",
  payload: unknown
): void {
  fetch(`${ELECTRON_OVERLAY_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    targetAddressSpace: "loopback",
  } as LocalNetworkRequestInit).catch(() => {
    // The companion app is optional; lyric processing should continue if closed.
  });
}

function isVideoPlaying(): boolean {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  return Boolean(player && !player.paused && !player.ended);
}

function syncPlaybackStateToOverlay(force = false): void {
  const isPlaying = isVideoPlaying();
  if (!force && isPlaying === lastReportedIsPlaying) return;

  lastReportedIsPlaying = isPlaying;
  postToElectronOverlay("/playback", { isPlaying });
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
      targetAddressSpace: "loopback",
    } as LocalNetworkRequestInit);

    if (!response.ok) return null;

    const json = (await response.json()) as { ok?: boolean; data?: T };
    return json.ok ? json.data ?? null : null;
  } catch {
    return null;
  }
}

function getPlayerBar(): Element | Document {
  return document.querySelector("ytmusic-player-bar") ?? document;
}

function includesAnyLabel(element: Element, labels: string[]): boolean {
  const text = [
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.textContent,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return labels.some((label) => text.includes(label.toLowerCase()));
}

function findPlayerControlButton(
  selectors: string[],
  labels: string[]
): HTMLElement | null {
  const root = getPlayerBar();

  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element instanceof HTMLElement) return element;
  }

  const candidates = Array.from(
    root.querySelectorAll("button, tp-yt-paper-icon-button, yt-icon-button")
  );

  return (
    candidates.find((candidate) => includesAnyLabel(candidate, labels)) ??
    null
  ) as HTMLElement | null;
}

function clickPlayerControl(command: PlayerCommand): void {
  if (command === "play-pause") {
    const button = findPlayerControlButton(
      [
        "#play-pause-button",
        ".play-pause-button",
        "button[aria-label*='Play']",
        "button[aria-label*='Pause']",
        "button[title*='Play']",
        "button[title*='Pause']",
      ],
      ["play", "pause", "재생", "일시정지"]
    );

    if (button) {
      button.click();
      return;
    }

    const player = document.querySelector("video") as HTMLVideoElement | null;
    if (!player) return;
    if (player.paused) {
      void player.play();
    } else {
      player.pause();
    }
    return;
  }

  const button =
    command === "next"
      ? findPlayerControlButton(
          [
            ".next-button",
            "#next-button",
            "button[aria-label*='Next']",
            "button[title*='Next']",
          ],
          ["next", "다음"]
        )
      : findPlayerControlButton(
          [
            ".previous-button",
            "#previous-button",
            "button[aria-label*='Previous']",
            "button[title*='Previous']",
          ],
          ["previous", "이전"]
        );

  if (button) {
    button.click();
    resetPlaybackTimeline(`player command: ${command}`);
  }
}

async function pollPlayerCommands(): Promise<void> {
  const result = await requestElectronJson<{ commands: QueuedPlayerCommand[] }>(
    "/player/commands/poll",
    {}
  );

  if (!result?.commands?.length) return;

  for (const item of result.commands) {
    clickPlayerControl(item.command);
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
  const payload = {
    songLabel: currentSongLabel,
    isPlaying: isVideoPlaying(),
    original: overrideOriginal || current?.original || "",
    reading:
      overrideOriginal || !settings.showReading ? "" : current?.reading || "",
    translation:
      overrideOriginal || !settings.showTranslation ? "" : current?.kr || "",
    next: settings.showNextLine && next?.original ? `다음: ${next.original}` : "",
    settings,
  };
  const logKey = [
    payload.songLabel,
    currentLineIndex,
    payload.isPlaying,
    payload.original,
    payload.reading,
    payload.translation,
    payload.next,
  ].join("\u0001");

  if (logKey !== lastOverlayStateLogKey) {
    lastOverlayStateLogKey = logKey;
    console.log("[LyriKana] overlay state:", {
      requestId: activeLyricsRequestId,
      songLabel: payload.songLabel,
      lineIndex: currentLineIndex,
      isPlaying: payload.isPlaying,
      original: payload.original,
      reading: payload.reading,
      translation: payload.translation,
      next: payload.next,
      source: overrideOriginal ? "status" : "db",
    });
  }

  postToElectronOverlay("/overlay", payload);
}

function resetLyrics(message: string): void {
  currentLyrics = [];
  currentInstrumentalMarkers = [];
  cachedPreciseLineIndexes = new Set();
  currentLineIndex = -1;
  updateLyricsDisplay(null, null, message);
}

function resetPlaybackTimeline(reason: string): void {
  const now = Date.now();
  if (now - lastPlaybackResetAt < 800) return;

  lastPlaybackResetAt = now;
  ignoreStalePlaybackTimeUntil = now + SONG_SWITCH_STALE_TIME_GUARD_MS;
  stalePlaybackTimeGuardActive = true;
  currentLineIndex = -6;
  updateLyricsDisplay(null, null, "");
  syncPlaybackStateToOverlay(true);

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] playback timeline reset:", { reason });
  }
}

function bindVideoPlaybackResetEvents(): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || player === observedVideo) return;

  observedVideo = player;

  player.addEventListener("ended", () => {
    resetPlaybackTimeline("video ended");
  });

  player.addEventListener("play", () => {
    syncPlaybackStateToOverlay(true);
  });

  player.addEventListener("pause", () => {
    syncPlaybackStateToOverlay(true);
  });

  player.addEventListener("emptied", () => {
    resetPlaybackTimeline("video emptied");
  });

  player.addEventListener("loadstart", () => {
    if (currentLyrics.length > 0) {
      resetPlaybackTimeline("video loadstart");
    }
  });
}

function estimateSungLineDuration(line: LyricLine): number {
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

function estimateLineEndTime(index: number): number {
  const currentLine = currentLyrics[index];
  const nextLine = currentLyrics[index + 1];

  if (!currentLine) return 0;
  if (!nextLine) return currentLine.time + estimateSungLineDuration(currentLine);

  const gap = nextLine.time - currentLine.time;
  const textBasedDuration = estimateSungLineDuration(currentLine);

  if (gap <= 0) {
    return currentLine.time + textBasedDuration;
  }

  const latestSafeEnd = Math.max(
    currentLine.time,
    nextLine.time - settings.previewLeadTime
  );

  if (gap < INSTRUMENTAL_MIN_GAP_SECONDS) {
    return Math.min(
      latestSafeEnd,
      currentLine.time + Math.max(textBasedDuration, gap * 0.82)
    );
  }

  const gapHoldRatio = gap >= 24 ? 0.5 : gap >= 16 ? 0.58 : 0.68;
  const adaptiveDuration = Math.max(textBasedDuration, gap * gapHoldRatio);

  return Math.min(latestSafeEnd, currentLine.time + adaptiveDuration);
}

function findInstrumentalMarkerBetween(
  currentLine: LyricLine,
  nextLine: LyricLine
): number | null {
  const gap = nextLine.time - currentLine.time;
  if (gap < EXPLICIT_INSTRUMENTAL_MIN_GAP_SECONDS) return null;

  const marker = currentInstrumentalMarkers.find(
    (time) => time > currentLine.time + 0.35 && time < nextLine.time - 0.35
  );

  return marker ?? null;
}

function refreshCurrentLineIfVisible(index: number): void {
  if (index !== currentLineIndex) return;

  const currentLine = currentLyrics[index];
  const nextLine = currentLyrics[index + 1];
  updateLyricsDisplay(currentLine, nextLine);
}

function getCurrentPlaybackTime(): number {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  const currentTime = player?.currentTime ?? 0;

  if (
    stalePlaybackTimeGuardActive &&
    Date.now() < ignoreStalePlaybackTimeUntil &&
    currentTime > SONG_SWITCH_MAX_INITIAL_TIME_SECONDS
  ) {
    return 0;
  }

  return currentTime;
}

function getPlaybackDebugSnapshot() {
  const player = document.querySelector("video") as HTMLVideoElement | null;

  return {
    rawCurrentTime: player?.currentTime ?? null,
    guardedCurrentTime: getCurrentPlaybackTime(),
    duration: player?.duration ?? null,
    ended: player?.ended ?? null,
    paused: player?.paused ?? null,
    ignoreStalePlaybackTimeMs: Math.max(
      0,
      ignoreStalePlaybackTimeUntil - Date.now()
    ),
    stalePlaybackTimeGuardActive,
    currentLyricsCount: currentLyrics.length,
    currentLineIndex,
  };
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
  const cachedByOriginal = await getCachedLineReadingsByOriginal(
    lyrics.map((line) => line.original)
  );

  if (requestId !== activeLyricsRequestId || cachedByOriginal.size === 0) return;

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

async function getCachedLineReadingsByOriginal(
  originals: string[]
): Promise<Map<string, CachedLineReading>> {
  const result = await requestElectronJson<{
    lines: CachedLineReading[];
  }>("/cache/lines/get", {
    engineVersion: READING_CACHE_VERSION,
    originals: [...new Set(originals)],
  });

  return new Map((result?.lines ?? []).map((line) => [line.original, line]));
}

function applyCachedLineReadings(
  lyrics: LyricLine[],
  cachedByOriginal: Map<string, CachedLineReading>
): LyricLine[] {
  return lyrics.map((line) => {
    const cached = cachedByOriginal.get(line.original);
    return cached
      ? {
          ...line,
          reading: cached.reading,
          kr: cached.kr,
          jp: cached.jp,
          en: cached.en,
        }
      : line;
  });
}

function hasCompleteLineReadings(
  lyrics: LyricLine[],
  cachedByOriginal: Map<string, CachedLineReading>
): boolean {
  return lyrics.every((line) => cachedByOriginal.has(line.original));
}

function updateCurrentLyricsFromCache(
  cachedByOriginal: Map<string, CachedLineReading>,
  requestId: number
): void {
  if (requestId !== activeLyricsRequestId || cachedByOriginal.size === 0) return;

  currentLyrics.forEach((line, index) => {
    const cached = cachedByOriginal.get(line.original);
    if (!cached) return;

    currentLyrics[index] = {
      ...line,
      reading: cached.reading,
      kr: cached.kr,
      jp: cached.jp,
      en: cached.en,
    };
    cachedPreciseLineIndexes.add(index);
  });

  refreshCurrentLineIfVisible(currentLineIndex);
}

async function saveLineReadingToCache(line: LyricLine): Promise<boolean> {
  const result = await requestElectronJson<{ ok?: boolean }>("/cache/lines/save", {
    engineVersion: READING_CACHE_VERSION,
    line,
  });
  return result !== null;
}

function updateLyricsByTime(): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || currentLyrics.length === 0) return;

  bindVideoPlaybackResetEvents();
  syncPlaybackStateToOverlay();

  const rawCurrentTime = player.currentTime;
  const currentTime = getCurrentPlaybackTime();
  const lastLine = currentLyrics[currentLyrics.length - 1];
  const firstLine = currentLyrics[0];
  const lyricsAgeMs = Date.now() - lyricsLoadedAt;

  if (player.ended) {
    resetPlaybackTimeline("video ended state");
    return;
  }

  if (
    stalePlaybackTimeGuardActive &&
    lyricsAgeMs >= SONG_SWITCH_STALE_TIME_GRACE_MS &&
    firstLine &&
    rawCurrentTime > SONG_SWITCH_MAX_INITIAL_TIME_SECONDS &&
    rawCurrentTime <=
      Math.max(SONG_SWITCH_MAX_INITIAL_TIME_SECONDS, firstLine.time + 8)
  ) {
    if (DEBUG_FLOW_LOGS) {
      console.log("[LyriKana] stale playback guard released near first lyric:", {
        songLabel: currentSongLabel,
        rawCurrentTime,
        firstLineTime: firstLine.time,
        lyricsAgeMs,
        duration: player.duration,
        requestId: activeLyricsRequestId,
      });
    }
    stalePlaybackTimeGuardActive = false;
    ignoreStalePlaybackTimeUntil = 0;
  }

  if (
    stalePlaybackTimeGuardActive &&
    Date.now() < ignoreStalePlaybackTimeUntil &&
    rawCurrentTime > SONG_SWITCH_MAX_INITIAL_TIME_SECONDS
  ) {
    if (currentLineIndex !== -5) {
      currentLineIndex = -5;
      if (DEBUG_FLOW_LOGS) {
        console.log("[LyriKana] stale playback time guarded:", {
          songLabel: currentSongLabel,
          rawCurrentTime,
          currentTime,
          duration: player.duration,
          firstLineTime: firstLine?.time ?? null,
          lyricsAgeMs,
          requestId: activeLyricsRequestId,
        });
      }
      updateLyricsDisplay(currentLyrics[0], currentLyrics[1] ?? null);
    }
    return;
  }

  if (
    stalePlaybackTimeGuardActive &&
    (rawCurrentTime <= SONG_SWITCH_MAX_INITIAL_TIME_SECONDS ||
      Date.now() >= ignoreStalePlaybackTimeUntil)
  ) {
    if (DEBUG_FLOW_LOGS) {
      console.log("[LyriKana] stale playback guard released:", {
        songLabel: currentSongLabel,
        rawCurrentTime,
        currentTime,
        duration: player.duration,
        expired: Date.now() >= ignoreStalePlaybackTimeUntil,
        requestId: activeLyricsRequestId,
      });
    }
    stalePlaybackTimeGuardActive = false;
    ignoreStalePlaybackTimeUntil = 0;
  }

  if (
    lastLine &&
    Date.now() - lyricsLoadedAt < FRESH_LYRICS_STALE_TIME_GUARD_MS &&
    currentTime > lastLine.time + 5
  ) {
    if (currentLineIndex !== -4) {
      currentLineIndex = -4;
      if (DEBUG_FLOW_LOGS) {
        console.log("[LyriKana] suspicious fresh lyrics time guarded:", {
          songLabel: currentSongLabel,
          rawCurrentTime,
          currentTime,
          lastLineTime: lastLine.time,
          lyricsAgeMs,
          requestId: activeLyricsRequestId,
        });
      }
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

  if (settings.showInstrumental && nextLine) {
    const explicitInstrumentalStart = findInstrumentalMarkerBetween(
      currentLine,
      nextLine
    );

    if (
      explicitInstrumentalStart !== null &&
      currentTime >= explicitInstrumentalStart
    ) {
      if (currentLineIndex !== -2) {
        currentLineIndex = -2;
        updateLyricsDisplay(null, nextLine, INSTRUMENTAL_TEXT);
      }
      return;
    }

    const gap = nextLine.time - currentLine.time;
    const estimatedEnd = estimateLineEndTime(newIndex);
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

  if (newIndex !== currentLineIndex) {
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
        if (DEBUG_FLOW_LOGS) {
          console.warn("[LyriKana] original mismatch detected:", {
            index,
            originalBefore,
            builtOriginal: builtLine.original,
          });
        }
      }

      void saveLineReadingToCache(currentLyrics[index]);
      refreshCurrentLineIfVisible(index);
    },
    onError: (index, original, error) => {
      if (requestId !== activeLyricsRequestId) return;
      if (DEBUG_FLOW_LOGS) {
        console.warn("[LyriKana] progressive build skipped:", {
          requestId,
          index,
          original,
          error,
        });
      }
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

      refreshCurrentLineIfVisible(index);
    },
    onError: (index, original, error) => {
      if (requestId !== activeLyricsRequestId) return;
      if (DEBUG_FLOW_LOGS) {
        console.warn("[LyriKana] fast build skipped:", {
          requestId,
          index,
          original,
          error,
        });
      }
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

async function analyzeAndSaveMissingLineReadings(
  baseLyrics: LyricLine[],
  cachedByOriginal: Map<string, CachedLineReading>,
  requestId: number
): Promise<void> {
  const missingIndexes = buildPlaybackPriorityIndices(baseLyrics).filter(
    (index) => !cachedByOriginal.has(baseLyrics[index].original)
  );

  if (missingIndexes.length === 0) return;

  const saveTasks: Promise<void>[] = [];

  await enrichLyricsInBackground(baseLyrics, {
    concurrency: 3,
    buildMode: "precise",
    indices: missingIndexes,
    shouldStop: () => requestId !== activeLyricsRequestId,
    onLine: (index, builtLine) => {
      if (requestId !== activeLyricsRequestId || !currentLyrics[index]) return;

      currentLyrics[index] = {
        ...currentLyrics[index],
        ...builtLine,
        original: currentLyrics[index].original,
      };
      refreshCurrentLineIfVisible(index);

      const task = (async () => {
        await saveLineReadingToCache(builtLine);
      })();
      saveTasks.push(task);
    },
    onError: (index, original, error) => {
      if (requestId !== activeLyricsRequestId) return;
      if (DEBUG_FLOW_LOGS) {
        console.warn("[LyriKana] DB-only build skipped:", {
          requestId,
          index,
          original,
          error,
        });
      }
    },
  });

  await Promise.all(saveTasks);
}

function backendReadingsByOriginal(
  lines: BackendLyricLine[]
): Map<string, CachedLineReading> {
  return new Map(
    lines
      .filter((line) => Boolean(line.reading || line.kr || line.jp || line.en))
      .map((line) => [
        line.original,
        {
          original: line.original,
          reading: line.reading || "",
          kr: line.kr || "",
          jp: line.jp || "",
          en: line.en || "",
        },
      ])
  );
}

function loadCurrentLyricsFromBackend(
  response: BackendSongResponse,
  cachedByOriginal: Map<string, CachedLineReading>
): boolean {
  const baseLyrics = response.lyrics
    .filter((line): line is BackendLyricLine & { time: number } => line.time !== null)
    .sort((first, second) => first.lineNo - second.lineNo)
    .map((line) => ({
      time: line.time,
      original: line.original,
      reading: line.reading || "",
      kr: line.kr || "",
      jp: line.jp || "",
      en: line.en || "",
    }));

  if (baseLyrics.length === 0) {
    resetLyrics("Synced lyrics not available");
    return false;
  }

  currentLyrics = applyCachedLineReadings(baseLyrics, cachedByOriginal);
  currentInstrumentalMarkers = parseLrcSyncMarkers(response.rawLrc || "").map(
    (marker) => marker.time
  );
  cachedPreciseLineIndexes = new Set(
    currentLyrics
      .map((line, index) => (cachedByOriginal.has(line.original) ? index : -1))
      .filter((index) => index >= 0)
  );
  currentLineIndex = -1;
  lyricsLoadedAt = Date.now();
  updateLyricsByTime();
  return true;
}

async function persistCurrentLyrics(
  songId: string,
  requestId: number,
  signal?: AbortSignal
): Promise<void> {
  if (requestId !== activeLyricsRequestId) return;

  try {
    await saveConvertedLyrics(
      songId,
      currentLyrics.map((line, lineNo) => ({
        lineNo,
        reading: line.reading,
        kr: line.kr,
        jp: line.jp,
        en: line.en,
      })),
      signal
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (DEBUG_FLOW_LOGS) {
      console.warn("[LyriKana] converted lyrics could not be persisted:", error);
    }
  }
}

async function fetchLyrics(
  songInfo: SongInfo,
  requestId: number,
  signal?: AbortSignal
): Promise<void> {
  try {
    const response = await resolveLyrics(
      {
        title: songInfo.title,
        artist: songInfo.artist,
        duration: songInfo.duration,
        playbackTime: getCurrentPlaybackTime(),
      },
      signal
    );

    if (requestId !== activeLyricsRequestId) return;

    if (response.status === "failed") {
      resetLyrics(
        response.error === "lyrics_not_found" ? "Lyrics not found" : "Lyrics error"
      );
      return;
    }

    if (response.lyrics.length === 0 || !response.rawLrc) {
      resetLyrics("Lyrics are still processing");
      return;
    }

    const backendCachedLines = backendReadingsByOriginal(response.lyrics);
    const localCachedLines = await getCachedLineReadingsByOriginal(
      response.lyrics.map((line) => line.original)
    );
    const cachedLines = new Map([
      ...localCachedLines,
      ...backendCachedLines,
    ]);

    if (requestId !== activeLyricsRequestId) return;
    if (!loadCurrentLyricsFromBackend(response, cachedLines)) return;

    const baseLyrics = response.lyrics
      .filter((line): line is BackendLyricLine & { time: number } => line.time !== null)
      .sort((first, second) => first.lineNo - second.lineNo)
      .map((line) => ({
        time: line.time,
        original: line.original,
        reading: "",
        kr: "",
        jp: "",
        en: "",
      }));
    if (baseLyrics.length === 0) {
      resetLyrics("No synced lyric lines");
      return;
    }

    if (hasCompleteLineReadings(baseLyrics, cachedLines)) {
      await persistCurrentLyrics(response.song.id, requestId, signal);
      return;
    }

    await analyzeAndSaveMissingLineReadings(baseLyrics, cachedLines, requestId);
    if (requestId !== activeLyricsRequestId) return;

    const refreshedLocalLines = await getCachedLineReadingsByOriginal(
      baseLyrics.map((line) => line.original)
    );
    const refreshedLines = new Map([
      ...backendCachedLines,
      ...refreshedLocalLines,
    ]);

    updateCurrentLyricsFromCache(refreshedLines, requestId);
    await persistCurrentLyrics(response.song.id, requestId, signal);
  } catch (error) {
    if (requestId !== activeLyricsRequestId) return;
    if (error instanceof DOMException && error.name === "AbortError") return;

    if (DEBUG_FLOW_LOGS) {
      console.error("[LyriKana] fetchLyrics error:", error);
    }

    resetLyrics(
      error instanceof BackendRequestError && error.message === "backend_unavailable"
        ? "Backend unavailable"
        : "Lyrics error"
    );
  }
}

async function handleSongChange(): Promise<void> {
  const song = getSongInfo();
  if (!song) return;

  const songKey = `${song.title} - ${song.artist}`;
  if (songKey === lastSongKey) return;

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] song change detected:", {
      song,
      songKey,
      previousSongKey: lastSongKey,
      playback: getPlaybackDebugSnapshot(),
    });
  }

  lastSongKey = songKey;
  currentSongLabel = songKey;
  activeLyricsAbortController?.abort();
  activeLyricsAbortController = new AbortController();
  activeLyricsRequestId += 1;
  ignoreStalePlaybackTimeUntil = Date.now() + SONG_SWITCH_STALE_TIME_GUARD_MS;
  stalePlaybackTimeGuardActive = true;
  const requestId = activeLyricsRequestId;

  resetLyrics("Loading lyrics...");
  await fetchLyrics(song, requestId, activeLyricsAbortController.signal);
}

function startObserver(): void {
  const target = document.querySelector("ytmusic-player-bar");
  if (!target) {
    if (DEBUG_FLOW_LOGS) {
      console.log("[LyriKana] player not found");
    }
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

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] observer started");
  }
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
  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] window loaded");
  }

  void getTokenizer().catch((error) => {
    if (DEBUG_FLOW_LOGS) {
      console.warn("[LyriKana] tokenizer preload failed:", error);
    }
  });

  startObserver();
  void handleSongChange();
  bindVideoPlaybackResetEvents();
  syncPlaybackStateToOverlay(true);
  setInterval(() => {
    void pollPlayerCommands();
  }, 400);
  setInterval(updateLyricsByTime, 200);
});
