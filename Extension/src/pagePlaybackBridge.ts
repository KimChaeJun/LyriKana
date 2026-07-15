type YouTubePlayerApi = {
  getVideoData?: () => { video_id?: string; videoId?: string } | null;
  getPlayerResponse?: () => {
    videoDetails?: { videoId?: string };
  } | null;
  getPlayerState?: () => number;
  pauseVideo?: () => void;
  playVideo?: () => void;
  seekTo?: (seconds: number, allowSeekAhead?: boolean) => void;
};

type PlaybackCommand = "pause" | "seek-start" | "play";

const PAGE_BRIDGE_SOURCE = "lyrikana-page-playback-bridge";
const CONTENT_BRIDGE_SOURCE = "lyrikana-content-playback-bridge";
const HEARTBEAT_MS = 500;

function isPlayerApi(value: unknown): value is YouTubePlayerApi {
  if (!value || typeof value !== "object") return false;
  const candidate = value as YouTubePlayerApi;
  return Boolean(candidate.getVideoData || candidate.getPlayerResponse);
}

function findYouTubePlayerApi(): YouTubePlayerApi | null {
  type PlayerHost = Element & {
    playerApi?: unknown;
    playerApi_?: unknown;
    player_?: unknown;
  };
  const hosts = [
    document.getElementById("movie_player"),
    document.querySelector("ytmusic-player #movie_player"),
    document.querySelector("ytmusic-player"),
  ].filter((value): value is PlayerHost => Boolean(value));

  for (const host of hosts) {
    const candidates: unknown[] = [
      host,
      host.playerApi,
      host.playerApi_,
      host.player_,
    ];
    const api = candidates.find(isPlayerApi);
    if (api) return api;
  }

  return null;
}

function readActualVideoId(playerApi: YouTubePlayerApi | null): string {
  if (!playerApi) return "";

  try {
    const videoData = playerApi.getVideoData?.();
    const videoId = videoData?.video_id || videoData?.videoId;
    if (videoId) return videoId;
  } catch {
    // The player can replace its API object while navigating to the next song.
  }

  try {
    return playerApi.getPlayerResponse?.()?.videoDetails?.videoId ?? "";
  } catch {
    return "";
  }
}

let lastSnapshotKey = "";
let lastPublishedAt = 0;

function publishPlaybackSnapshot(force = false): void {
  const playerApi = findYouTubePlayerApi();
  const videoId = readActualVideoId(playerApi);
  let playerState: number | null = null;
  try {
    playerState = playerApi?.getPlayerState?.() ?? null;
  } catch {
    // A missing state does not invalidate an otherwise usable video id.
  }

  const snapshotKey = `${videoId}\u0000${playerState ?? ""}\u0000${Boolean(playerApi)}`;
  const now = Date.now();
  if (!force && snapshotKey === lastSnapshotKey && now - lastPublishedAt < HEARTBEAT_MS) {
    return;
  }

  lastSnapshotKey = snapshotKey;
  lastPublishedAt = now;
  window.postMessage(
    {
      source: PAGE_BRIDGE_SOURCE,
      type: "playback-snapshot",
      videoId,
      playerState,
      available: Boolean(playerApi),
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
        command?: PlaybackCommand;
        expectedVideoId?: string;
      }
    | undefined;
  if (
    message?.source !== CONTENT_BRIDGE_SOURCE ||
    message.type !== "playback-command" ||
    !message.command
  ) {
    return;
  }

  const playerApi = findYouTubePlayerApi();
  const actualVideoId = readActualVideoId(playerApi);
  if (
    !playerApi ||
    (message.expectedVideoId && message.expectedVideoId !== actualVideoId)
  ) {
    publishPlaybackSnapshot(true);
    return;
  }

  try {
    if (message.command === "pause") playerApi.pauseVideo?.();
    if (message.command === "seek-start") playerApi.seekTo?.(0, true);
    if (message.command === "play") playerApi.playVideo?.();
  } finally {
    publishPlaybackSnapshot(true);
  }
});

window.addEventListener("yt-navigate-finish", () => publishPlaybackSnapshot(true));
setInterval(publishPlaybackSnapshot, 100);
publishPlaybackSnapshot(true);
