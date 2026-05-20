import {
  enrichLyricsInBackground,
  parseLrcBase,
  parseLrcSyncMarkers,
} from "./utils/lyrics/parseLrcWithPronunciation";
import { getTokenizer } from "./utils/pronunciation/reading";

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

type LrcLibSong = {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  releaseDate?: string | null;
  lyrikanaSyncScorerVersion?: number;
  lyrikanaSyncScore?: number;
  lyrikanaSyncReasons?: string[];
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
const LRC_SYNC_SCORER_VERSION = 1;
const MIN_LRCLIB_SYNCED_CANDIDATES = 4;
const MAX_LRCLIB_SEARCH_URLS = 10;
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

async function saveLyricsToCache(
  songInfo: SongInfo,
  song: LrcLibSong,
  selectedCandidate: LrcLibCandidateScore | null
): Promise<void> {
  await requestElectronJson("/cache/lyrics/save", {
    songInfo,
    providerPayload: {
      ...song,
      lyrikanaSyncScorerVersion: LRC_SYNC_SCORER_VERSION,
      lyrikanaSyncScore:
        selectedCandidate?.score ?? song.lyrikanaSyncScore ?? null,
      lyrikanaSyncReasons:
        selectedCandidate?.reasons ?? song.lyrikanaSyncReasons ?? [],
    },
    syncedLyrics: song.syncedLyrics,
  });
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
    shouldStop: () => false,
    onLine: (_index, builtLine) => {
      const task = (async () => {
        await saveLineReadingToCache(builtLine);
        if (requestId !== activeLyricsRequestId) return;

        const refreshedLine = await getCachedLineReadingsByOriginal([
          builtLine.original,
        ]);
        updateCurrentLyricsFromCache(refreshedLine, requestId);
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

function loadCurrentLyricsFromDb(
  syncedLyrics: string,
  cachedByOriginal: Map<string, CachedLineReading>,
  requestId: number
): boolean {
  const baseLyrics = parseLrcBase(syncedLyrics) as LyricLine[];

  if (baseLyrics.length === 0) {
    resetLyrics("No lyric lines");
    return false;
  }

  currentLyrics = applyCachedLineReadings(baseLyrics, cachedByOriginal);
  currentInstrumentalMarkers = parseLrcSyncMarkers(syncedLyrics).map(
    (marker) => marker.time
  );
  cachedPreciseLineIndexes = new Set(
    currentLyrics
      .map((line, index) => (cachedByOriginal.has(line.original) ? index : -1))
      .filter((index) => index >= 0)
  );
  currentLineIndex = -1;
  lyricsLoadedAt = Date.now();

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] lyrics loaded from DB cache:", {
      requestId,
      count: currentLyrics.length,
      instrumentalMarkers: currentInstrumentalMarkers,
      sample: currentLyrics.slice(0, 3),
    });
  }

  updateLyricsByTime();
  return true;
}

function normalizeForMatch(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function hasJapaneseScript(value: string): boolean {
  return /[一-龯々ぁ-んァ-ヶ]/.test(value);
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function getLrcLibSearchVariants(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  const variants = [normalized];

  for (const match of normalized.matchAll(/[\[(（【]([^()[\]（）【】]+)[\])）】]/g)) {
    variants.push(match[1]);
  }

  variants.push(
    normalized.replace(/\s*[\[(（【][^()[\]（）【】]+[\])）】]\s*/g, " ").trim()
  );

  for (const part of normalized.split(/\s*(?:\/|\||｜|／)\s*/)) {
    variants.push(part);
  }

  return uniqueValues(variants).sort((first, second) => {
    const firstIsJapanese = hasJapaneseScript(first);
    const secondIsJapanese = hasJapaneseScript(second);

    if (firstIsJapanese !== secondIsJapanese) {
      return firstIsJapanese ? -1 : 1;
    }

    return first.length - second.length;
  });
}

function getDurationDelta(song: LrcLibSong, songInfo: SongInfo): number | null {
  if (!songInfo.duration || typeof song.duration !== "number") {
    return null;
  }

  return Math.abs(song.duration - songInfo.duration);
}

function getLrcLibSongIdentity(song: LrcLibSong): string {
  return [
    normalizeForMatch(song.trackName),
    normalizeForMatch(song.artistName),
    normalizeForMatch(song.albumName),
    song.duration ?? "",
    song.releaseDate ?? "",
    song.syncedLyrics?.slice(0, 80) ?? "",
  ].join("::");
}

function dedupeLrcLibSongs(songs: LrcLibSong[]): LrcLibSong[] {
  const seen = new Set<string>();
  const deduped: LrcLibSong[] = [];

  for (const song of songs) {
    const identity = getLrcLibSongIdentity(song);
    if (seen.has(identity)) continue;

    seen.add(identity);
    deduped.push(song);
  }

  return deduped;
}

function buildLrcLibSearchUrls(song: SongInfo): string[] {
  const urls: string[] = [];
  const base = "https://lrclib.net/api/search";
  const titleVariants = getLrcLibSearchVariants(song.title);
  const artistVariants = getLrcLibSearchVariants(song.artist);
  const searchPairs = titleVariants.flatMap((title) =>
    artistVariants.map((artist) => ({ title, artist }))
  );

  for (const pair of searchPairs) {
    if (song.releaseYear) {
      const params = new URLSearchParams({
        query: `${pair.title} ${pair.artist} ${song.releaseYear}`,
      });
      if (song.duration) {
        params.set("duration", String(song.duration));
      }
      urls.push(`${base}?${params.toString()}`);
    }

    const params = new URLSearchParams({
      query: `${pair.title} ${pair.artist}`,
    });
    if (song.duration) {
      params.set("duration", String(song.duration));
    }
    urls.push(`${base}?${params.toString()}`);

    const detailParams = new URLSearchParams({
      track_name: pair.title,
      artist_name: pair.artist,
    });
    if (song.duration) {
      detailParams.set("duration", String(song.duration));
    }
    urls.push(`${base}?${detailParams.toString()}`);
  }

  return [...new Set(urls)];
}

function scoreLrcLibSong(song: LrcLibSong, songInfo: SongInfo): number {
  let score = 0;
  const titleVariants = getLrcLibSearchVariants(songInfo.title);
  const artistVariants = getLrcLibSearchVariants(songInfo.artist);

  if (song.syncedLyrics) score += 1000;
  if (
    titleVariants.some(
      (title) => normalizeForMatch(song.trackName) === normalizeForMatch(title)
    )
  ) {
    score += 120;
  }
  if (
    artistVariants.some((artist) =>
      normalizeForMatch(song.artistName).includes(normalizeForMatch(artist))
    )
  ) {
    score += 80;
  }
  if (
    hasJapaneseScript(song.trackName ?? "") &&
    titleVariants.some((title) => hasJapaneseScript(title))
  ) {
    score += 40;
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

type LrcLibCandidateScore = {
  song: LrcLibSong;
  score: number;
  reasons: string[];
  lineCount: number;
  firstTime: number | null;
  lastTime: number | null;
};

function scoreLrcTimeline(song: LrcLibSong, songInfo: SongInfo): Omit<
  LrcLibCandidateScore,
  "song"
> {
  let score = scoreLrcLibSong(song, songInfo);
  const reasons: string[] = [];
  const lines = parseLrcBase(song.syncedLyrics ?? "");
  const firstTime = lines[0]?.time ?? null;
  const lastTime = lines.length > 0 ? lines[lines.length - 1].time : null;
  const duration = songInfo.duration;

  if (!song.syncedLyrics) {
    return {
      score: score - 1000,
      reasons: ["no synced lyrics"],
      lineCount: 0,
      firstTime,
      lastTime,
    };
  }

  if (lines.length === 0) {
    return {
      score: score - 800,
      reasons: ["synced lyrics parsed no timed lines"],
      lineCount: 0,
      firstTime,
      lastTime,
    };
  }

  score += Math.min(160, lines.length * 4);
  reasons.push(`${lines.length} timed lines`);

  if (lines.length < 6) {
    score -= 160;
    reasons.push("very few timed lines");
  }

  let nonIncreasingGaps = 0;
  let veryDenseGaps = 0;
  let maxGap = 0;

  for (let index = 1; index < lines.length; index += 1) {
    const gap = lines[index].time - lines[index - 1].time;

    if (gap <= 0) {
      nonIncreasingGaps += 1;
    } else {
      maxGap = Math.max(maxGap, gap);
      if (gap < 0.18) veryDenseGaps += 1;
    }
  }

  if (nonIncreasingGaps > 0) {
    score -= nonIncreasingGaps * 80;
    reasons.push(`${nonIncreasingGaps} non-increasing timestamps`);
  }

  if (veryDenseGaps > Math.max(2, lines.length * 0.08)) {
    score -= 90;
    reasons.push("too many near-duplicate timestamps");
  }

  if (duration && firstTime !== null && lastTime !== null) {
    const lyricSpan = Math.max(0, lastTime - firstTime);
    const lyricDensity = lines.length / Math.max(1, lyricSpan / 60);
    const outroSeconds = duration - lastTime;

    if (lastTime > duration + 4) {
      score -= Math.min(420, (lastTime - duration) * 55);
      reasons.push("last lyric exceeds current track duration");
    } else if (lastTime >= duration * 0.52) {
      score += 100;
      reasons.push("last lyric fits inside track duration");
    } else {
      score -= 180;
      reasons.push("last lyric ends unusually early");
    }

    if (outroSeconds >= -2 && outroSeconds <= 45) {
      score += Math.max(0, 75 - Math.abs(outroSeconds - 12) * 2.2);
      reasons.push("outro length is plausible");
    }

    if (firstTime > Math.min(70, duration * 0.36)) {
      score -= 120;
      reasons.push("first lyric starts unusually late");
    } else {
      score += 35;
      reasons.push("first lyric start is plausible");
    }

    if (maxGap > Math.max(45, duration * 0.42)) {
      score -= 90;
      reasons.push("contains an unusually long lyric gap");
    }

    if (lyricDensity < 2 || lyricDensity > 42) {
      score -= 70;
      reasons.push("lyric line density is unusual");
    } else {
      score += 45;
      reasons.push("lyric line density is plausible");
    }
  }

  return {
    score,
    reasons,
    lineCount: lines.length,
    firstTime,
    lastTime,
  };
}

function scoreLrcLibCandidate(
  song: LrcLibSong,
  songInfo: SongInfo
): LrcLibCandidateScore {
  return {
    song,
    ...scoreLrcTimeline(song, songInfo),
  };
}

function selectBestLrcLibSong(
  songs: LrcLibSong[],
  songInfo: SongInfo
): LrcLibCandidateScore | null {
  const scored = dedupeLrcLibSongs(songs)
    .filter((song) => song.syncedLyrics)
    .map((song) => scoreLrcLibCandidate(song, songInfo))
    .sort((first, second) => second.score - first.score);

  return scored[0] ?? null;
}

function summarizeLrcLibCandidates(
  songs: LrcLibSong[],
  songInfo: SongInfo
) {
  return dedupeLrcLibSongs(songs)
    .filter((song) => song.syncedLyrics)
    .map((song) => scoreLrcLibCandidate(song, songInfo))
    .sort((first, second) => second.score - first.score)
    .map((candidate) => ({
      score: Math.round(candidate.score),
      trackName: candidate.song.trackName,
      artistName: candidate.song.artistName,
      albumName: candidate.song.albumName,
      duration: candidate.song.duration,
      lineCount: candidate.lineCount,
      firstTime: candidate.firstTime,
      lastTime: candidate.lastTime,
      reasons: candidate.reasons,
    }));
}

async function searchLrcLibLyrics(song: SongInfo): Promise<LrcLibSong[]> {
  const results: LrcLibSong[] = [];
  const urls = buildLrcLibSearchUrls(song);

  for (const url of urls.slice(0, MAX_LRCLIB_SEARCH_URLS)) {
    const res = await fetch(url);
    const data: unknown = await res.json();

    if (Array.isArray(data)) {
      results.push(...(data as LrcLibSong[]));
    }

    const syncedCount = dedupeLrcLibSongs(results).filter(
      (item) => item.syncedLyrics
    ).length;

    if (syncedCount >= MIN_LRCLIB_SYNCED_CANDIDATES) {
      break;
    }
  }

  return dedupeLrcLibSongs(results);
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

    const cachedSong = cachedLyrics?.syncedLyrics
      ? {
          ...cachedLyrics.providerPayload,
          syncedLyrics: cachedLyrics.syncedLyrics,
        }
      : undefined;

    if (cachedSong?.syncedLyrics) {
      const baseLyrics = parseLrcBase(cachedSong.syncedLyrics) as LyricLine[];
      const cachedLines = await getCachedLineReadingsByOriginal(
        baseLyrics.map((line) => line.original)
      );

      if (requestId !== activeLyricsRequestId) {
        if (DEBUG_FLOW_LOGS) {
          console.log("[LyriKana] stale lyrics response ignored", { requestId });
        }
        return;
      }

      const loadedFromCache = loadCurrentLyricsFromDb(
        cachedSong.syncedLyrics,
        cachedLines,
        requestId
      );

      if (
        loadedFromCache &&
        hasCompleteLineReadings(baseLyrics, cachedLines)
      ) {
        return;
      }

      if (DEBUG_FLOW_LOGS) {
        console.log("[LyriKana] cached song needs reading analysis:", {
          requestId,
          title: songInfo.title,
          artist: songInfo.artist,
          cachedLines: cachedLines.size,
          totalLines: baseLyrics.length,
        });
      }

      await analyzeAndSaveMissingLineReadings(baseLyrics, cachedLines, requestId);

      if (requestId !== activeLyricsRequestId) return;

      const refreshedLines = await getCachedLineReadingsByOriginal(
        baseLyrics.map((line) => line.original)
      );

      if (requestId !== activeLyricsRequestId) return;

      updateCurrentLyricsFromCache(refreshedLines, requestId);
      return;
    }

    const data = await searchLrcLibLyrics(songInfo);

    if (requestId !== activeLyricsRequestId) {
      if (DEBUG_FLOW_LOGS) {
        console.log("[LyriKana] stale lyrics response ignored", { requestId });
      }
      return;
    }

    if (data.length === 0) {
      resetLyrics("Lyrics not found");
      return;
    }

    const selectedCandidate = selectBestLrcLibSong(data, songInfo);
    const song = selectedCandidate?.song ?? data[0];

    if (DEBUG_FLOW_LOGS) {
      console.log("[LyriKana] LRCLIB search summary:", {
        requestId,
        songInfo,
        totalCandidates: data.length,
        syncedCandidates: data.filter((item) => item.syncedLyrics).length,
        selected: song
          ? {
              trackName: song.trackName,
              artistName: song.artistName,
              albumName: song.albumName,
              duration: song.duration,
              syncScore:
                selectedCandidate?.score ?? song.lyrikanaSyncScore ?? null,
              syncReasons:
                selectedCandidate?.reasons ?? song.lyrikanaSyncReasons ?? [],
            }
          : null,
        candidates: summarizeLrcLibCandidates(data, songInfo),
      });
    }

    if (!song?.syncedLyrics) {
      resetLyrics("Synced lyrics not available");
      return;
    }

    await saveLyricsToCache(songInfo, song, selectedCandidate);

    if (requestId !== activeLyricsRequestId) return;

    const cachedAfterSave = await requestElectronJson<{
      providerPayload: LrcLibSong;
      syncedLyrics: string;
    }>("/cache/lyrics/get", { songInfo });
    const savedSyncedLyrics = cachedAfterSave?.syncedLyrics ?? song.syncedLyrics;
    const baseLyrics = parseLrcBase(savedSyncedLyrics) as LyricLine[];

    if (baseLyrics.length === 0) {
      resetLyrics("No lyric lines");
      return;
    }

    const cachedLines = await getCachedLineReadingsByOriginal(
      baseLyrics.map((line) => line.original)
    );

    if (requestId !== activeLyricsRequestId) return;

    loadCurrentLyricsFromDb(savedSyncedLyrics, cachedLines, requestId);

    await analyzeAndSaveMissingLineReadings(baseLyrics, cachedLines, requestId);

    if (requestId !== activeLyricsRequestId) return;

    const refreshedLines = await getCachedLineReadingsByOriginal(
      baseLyrics.map((line) => line.original)
    );

    if (requestId !== activeLyricsRequestId) return;

    updateCurrentLyricsFromCache(refreshedLines, requestId);
  } catch (error) {
    if (requestId !== activeLyricsRequestId) return;
    if (DEBUG_FLOW_LOGS) {
      console.error("[LyriKana] fetchLyrics error:", error);
    }
    resetLyrics("Lyrics error");
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
  activeLyricsRequestId += 1;
  ignoreStalePlaybackTimeUntil = Date.now() + SONG_SWITCH_STALE_TIME_GUARD_MS;
  stalePlaybackTimeGuardActive = true;
  const requestId = activeLyricsRequestId;

  resetLyrics("Loading lyrics...");
  await fetchLyrics(song, requestId);
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
