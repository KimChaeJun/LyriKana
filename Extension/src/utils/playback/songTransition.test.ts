import { describe, expect, it } from "vitest";

import {
  SONG_TRANSITION_GUARD_MS,
  createSongTransitionGuard,
  getMediaTimelineSongStart,
  hasPlaybackMediaTransitioned,
  hasSongPlaybackProgressTransitioned,
  isConfirmedPlaybackMediaCurrent,
  isExpectedPlaybackMediaReady,
  normalizeSongPlaybackPosition,
  shouldReleaseSongTransitionGuard,
} from "./songTransition";

describe("song transition playback guard", () => {
  it("does not guard a player that has already reset to the new track", () => {
    expect(
      createSongTransitionGuard(
        { currentTime: 0.4, currentSrc: "blob:new-track" },
        1000
      )
    ).toBeNull();
  });

  it("keeps an old-track timestamp only while the media has not changed", () => {
    const guard = createSongTransitionGuard(
      { currentTime: 184, currentSrc: "blob:old-track" },
      1000
    );

    expect(guard).not.toBeNull();
    expect(
      shouldReleaseSongTransitionGuard(
        guard!,
        { currentTime: 185, currentSrc: "blob:old-track" },
        2000
      )
    ).toBe(false);
  });

  it("releases as soon as the source, player time, or timeout proves a transition", () => {
    const guard = createSongTransitionGuard(
      { currentTime: 184, currentSrc: "blob:old-track" },
      1000
    )!;

    expect(
      shouldReleaseSongTransitionGuard(
        guard,
        { currentTime: 184, currentSrc: "blob:new-track" },
        1200
      )
    ).toBe(true);
    expect(
      shouldReleaseSongTransitionGuard(
        guard,
        { currentTime: 0, currentSrc: "blob:old-track" },
        1200
      )
    ).toBe(true);
    expect(
      shouldReleaseSongTransitionGuard(
        guard,
        { currentTime: 184, currentSrc: "blob:old-track" },
        1000 + SONG_TRANSITION_GUARD_MS
      )
    ).toBe(true);
  });

  it("does not treat unchanged previous-track media as the next track", () => {
    expect(
      hasPlaybackMediaTransitioned(
        { currentTime: 179, currentSrc: "blob:previous" },
        { currentTime: 179.2, currentSrc: "blob:previous" }
      )
    ).toBe(false);
  });

  it("recognizes the next media by source, time reset, or video replacement", () => {
    const previous = { currentTime: 179, currentSrc: "blob:previous" };

    expect(
      hasPlaybackMediaTransitioned(previous, {
        currentTime: 0,
        currentSrc: "blob:next",
      })
    ).toBe(true);
    expect(
      hasPlaybackMediaTransitioned(previous, {
        currentTime: 0,
        currentSrc: "blob:previous",
      })
    ).toBe(true);
    expect(
      hasPlaybackMediaTransitioned(
        previous,
        { currentTime: 179, currentSrc: "blob:previous" },
        { playerWasReplaced: true }
      )
    ).toBe(true);
  });

  it("does not accept the emptied 0-second state as ready next-track media", () => {
    expect(
      isExpectedPlaybackMediaReady({
        expectedVideoId: "next",
        currentVideoId: "next",
        generationAdvanced: true,
        playerWasReplaced: false,
        sourceChanged: false,
        songProgressTransitioned: false,
        hasMetadata: false,
        ended: false,
      })
    ).toBe(false);
  });

  it("requires the loaded playback video id to match the expected next track", () => {
    expect(
      isExpectedPlaybackMediaReady({
        expectedVideoId: "next",
        currentVideoId: "previous",
        generationAdvanced: true,
        playerWasReplaced: false,
        sourceChanged: true,
        songProgressTransitioned: false,
        hasMetadata: true,
        ended: false,
      })
    ).toBe(false);
  });

  it("does not accept URL or UI metadata without an actual player video id", () => {
    expect(
      isExpectedPlaybackMediaReady({
        expectedVideoId: "next",
        currentVideoId: "",
        generationAdvanced: true,
        playerWasReplaced: false,
        sourceChanged: true,
        songProgressTransitioned: false,
        hasMetadata: true,
        ended: false,
      })
    ).toBe(false);
  });

  it("accepts loaded next-track media after a real load generation change", () => {
    expect(
      isExpectedPlaybackMediaReady({
        expectedVideoId: "next",
        currentVideoId: "next",
        generationAdvanced: true,
        playerWasReplaced: false,
        sourceChanged: false,
        songProgressTransitioned: false,
        hasMetadata: true,
        ended: false,
      })
    ).toBe(true);
  });

  it("does not release a completed hold onto a newer media generation", () => {
    expect(
      isConfirmedPlaybackMediaCurrent({
        expectedVideoId: "requested",
        currentVideoId: "newer-track",
        confirmedGeneration: 4,
        currentGeneration: 5,
        playerMatches: true,
        songProgressMatches: false,
      })
    ).toBe(false);
  });

  it("releases only while the confirmed player, generation, and video still match", () => {
    expect(
      isConfirmedPlaybackMediaCurrent({
        expectedVideoId: "requested",
        currentVideoId: "requested",
        confirmedGeneration: 4,
        currentGeneration: 4,
        playerMatches: true,
        songProgressMatches: false,
      })
    ).toBe(true);
    expect(
      isConfirmedPlaybackMediaCurrent({
        expectedVideoId: "requested",
        currentVideoId: "requested",
        confirmedGeneration: 4,
        currentGeneration: 4,
        playerMatches: false,
        songProgressMatches: false,
      })
    ).toBe(false);
    expect(
      isConfirmedPlaybackMediaCurrent({
        expectedVideoId: "requested",
        currentVideoId: "",
        confirmedGeneration: 4,
        currentGeneration: 4,
        playerMatches: true,
        songProgressMatches: false,
      })
    ).toBe(false);
  });

  it("recognizes a gapless next track from song-local progress", () => {
    const previous = normalizeSongPlaybackPosition(219, 220);
    const current = normalizeSongPlaybackPosition(0, 202);

    expect(hasSongPlaybackProgressTransitioned(previous, current)).toBe(true);
    expect(
      isExpectedPlaybackMediaReady({
        expectedVideoId: "next",
        currentVideoId: "",
        generationAdvanced: false,
        playerWasReplaced: false,
        sourceChanged: false,
        songProgressTransitioned: true,
        hasMetadata: true,
        ended: false,
      })
    ).toBe(true);
  });

  it("keeps a confirmed gapless track current using its player-bar identity", () => {
    expect(
      isConfirmedPlaybackMediaCurrent({
        expectedVideoId: "requested",
        currentVideoId: "",
        confirmedGeneration: 4,
        currentGeneration: 4,
        playerMatches: true,
        songProgressMatches: true,
      })
    ).toBe(true);
  });

  it("maps cumulative media time back to the current song start", () => {
    expect(getMediaTimelineSongStart(701.826, 0)).toBeCloseTo(701.826);
    expect(getMediaTimelineSongStart(726.472, 25)).toBeCloseTo(701.472);
  });
});
