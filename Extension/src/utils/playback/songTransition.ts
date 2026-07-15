export type PlaybackSnapshot = {
  currentTime: number;
  currentSrc: string;
};

export type SongPlaybackPosition = {
  currentTime: number;
  duration: number;
};

export type SongTransitionGuard = {
  initialTime: number;
  initialSrc: string;
  expiresAt: number;
};

export type MediaTransitionOptions = {
  playerWasReplaced?: boolean;
  allowFreshMediaFallback?: boolean;
};

export type PlaybackMediaReadiness = {
  expectedVideoId: string;
  currentVideoId: string;
  generationAdvanced: boolean;
  playerWasReplaced: boolean;
  sourceChanged: boolean;
  songProgressTransitioned: boolean;
  hasMetadata: boolean;
  ended: boolean;
};

export type PlaybackMediaConfirmation = {
  expectedVideoId: string;
  currentVideoId: string;
  confirmedGeneration: number | null;
  currentGeneration: number;
  playerMatches: boolean;
  songProgressMatches: boolean;
};

export const SONG_TRANSITION_GUARD_MS = 3000;
const STALE_TIME_MIN_SECONDS = 2;
const RESET_TIME_DELTA_SECONDS = 0.75;
const FRESH_SONG_PROGRESS_MAX_SECONDS = 2.5;
const DURATION_CHANGE_MIN_SECONDS = 0.5;

function normalizedTime(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function normalizeSongPlaybackPosition(
  currentTime: number,
  duration: number
): SongPlaybackPosition | null {
  if (
    !Number.isFinite(currentTime) ||
    !Number.isFinite(duration) ||
    currentTime < 0 ||
    duration <= 0
  ) {
    return null;
  }

  return {
    currentTime: Math.min(currentTime, duration),
    duration,
  };
}

export function hasSongPlaybackProgressTransitioned(
  previous: SongPlaybackPosition | null,
  current: SongPlaybackPosition | null
): boolean {
  if (!current) return false;

  // YouTube Music can keep one MediaSource-backed <video> alive across songs.
  // In that mode only the player-bar progress resets to a fresh per-song value.
  if (current.currentTime <= FRESH_SONG_PROGRESS_MAX_SECONDS) return true;
  if (!previous) return false;
  if (current.currentTime + RESET_TIME_DELTA_SECONDS < previous.currentTime) {
    return true;
  }

  return (
    Math.abs(current.duration - previous.duration) >=
    DURATION_CHANGE_MIN_SECONDS
  );
}

export function getMediaTimelineSongStart(
  mediaCurrentTime: number,
  songCurrentTime: number
): number | null {
  if (
    !Number.isFinite(mediaCurrentTime) ||
    !Number.isFinite(songCurrentTime) ||
    mediaCurrentTime < 0 ||
    songCurrentTime < 0
  ) {
    return null;
  }

  return Math.max(0, mediaCurrentTime - songCurrentTime);
}

export function hasPlaybackMediaTransitioned(
  previous: PlaybackSnapshot,
  current: PlaybackSnapshot,
  options: MediaTransitionOptions = {}
): boolean {
  if (options.playerWasReplaced) return true;
  if (previous.currentSrc && current.currentSrc !== previous.currentSrc) return true;
  if (normalizedTime(current.currentTime) + RESET_TIME_DELTA_SECONDS < previous.currentTime) {
    return true;
  }

  return Boolean(
    options.allowFreshMediaFallback &&
      !previous.currentSrc &&
      normalizedTime(current.currentTime) <= STALE_TIME_MIN_SECONDS
  );
}

export function isExpectedPlaybackMediaReady(
  evidence: PlaybackMediaReadiness
): boolean {
  if (!evidence.hasMetadata || evidence.ended) return false;
  if (
    evidence.expectedVideoId &&
    evidence.currentVideoId &&
    evidence.expectedVideoId !== evidence.currentVideoId
  ) {
    return false;
  }
  if (
    evidence.expectedVideoId &&
    !evidence.currentVideoId &&
    !evidence.songProgressTransitioned
  ) {
    return false;
  }

  return (
    evidence.generationAdvanced ||
    evidence.playerWasReplaced ||
    evidence.sourceChanged ||
    evidence.songProgressTransitioned
  );
}

export function isConfirmedPlaybackMediaCurrent(
  confirmation: PlaybackMediaConfirmation
): boolean {
  if (!confirmation.playerMatches) return false;
  if (
    confirmation.confirmedGeneration === null ||
    confirmation.confirmedGeneration !== confirmation.currentGeneration
  ) {
    return false;
  }
  if (
    confirmation.expectedVideoId &&
    confirmation.currentVideoId &&
    confirmation.expectedVideoId !== confirmation.currentVideoId
  ) {
    return false;
  }
  if (
    confirmation.expectedVideoId &&
    !confirmation.currentVideoId &&
    !confirmation.songProgressMatches
  ) {
    return false;
  }

  return true;
}

export function createSongTransitionGuard(
  snapshot: PlaybackSnapshot,
  now = Date.now()
): SongTransitionGuard | null {
  const currentTime = normalizedTime(snapshot.currentTime);
  if (currentTime <= STALE_TIME_MIN_SECONDS) return null;

  return {
    initialTime: currentTime,
    initialSrc: snapshot.currentSrc,
    expiresAt: now + SONG_TRANSITION_GUARD_MS,
  };
}

export function shouldReleaseSongTransitionGuard(
  guard: SongTransitionGuard,
  snapshot: PlaybackSnapshot,
  now = Date.now()
): boolean {
  const currentTime = normalizedTime(snapshot.currentTime);

  if (now >= guard.expiresAt) return true;
  if (currentTime <= STALE_TIME_MIN_SECONDS) return true;
  if (currentTime + RESET_TIME_DELTA_SECONDS < guard.initialTime) return true;

  return Boolean(
    guard.initialSrc &&
      snapshot.currentSrc &&
      guard.initialSrc !== snapshot.currentSrc
  );
}
