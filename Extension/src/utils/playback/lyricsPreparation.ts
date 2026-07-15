import type { BackendSongResponse } from "../../api/backend";

const TERMINAL_LYRICS_STATUSES = new Set(["completed", "partial", "failed"]);

export function shouldHoldPlaybackForLyrics(
  response: Pick<BackendSongResponse, "status" | "cacheHit">
): boolean {
  return !TERMINAL_LYRICS_STATUSES.has(response.status);
}
