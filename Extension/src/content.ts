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
import {
  postElectronRequest,
  requestElectronData,
} from "./api/electron";
import {
  createSongTransitionGuard,
  getMediaTimelineSongStart,
  hasSongPlaybackProgressTransitioned,
  isConfirmedPlaybackMediaCurrent,
  isExpectedPlaybackMediaReady,
  normalizeSongPlaybackPosition,
  shouldReleaseSongTransitionGuard,
  type SongPlaybackPosition,
  type SongTransitionGuard,
} from "./utils/playback/songTransition";
import { shouldHoldPlaybackForLyrics } from "./utils/playback/lyricsPreparation";

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
  lineNo?: number;
  reading: string;
  displayReading?: string;
  spokenReading?: string;
  readingSource?: string;
  readingConfidence?: number;
  kr: string;
  jp: string;
  en: string;
};

type SongInfo = {
  title: string;
  artist: string;
  videoId?: string;
  releaseYear?: string;
  duration?: number;
};

type CachedLineReading = Pick<
  LyricLine,
  | "original"
  | "lineNo"
  | "reading"
  | "displayReading"
  | "spokenReading"
  | "readingSource"
  | "readingConfidence"
  | "kr"
  | "jp"
  | "en"
>;

function cachedLineKey(original: string, lineNo: number): string {
  return `${lineNo}\u0000${original}`;
}

function addCachedLineReading(
  target: Map<string, CachedLineReading>,
  line: CachedLineReading
): void {
  const lineNo = line.lineNo ?? -1;
  target.set(cachedLineKey(line.original, lineNo), line);
  if (!target.has(line.original)) target.set(line.original, line);
}

function cachedReadingForLine(
  cached: Map<string, CachedLineReading>,
  line: Pick<LyricLine, "original" | "lineNo">,
  fallbackLineNo: number
): CachedLineReading | undefined {
  return (
    cached.get(cachedLineKey(line.original, line.lineNo ?? fallbackLineNo)) ??
    cached.get(cachedLineKey(line.original, -1)) ??
    cached.get(line.original)
  );
}

function mergeCachedLineReadings(
  local: Map<string, CachedLineReading>,
  backend: Map<string, CachedLineReading>
): Map<string, CachedLineReading> {
  const merged = new Map(backend);

  for (const [key, line] of local) {
    if (!merged.has(key) || line.readingSource === "correction") {
      merged.set(key, line);
    }
  }

  return merged;
}

type PlayerCommand = "play-pause" | "next" | "previous";

type QueuedPlayerCommand = {
  command: PlayerCommand;
  createdAt: number;
};

type LyricsPreparationHold = {
  requestId: number;
  songKey: string;
  expectedVideoId: string;
  resumeWhenReady: boolean;
  resetToStartOnRelease: boolean;
  awaitingMediaTransition: boolean;
  processingComplete: boolean;
  transitionVideo: HTMLVideoElement | null;
  transitionSrc: string;
  transitionGeneration: number;
  confirmedGeneration: number | null;
  transitionSongProgress: SongPlaybackPosition | null;
  confirmedSongProgress: SongPlaybackPosition | null;
  confirmedMediaTimelineStart: number | null;
};

type VerifiedPlaybackCommand = "pause" | "seek-start" | "play";

let lastSongKey: string | null = null;
let lastSongVideoId: string | null = null;
let currentLyrics: LyricLine[] = [];
let currentInstrumentalMarkers: number[] = [];
let currentLineIndex = -1;
let activeLyricsRequestId = 0;
let activeLyricsAbortController: AbortController | null = null;
let settings: LyriKanaSettings = { ...DEFAULT_SETTINGS };
let currentSongLabel = "LyriKana";
let cachedPreciseLineIndexes = new Set<number>();
let songTransitionGuard: SongTransitionGuard | null = null;
let songTransitionVideo: HTMLVideoElement | null = null;
let observedVideo: HTMLVideoElement | null = null;
let observedVideoEvents: AbortController | null = null;
let songObservationTimer: ReturnType<typeof setTimeout> | null = null;
let lastReportedIsPlaying: boolean | null = null;
let lastOverlayStateLogKey = "";
let backendRetryAttempt = 0;
let backendRetryTimer: ReturnType<typeof setTimeout> | null = null;
let contentInitializationStarted = false;
let lyricsPreparationHold: LyricsPreparationHold | null = null;
let currentStatusMessage = "LyriKana loading...";
let activeSongVideo: HTMLVideoElement | null = null;
let activeSongMediaSrc = "";
let mediaLoadGeneration = 0;
let activeSongMediaGeneration = 0;
let activeSongVideoId = "";
let activeSongPlaybackPosition: SongPlaybackPosition | null = null;
let actualPlaybackVideoId = "";
let pagePlaybackPlayerState: number | null = null;
let pagePlaybackBridgeAvailable = false;

const INTRO_TEXT = "♪ 전주 ♪";
const INSTRUMENTAL_TEXT = "♪ 간주 ♪";
const EXPLICIT_INSTRUMENTAL_MIN_GAP_SECONDS = 4;
const INSTRUMENTAL_MIN_GAP_SECONDS = 9;
const READING_CACHE_VERSION = 11;
const READING_ENGINE_TAG = `reading-engine:${READING_CACHE_VERSION}`;
const BACKEND_RETRY_DELAYS_MS = [750, 1500, 3000, 5000];
const LYRICS_LOADING_HOLD_TEXT = "가사 호출 중이라 노래 재생을 멈췄습니다";
const DEBUG_FLOW_LOGS = false;
const PAGE_BRIDGE_SOURCE = "lyrikana-page-playback-bridge";
const CONTENT_BRIDGE_SOURCE = "lyrikana-content-playback-bridge";
const PLAYER_PROGRESS_SELECTOR =
  "ytmusic-player-bar #progress-bar[aria-valuenow][aria-valuemax]";

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

function getPlayerBarPlaybackPosition(): SongPlaybackPosition | null {
  const progress = document.querySelector(PLAYER_PROGRESS_SELECTOR);
  if (!progress) return null;

  return normalizeSongPlaybackPosition(
    Number(progress.getAttribute("aria-valuenow")),
    Number(progress.getAttribute("aria-valuemax"))
  );
}

function getVideoDuration(): number | undefined {
  const songProgress = getPlayerBarPlaybackPosition();
  if (songProgress) return Math.round(songProgress.duration);

  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || !Number.isFinite(player.duration)) return undefined;
  return Math.round(player.duration);
}

function extractVideoIdFromHref(href: string | null): string | undefined {
  if (!href) return undefined;

  try {
    return new URL(href, location.origin).searchParams.get("v") || undefined;
  } catch {
    return undefined;
  }
}

function findSongVideoId(titleElement: Element): string | undefined {
  const links = titleElement.matches("a[href]")
    ? [titleElement, ...titleElement.querySelectorAll("a[href]")]
    : [...titleElement.querySelectorAll("a[href]")];

  for (const link of links) {
    const videoId = extractVideoIdFromHref(link.getAttribute("href"));
    if (videoId) return videoId;
  }

  type NavigationEndpoint = { watchEndpoint?: { videoId?: string } };
  type PlayerTitleData = {
    navigationEndpoint?: NavigationEndpoint;
    runs?: Array<{ navigationEndpoint?: NavigationEndpoint }>;
  };
  const data = (titleElement as Element & { data?: PlayerTitleData }).data;
  const endpoints = [
    data?.navigationEndpoint,
    ...(data?.runs?.map((run) => run.navigationEndpoint) ?? []),
  ];
  return endpoints.find((endpoint) => endpoint?.watchEndpoint?.videoId)
    ?.watchEndpoint?.videoId;
}

function getCurrentPlaybackVideoId(): string {
  return actualPlaybackVideoId;
}

function sendVerifiedPlaybackCommand(
  command: VerifiedPlaybackCommand,
  expectedVideoId: string
): void {
  window.postMessage(
    {
      source: CONTENT_BRIDGE_SOURCE,
      type: "playback-command",
      command,
      expectedVideoId,
    },
    "*"
  );
}

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const message = event.data as
    | {
        source?: string;
        type?: string;
        videoId?: unknown;
        playerState?: unknown;
        available?: unknown;
      }
    | undefined;
  if (
    message?.source !== PAGE_BRIDGE_SOURCE ||
    message.type !== "playback-snapshot"
  ) {
    return;
  }

  const nextVideoId =
    typeof message.videoId === "string" ? message.videoId : "";
  const identityChanged = nextVideoId !== actualPlaybackVideoId;
  actualPlaybackVideoId = nextVideoId;
  pagePlaybackPlayerState =
    typeof message.playerState === "number" ? message.playerState : null;
  pagePlaybackBridgeAvailable = message.available === true;

  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (player && lyricsPreparationHold) enforceLyricsPreparationHold(player);
  if (identityChanged) scheduleSongObservationCheck();
});

function getSongKey(song: SongInfo): string {
  return `${song.title} - ${song.artist}`;
}

function isCurrentSong(song: SongInfo): boolean {
  const songKey = getSongKey(song);
  if (songKey !== lastSongKey) return false;
  if (song.videoId && lastSongVideoId) return song.videoId === lastSongVideoId;
  return true;
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
    videoId: findSongVideoId(titleElement),
    releaseYear: findReleaseYearCandidate(),
    duration: getVideoDuration(),
  };
}

function getHeldSongPlaybackPosition(
  hold: LyricsPreparationHold
): SongPlaybackPosition | null {
  const songProgress = getPlayerBarPlaybackPosition();
  if (!songProgress) return null;

  const song = getSongInfo();
  if (!song || getSongKey(song) !== hold.songKey) return null;

  if (
    hold.confirmedSongProgress &&
    Math.abs(songProgress.duration - hold.confirmedSongProgress.duration) > 1
  ) {
    return null;
  }

  return songProgress;
}

function seekHeldSongToStart(
  player: HTMLVideoElement,
  hold: LyricsPreparationHold
): void {
  const songProgress = getHeldSongPlaybackPosition(hold);
  const mediaTimelineStart =
    hold.confirmedMediaTimelineStart ??
    (songProgress
      ? getMediaTimelineSongStart(player.currentTime, songProgress.currentTime)
      : null);

  sendVerifiedPlaybackCommand("seek-start", hold.expectedVideoId);
  if (
    mediaTimelineStart === null ||
    Math.abs(player.currentTime - mediaTimelineStart) <= 0.05
  ) {
    return;
  }

  try {
    // YouTube Music's gapless MediaSource can expose a cumulative media time.
    // Seek to this song's offset instead of assuming that its raw start is 0.
    player.currentTime = mediaTimelineStart;
  } catch (error) {
    if (DEBUG_FLOW_LOGS) {
      console.warn("[LyriKana] direct held-song seek failed", error);
    }
  }
}

function openLyricsOverlay(): void {
  // Electron companion owns the always-on-top overlay window.
}

function postToElectronOverlay(
  path: "/overlay" | "/settings" | "/playback",
  payload: unknown
): void {
  void postElectronRequest(path, payload);
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

function enforceLyricsPreparationHold(player: HTMLVideoElement): boolean {
  const hold = lyricsPreparationHold;
  if (!hold || hold.requestId !== activeLyricsRequestId) return false;

  if (hold.awaitingMediaTransition) {
    const currentSrc = player.currentSrc || player.src || "";
    const currentVideoId = getCurrentPlaybackVideoId();
    const currentSongProgress = getHeldSongPlaybackPosition(hold);
    const playerWasReplaced = Boolean(
      hold.transitionVideo && player !== hold.transitionVideo
    );
    const mediaTransitioned = isExpectedPlaybackMediaReady({
      expectedVideoId: hold.expectedVideoId,
      currentVideoId,
      generationAdvanced: mediaLoadGeneration > hold.transitionGeneration,
      playerWasReplaced,
      sourceChanged: Boolean(
        hold.transitionSrc && currentSrc && hold.transitionSrc !== currentSrc
      ),
      songProgressTransitioned: hasSongPlaybackProgressTransitioned(
        hold.transitionSongProgress,
        currentSongProgress
      ),
      hasMetadata: player.readyState >= 1,
      ended: player.ended,
    });

    if (!mediaTransitioned) {
      return true;
    }

    hold.awaitingMediaTransition = false;
    hold.confirmedGeneration = mediaLoadGeneration;
    hold.transitionVideo = player;
    hold.transitionSrc = currentSrc;
    hold.confirmedSongProgress = currentSongProgress;
    hold.confirmedMediaTimelineStart = currentSongProgress
      ? getMediaTimelineSongStart(
          player.currentTime,
          currentSongProgress.currentTime
        )
      : null;
    activeSongVideo = player;
    activeSongMediaSrc = currentSrc;
    activeSongMediaGeneration = mediaLoadGeneration;
    activeSongVideoId = currentVideoId;
    activeSongPlaybackPosition = currentSongProgress;

    if (hold.processingComplete) {
      if (!player.paused && !player.ended) hold.resumeWhenReady = true;
      releaseLyricsPreparationHold(hold.requestId);
      return false;
    }
  }

  const heldVideoId = getCurrentPlaybackVideoId();
  const heldSongProgress = getHeldSongPlaybackPosition(hold);
  const confirmedMediaStillMatches = Boolean(
    isConfirmedPlaybackMediaCurrent({
      expectedVideoId: hold.expectedVideoId,
      currentVideoId: heldVideoId,
      confirmedGeneration: hold.confirmedGeneration,
      currentGeneration: mediaLoadGeneration,
      playerMatches: !hold.transitionVideo || player === hold.transitionVideo,
      songProgressMatches: Boolean(heldSongProgress),
    }) &&
      (!hold.expectedVideoId ||
        !activeSongVideoId ||
        hold.expectedVideoId === activeSongVideoId)
  );
  if (!confirmedMediaStillMatches) return true;

  let pausedByHold = false;
  if (!player.paused && !player.ended) {
    hold.resumeWhenReady = true;
    sendVerifiedPlaybackCommand("pause", hold.expectedVideoId);
    player.pause();
    pausedByHold = true;
  }
  if (
    hold.resetToStartOnRelease &&
    !player.ended &&
    !songTransitionGuard &&
    (heldSongProgress?.currentTime ?? player.currentTime) > 0.05
  ) {
    seekHeldSongToStart(player, hold);
  }
  syncPlaybackStateToOverlay(pausedByHold);
  return true;
}

function beginLyricsPreparationHold(
  songKey: string,
  expectedVideoId: string,
  requestId: number,
  awaitingMediaTransition: boolean
): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  const currentSongProgress = getPlayerBarPlaybackPosition();
  const inheritedResumeIntent = lyricsPreparationHold?.resumeWhenReady ?? false;
  lyricsPreparationHold = {
    requestId,
    songKey,
    expectedVideoId,
    resumeWhenReady:
      inheritedResumeIntent || Boolean(player && !player.paused && !player.ended),
    resetToStartOnRelease: false,
    awaitingMediaTransition,
    processingComplete: false,
    transitionVideo: activeSongVideo ?? player,
    transitionSrc:
      activeSongMediaSrc || player?.currentSrc || player?.src || "",
    transitionGeneration: awaitingMediaTransition
      ? activeSongMediaGeneration
      : mediaLoadGeneration,
    confirmedGeneration: awaitingMediaTransition ? null : mediaLoadGeneration,
    transitionSongProgress: awaitingMediaTransition
      ? activeSongPlaybackPosition
      : currentSongProgress,
    confirmedSongProgress: awaitingMediaTransition
      ? null
      : currentSongProgress,
    confirmedMediaTimelineStart:
      !awaitingMediaTransition && player && currentSongProgress
        ? getMediaTimelineSongStart(
            player.currentTime,
            currentSongProgress.currentTime
          )
        : null,
  };

  if (player) {
    if (!awaitingMediaTransition) {
      activeSongVideo = player;
      activeSongMediaSrc = player.currentSrc || player.src || "";
      activeSongMediaGeneration = mediaLoadGeneration;
      activeSongVideoId = expectedVideoId || getCurrentPlaybackVideoId();
      activeSongPlaybackPosition = currentSongProgress;
    }
    enforceLyricsPreparationHold(player);
  }
}

function releaseLyricsPreparationHold(requestId: number): void {
  const hold = lyricsPreparationHold;
  if (!hold || hold.requestId !== requestId) return;

  if (hold.awaitingMediaTransition) {
    hold.processingComplete = true;
    return;
  }

  lyricsPreparationHold = null;
  const player = document.querySelector("video") as HTMLVideoElement | null;
  const currentVideoId = getCurrentPlaybackVideoId();
  const currentSongProgress = getHeldSongPlaybackPosition(hold);
  const playerMatches = Boolean(
    player && (!hold.transitionVideo || player === hold.transitionVideo)
  );
  const mediaStillMatches = isConfirmedPlaybackMediaCurrent({
    expectedVideoId: hold.expectedVideoId,
    currentVideoId,
    confirmedGeneration: hold.confirmedGeneration,
    currentGeneration: mediaLoadGeneration,
    playerMatches,
    songProgressMatches: Boolean(currentSongProgress),
  });
  if (player && mediaStillMatches) releaseSongTransitionGuardIfReady(player);
  const canAlignCurrentSong = Boolean(
    player && mediaStillMatches && !player.ended && !songTransitionGuard
  );
  if (hold.resetToStartOnRelease) currentLineIndex = -1;
  if (hold.resetToStartOnRelease && player && canAlignCurrentSong) {
    seekHeldSongToStart(player, hold);
    songTransitionGuard = null;
    songTransitionVideo = null;
  }
  if (
    hold.resumeWhenReady &&
    requestId === activeLyricsRequestId &&
    mediaStillMatches &&
    player?.paused &&
    !player.ended &&
    !songTransitionGuard
  ) {
    sendVerifiedPlaybackCommand("play", hold.expectedVideoId);
    void player.play().catch((error) => {
      if (DEBUG_FLOW_LOGS) {
        console.warn("[LyriKana] direct held-song resume failed", error);
      }
    });
  }
  syncPlaybackStateToOverlay(true);
}

function updateLyricsPreparationHold(
  response: BackendSongResponse,
  requestId: number
): void {
  if (requestId !== activeLyricsRequestId) return;
  const hold = lyricsPreparationHold;
  const shouldKeepHolding = shouldHoldPlaybackForLyrics(response);
  if (shouldKeepHolding && hold?.requestId === requestId) {
    hold.resetToStartOnRelease = true;
    const player = document.querySelector("video") as HTMLVideoElement | null;
    if (player) enforceLyricsPreparationHold(player);
  }
  if (!shouldKeepHolding) {
    releaseLyricsPreparationHold(requestId);
  }

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] lyrics preparation lookup:", {
      requestId,
      songKey: lyricsPreparationHold?.songKey,
      cacheHit: response.cacheHit,
      status: response.status,
      playbackHeld: lyricsPreparationHold?.requestId === requestId,
    });
  }
}

async function requestElectronJson<T>(
  path: string,
  payload: unknown
): Promise<T | null> {
  return requestElectronData<T>(path, payload);
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

function findPlayPauseButton(): HTMLElement | null {
  return findPlayerControlButton(
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
}

function getPlayPauseButtonAction(
  button: HTMLElement
): "play" | "pause" | "unknown" {
  const label = [button.getAttribute("aria-label"), button.getAttribute("title")]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (label.includes("pause") || label.includes("일시정지")) return "pause";
  if (label.includes("play") || label.includes("재생")) return "play";
  return "unknown";
}

function clickPlayerControl(command: PlayerCommand): void {
  if (command === "play-pause") {
    const button = findPlayPauseButton();

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
  currentStatusMessage = message;
  updateLyricsDisplay(null, null, message);
}

function getPlaybackSnapshot(player: HTMLVideoElement) {
  return {
    currentTime:
      getPlayerBarPlaybackPosition()?.currentTime ?? player.currentTime,
    currentSrc: player.currentSrc || player.src || "",
  };
}

function releaseSongTransitionGuardIfReady(
  player: HTMLVideoElement,
  now = Date.now()
): void {
  if (!songTransitionGuard) return;

  const playerWasReplaced = player !== songTransitionVideo;
  if (
    !playerWasReplaced &&
    !shouldReleaseSongTransitionGuard(
      songTransitionGuard,
      getPlaybackSnapshot(player),
      now
    )
  ) {
    return;
  }

  songTransitionGuard = null;
  songTransitionVideo = null;

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] song transition playback guard released", {
      playerWasReplaced,
    });
  }
}

function resetPlaybackTimeline(reason: string): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (player) {
    releaseSongTransitionGuardIfReady(player);
    if (!songTransitionGuard) {
      songTransitionGuard = createSongTransitionGuard(getPlaybackSnapshot(player));
      songTransitionVideo = songTransitionGuard ? player : null;
    }
  }

  currentLineIndex = -6;
  syncPlaybackStateToOverlay(true);

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] playback timeline reset:", { reason });
  }
}

function bindVideoPlaybackResetEvents(): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || player === observedVideo) return;

  if (observedVideo && player !== observedVideo) mediaLoadGeneration += 1;
  observedVideoEvents?.abort();
  observedVideoEvents = new AbortController();
  observedVideo = player;
  const listenerOptions = { signal: observedVideoEvents.signal };
  const isCurrentPlayer = () => observedVideo === player;

  player.addEventListener("ended", () => {
    if (!isCurrentPlayer()) return;
    resetPlaybackTimeline("video ended");
  }, listenerOptions);

  player.addEventListener("play", () => {
    if (!isCurrentPlayer()) return;
    releaseSongTransitionGuardIfReady(player);
    if (enforceLyricsPreparationHold(player)) return;
    syncPlaybackStateToOverlay(true);
  }, listenerOptions);

  player.addEventListener("pause", () => {
    if (!isCurrentPlayer()) return;
    syncPlaybackStateToOverlay(true);
  }, listenerOptions);

  player.addEventListener("emptied", () => {
    if (!isCurrentPlayer()) return;
    mediaLoadGeneration += 1;
    resetPlaybackTimeline("video emptied");
  }, listenerOptions);

  player.addEventListener("loadstart", () => {
    if (!isCurrentPlayer()) return;
    mediaLoadGeneration += 1;
    resetPlaybackTimeline("video loadstart");
  }, listenerOptions);

  player.addEventListener("loadedmetadata", () => {
    if (!isCurrentPlayer()) return;
    mediaLoadGeneration += 1;
    releaseSongTransitionGuardIfReady(player);
    enforceLyricsPreparationHold(player);
  }, listenerOptions);

  for (const eventName of ["durationchange", "timeupdate"]) {
    player.addEventListener(eventName, () => {
      if (!isCurrentPlayer()) return;
      releaseSongTransitionGuardIfReady(player);
      enforceLyricsPreparationHold(player);
    }, listenerOptions);
  }
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
  if (!player) return 0;

  releaseSongTransitionGuardIfReady(player);
  const songProgress = getPlayerBarPlaybackPosition();
  if (songProgress) {
    const song = getSongInfo();
    if (song && getSongKey(song) === lastSongKey) {
      activeSongPlaybackPosition = songProgress;
    }
  }
  return songTransitionGuard
    ? 0
    : songProgress?.currentTime ?? player.currentTime;
}

function getPlaybackDebugSnapshot() {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  const songProgress = getPlayerBarPlaybackPosition();

  return {
    rawCurrentTime: player?.currentTime ?? null,
    guardedCurrentTime: getCurrentPlaybackTime(),
    rawDuration: player?.duration ?? null,
    songProgress,
    ended: player?.ended ?? null,
    paused: player?.paused ?? null,
    actualPlaybackVideoId,
    pagePlaybackPlayerState,
    pagePlaybackBridgeAvailable,
    songTransitionGuardMs: Math.max(
      0,
      (songTransitionGuard?.expiresAt ?? 0) - Date.now()
    ),
    songTransitionGuardActive: Boolean(songTransitionGuard),
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
    const cached = cachedReadingForLine(cachedByOriginal, line, index);
    if (!cached || !currentLyrics[index]) return;

    currentLyrics[index] = {
      ...currentLyrics[index],
      reading: cached.reading,
      displayReading: cached.displayReading ?? cached.reading,
      spokenReading: cached.spokenReading ?? cached.reading,
      readingSource: cached.readingSource,
      readingConfidence: cached.readingConfidence,
      kr: cached.kr,
      jp: cached.jp,
      en: cached.en,
    };
    cachedPreciseLineIndexes.add(index);
  });

  refreshCurrentLineIfVisible(currentLineIndex);
}

async function getCachedLineReadingsByOriginal(
  lookups: Array<string | { original: string; lineNo?: number }>,
  songId = ""
): Promise<Map<string, CachedLineReading>> {
  const lines = lookups.map((lookup, index) =>
    typeof lookup === "string"
      ? { original: lookup, lineNo: index }
      : { original: lookup.original, lineNo: lookup.lineNo ?? index }
  );
  const result = await requestElectronJson<{
    lines: CachedLineReading[];
  }>("/cache/lines/get", {
    engineVersion: READING_CACHE_VERSION,
    songId,
    lines,
  });

  const cached = new Map<string, CachedLineReading>();
  for (const line of result?.lines ?? []) addCachedLineReading(cached, line);
  return cached;
}

function applyCachedLineReadings(
  lyrics: LyricLine[],
  cachedByOriginal: Map<string, CachedLineReading>
): LyricLine[] {
  return lyrics.map((line) => {
    const cached = cachedReadingForLine(cachedByOriginal, line, line.lineNo ?? -1);
    return cached
      ? {
          ...line,
          reading: cached.reading,
          displayReading: cached.displayReading ?? cached.reading,
          spokenReading: cached.spokenReading ?? cached.reading,
          readingSource: cached.readingSource,
          readingConfidence: cached.readingConfidence,
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
  return lyrics.every((line, index) =>
    Boolean(cachedReadingForLine(cachedByOriginal, line, index))
  );
}

function updateCurrentLyricsFromCache(
  cachedByOriginal: Map<string, CachedLineReading>,
  requestId: number
): void {
  if (requestId !== activeLyricsRequestId || cachedByOriginal.size === 0) return;

  currentLyrics.forEach((line, index) => {
    const cached = cachedReadingForLine(cachedByOriginal, line, index);
    if (!cached) return;

    currentLyrics[index] = {
      ...line,
      reading: cached.reading,
      displayReading: cached.displayReading ?? cached.reading,
      spokenReading: cached.spokenReading ?? cached.reading,
      readingSource: cached.readingSource,
      readingConfidence: cached.readingConfidence,
      kr: cached.kr,
      jp: cached.jp,
      en: cached.en,
    };
    cachedPreciseLineIndexes.add(index);
  });

  refreshCurrentLineIfVisible(currentLineIndex);
}

async function saveLineReadingToCache(
  line: LyricLine,
  songId = "",
  lineNo = line.lineNo ?? -1
): Promise<boolean> {
  const result = await requestElectronJson<{ ok?: boolean }>("/cache/lines/save", {
    engineVersion: READING_CACHE_VERSION,
    songId,
    lineNo,
    line,
  });
  return result !== null;
}

function updateLyricsByTime(): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player) return;

  bindVideoPlaybackResetEvents();
  releaseSongTransitionGuardIfReady(player);
  if (enforceLyricsPreparationHold(player)) return;
  if (currentLyrics.length === 0) return;
  syncPlaybackStateToOverlay();

  const rawCurrentTime = player.currentTime;
  const currentTime = getCurrentPlaybackTime();
  const firstLine = currentLyrics[0];

  if (player.ended) {
    resetPlaybackTimeline("video ended state");
    return;
  }

  if (songTransitionGuard) {
    if (currentLineIndex !== -5) {
      currentLineIndex = -5;
      if (DEBUG_FLOW_LOGS) {
        console.log("[LyriKana] previous-track playback time guarded:", {
          songLabel: currentSongLabel,
          rawCurrentTime,
          currentTime,
          duration: player.duration,
          firstLineTime: firstLine?.time ?? null,
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
  requestId: number,
  songId: string
): Promise<void> {
  const missingIndexes = buildPlaybackPriorityIndices(baseLyrics).filter(
    (index) => !cachedReadingForLine(cachedByOriginal, baseLyrics[index], index)
  );

  if (missingIndexes.length === 0) return;

  const saveTasks: Promise<void>[] = [];

  await enrichLyricsInBackground(baseLyrics, {
    concurrency: 3,
    buildMode: "precise",
    songId,
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
        await saveLineReadingToCache(
          currentLyrics[index],
          songId,
          currentLyrics[index].lineNo ?? index
        );
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
  const cached = new Map<string, CachedLineReading>();
  for (const line of lines) {
    if (!line.reading && !line.kr && !line.jp && !line.en) continue;
    if (!line.userEdit && !line.reasonTags.includes(READING_ENGINE_TAG)) continue;
    addCachedLineReading(cached, {
      original: line.original,
      lineNo: line.lineNo,
      reading: line.reading || "",
      displayReading: line.reading || "",
      spokenReading: line.reading || "",
      readingSource: line.userEdit ? "backend-user" : "backend",
      kr: line.kr || "",
      jp: line.jp || "",
      en: line.en || "",
    });
  }
  return cached;
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
        lineNo: line.lineNo,
        original: line.original,
        reading: line.reading || "",
        displayReading: line.reading || "",
        spokenReading: line.reading || "",
        readingSource: "backend",
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
      .map((line, index) =>
        cachedReadingForLine(cachedByOriginal, line, index) ? index : -1
      )
      .filter((index) => index >= 0)
  );
  currentLineIndex = -1;
  currentStatusMessage = "";
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
        userEdit:
          line.readingSource === "correction" ||
          line.readingSource === "backend-user",
        reasonTags: [READING_ENGINE_TAG],
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

function clearBackendRetryTimer(): void {
  if (backendRetryTimer !== null) {
    clearTimeout(backendRetryTimer);
    backendRetryTimer = null;
  }
}

function scheduleBackendRetry(songKey: string, requestId: number): void {
  if (
    requestId !== activeLyricsRequestId ||
    backendRetryAttempt >= BACKEND_RETRY_DELAYS_MS.length
  ) {
    return;
  }

  const delayMs = BACKEND_RETRY_DELAYS_MS[backendRetryAttempt];
  backendRetryAttempt += 1;
  clearBackendRetryTimer();
  backendRetryTimer = setTimeout(() => {
    backendRetryTimer = null;
    const currentSong = getSongInfo();
    if (!currentSong) return;
    if (`${currentSong.title} - ${currentSong.artist}` !== songKey) return;

    lastSongKey = null;
    void handleSongChange(true);
  }, delayMs);
}

function lyricsFailureMessage(error: string | null): string {
  if (error === "lyrics_not_found") return "Lyrics not found";
  if (error === "lyrics_empty") return "Lyrics data is empty";
  if (
    error === "provider_timeout" ||
    error === "provider_error:ReadTimeout" ||
    error === "provider_error:ConnectTimeout"
  ) {
    return "Lyrics provider timed out";
  }
  if (
    error === "provider_unavailable" ||
    error === "provider_error:ConnectError"
  ) {
    return "Lyrics provider unavailable";
  }
  if (error === "provider_http_429") return "Lyrics provider rate limited";
  if (error?.startsWith("provider_http_")) {
    return `Lyrics provider error (${error.slice("provider_http_".length)})`;
  }
  return error ? `Lyrics error (${error})` : "Lyrics error";
}

function lyricsRequestErrorMessage(error: unknown): string {
  if (!(error instanceof BackendRequestError)) return "Lyrics processing error";
  if (error.message === "backend_unavailable") return "Backend unavailable";
  if (error.message === "lyrics_processing_timeout") {
    return "Lyrics processing timed out";
  }
  return `Lyrics request error (${error.message})`;
}

async function fetchLyrics(
  songInfo: SongInfo,
  songKey: string,
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
      signal,
      (initialResponse) =>
        updateLyricsPreparationHold(initialResponse, requestId)
    );

    if (requestId !== activeLyricsRequestId) return;
    backendRetryAttempt = 0;
    clearBackendRetryTimer();

    if (response.status === "failed") {
      resetLyrics(lyricsFailureMessage(response.error));
      return;
    }

    if (response.lyrics.length === 0 || !response.rawLrc) {
      resetLyrics("Lyrics are still processing");
      return;
    }

    const backendCachedLines = backendReadingsByOriginal(response.lyrics);
    const localCachedLines = await getCachedLineReadingsByOriginal(
      response.lyrics.map((line) => ({
        original: line.original,
        lineNo: line.lineNo,
      })),
      response.song.id
    );
    const cachedLines = mergeCachedLineReadings(
      localCachedLines,
      backendCachedLines
    );

    if (requestId !== activeLyricsRequestId) return;
    if (!loadCurrentLyricsFromBackend(response, cachedLines)) return;

    const baseLyrics = response.lyrics
      .filter((line): line is BackendLyricLine & { time: number } => line.time !== null)
      .sort((first, second) => first.lineNo - second.lineNo)
      .map((line) => ({
        time: line.time,
        lineNo: line.lineNo,
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

    await analyzeAndSaveMissingLineReadings(
      baseLyrics,
      cachedLines,
      requestId,
      response.song.id
    );
    if (requestId !== activeLyricsRequestId) return;

    const refreshedLocalLines = await getCachedLineReadingsByOriginal(
      baseLyrics.map((line) => ({
        original: line.original,
        lineNo: line.lineNo,
      })),
      response.song.id
    );
    const refreshedLines = mergeCachedLineReadings(
      refreshedLocalLines,
      backendCachedLines
    );

    updateCurrentLyricsFromCache(refreshedLines, requestId);
    await persistCurrentLyrics(response.song.id, requestId, signal);
  } catch (error) {
    if (requestId !== activeLyricsRequestId) return;
    if (error instanceof DOMException && error.name === "AbortError") return;

    if (DEBUG_FLOW_LOGS) {
      console.error("[LyriKana] fetchLyrics error:", error);
    }

    const backendUnavailable =
      error instanceof BackendRequestError && error.message === "backend_unavailable";
    resetLyrics(lyricsRequestErrorMessage(error));
    if (backendUnavailable) scheduleBackendRetry(songKey, requestId);
  }
}

async function handleSongChange(
  isBackendRetry = false,
  observedSong?: SongInfo
): Promise<void> {
  const song = observedSong ?? getSongInfo();
  if (!song) return;

  const songKey = getSongKey(song);
  if (!isBackendRetry && isCurrentSong(song)) {
    if (!lastSongVideoId && song.videoId) {
      lastSongVideoId = song.videoId;
      if (
        lyricsPreparationHold?.songKey === songKey &&
        !lyricsPreparationHold.expectedVideoId
      ) {
        lyricsPreparationHold.expectedVideoId = song.videoId;
      }
    }
    return;
  }
  const previousSongKey = lastSongKey;

  if (!isBackendRetry) {
    backendRetryAttempt = 0;
    clearBackendRetryTimer();
  }

  if (DEBUG_FLOW_LOGS) {
    console.log("[LyriKana] song change detected:", {
      song,
      songKey,
      previousSongKey: lastSongKey,
      playback: getPlaybackDebugSnapshot(),
    });
  }

  lastSongKey = songKey;
  if (!isBackendRetry || song.videoId) lastSongVideoId = song.videoId ?? null;
  currentSongLabel = songKey;
  activeLyricsAbortController?.abort();
  activeLyricsAbortController = new AbortController();
  activeLyricsRequestId += 1;
  if (!isBackendRetry && previousSongKey !== null) {
    resetPlaybackTimeline("song metadata changed");
  }
  const requestId = activeLyricsRequestId;
  if (!isBackendRetry) {
    beginLyricsPreparationHold(
      songKey,
      song.videoId ?? "",
      requestId,
      previousSongKey !== null
    );
  }

  resetLyrics(LYRICS_LOADING_HOLD_TEXT);
  try {
    await fetchLyrics(song, songKey, requestId, activeLyricsAbortController.signal);
  } finally {
    releaseLyricsPreparationHold(requestId);
  }
}

function checkForObservedSongChange(): void {
  bindVideoPlaybackResetEvents();
  const song = getSongInfo();
  if (!song) return;

  const songKey = getSongKey(song);
  if (isCurrentSong(song)) {
    if (!lastSongVideoId && song.videoId) {
      lastSongVideoId = song.videoId;
      if (
        lyricsPreparationHold?.songKey === songKey &&
        !lyricsPreparationHold.expectedVideoId
      ) {
        lyricsPreparationHold.expectedVideoId = song.videoId;
      }
    }
    return;
  }

  void handleSongChange(false, song);
}

function scheduleSongObservationCheck(): void {
  if (songObservationTimer !== null) return;
  songObservationTimer = setTimeout(() => {
    songObservationTimer = null;
    checkForObservedSongChange();
  }, 75);
}

function mutationTouchesPlayerBar(mutation: MutationRecord): boolean {
  const target =
    mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
  if (target?.closest("ytmusic-player-bar")) return true;

  return [...mutation.addedNodes, ...mutation.removedNodes].some((node) =>
    node instanceof Element
      ? node.matches("ytmusic-player-bar") ||
        Boolean(node.querySelector("ytmusic-player-bar"))
      : false
  );
}

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    if (mutations.some(mutationTouchesPlayerBar)) scheduleSongObservationCheck();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  setInterval(checkForObservedSongChange, 250);
  scheduleSongObservationCheck();

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
      updateLyricsDisplay(null, null, currentStatusMessage);
    }
  }
});

async function initializeContentScript(): Promise<void> {
  if (contentInitializationStarted) return;
  contentInitializationStarted = true;

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

  try {
    const result = (await chrome.runtime.sendMessage({
      type: "LYRIKANA_ENSURE_ELECTRON",
    })) as { ready?: boolean } | undefined;
    if (result?.ready) {
      postToElectronOverlay("/settings", settings);
    }
  } catch {
    // In-page lyrics can still use a backend that was started independently.
  }

  startObserver();
  await handleSongChange();
  bindVideoPlaybackResetEvents();
  syncPlaybackStateToOverlay(true);
  setInterval(() => {
    void pollPlayerCommands();
  }, 400);
  setInterval(updateLyricsByTime, 200);
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", () => void initializeContentScript(), {
    once: true,
  });
} else {
  void initializeContentScript();
}
