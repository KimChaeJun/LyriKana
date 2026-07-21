import type { BackendSongResponse } from "../../api/backend";

export function shouldHoldPlaybackForLyrics(
  _response: Pick<BackendSongResponse, "status" | "cacheHit">
): boolean {
  // Lyrics are generated and cached in the background. Playback must never be
  // coupled to provider or analysis latency, including the first DB miss.
  return false;
}
