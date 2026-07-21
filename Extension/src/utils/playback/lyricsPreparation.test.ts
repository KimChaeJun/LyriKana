import { describe, expect, it } from "vitest";

import { shouldHoldPlaybackForLyrics } from "./lyricsPreparation";

describe("lyrics preparation playback hold", () => {
  it("keeps playing on a DB miss while the first lyric job runs", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "processing", cacheHit: false })
    ).toBe(false);
  });

  it("releases an existing fully processed DB song immediately", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "completed", cacheHit: true })
    ).toBe(false);
    expect(
      shouldHoldPlaybackForLyrics({ status: "partial", cacheHit: true })
    ).toBe(false);
  });

  it("keeps playing when an existing DB row is still incomplete", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "fetching", cacheHit: true })
    ).toBe(false);
  });

  it("does not leave playback permanently locked after a terminal failure", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "failed", cacheHit: false })
    ).toBe(false);
  });
});
