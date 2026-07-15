import { describe, expect, it } from "vitest";

import { shouldHoldPlaybackForLyrics } from "./lyricsPreparation";

describe("lyrics preparation playback hold", () => {
  it("holds a DB miss while the first lyric processing job is incomplete", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "processing", cacheHit: false })
    ).toBe(true);
  });

  it("releases an existing fully processed DB song immediately", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "completed", cacheHit: true })
    ).toBe(false);
    expect(
      shouldHoldPlaybackForLyrics({ status: "partial", cacheHit: true })
    ).toBe(false);
  });

  it("holds an existing DB row when its lyrics are still incomplete", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "fetching", cacheHit: true })
    ).toBe(true);
  });

  it("does not leave playback permanently locked after a terminal failure", () => {
    expect(
      shouldHoldPlaybackForLyrics({ status: "failed", cacheHit: false })
    ).toBe(false);
  });
});
