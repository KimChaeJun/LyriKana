import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BackendRequestError,
  createSongKey,
  resolveLyrics,
  saveConvertedLyrics,
  type BackendSongResponse,
} from "./backend";

const processingResponse: BackendSongResponse = {
  song: {
    id: "song-1",
    title: "Song",
    artist: "Artist",
    album: null,
    duration: 180,
    source: "lrclib",
  },
  status: "processing",
  progress: { total: 1, completed: 0, failed: 0 },
  lyrics: [
    {
      lineNo: 0,
      time: 1.25,
      original: "日本語",
      reading: null,
      kr: null,
      jp: null,
      en: null,
      userEdit: false,
      reasonTags: [],
    },
  ],
  rawLrc: "[00:01.25]日本語",
  error: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("backend API client", () => {
  it("creates a stable normalized song key", () => {
    expect(createSongKey("  ＳＯＮＧ  ", "ARTIST")).toBe(
      createSongKey("song", "artist")
    );
  });

  it("posts song metadata and returns prepared lyrics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(processingResponse), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLyrics({
      title: "Song",
      artist: "Artist",
      duration: 180,
      playbackTime: 12.5,
    });

    expect(result.status).toBe("processing");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toMatchObject({
      title: "Song",
      duration: 180,
      playbackTime: 12.5,
    });
  });

  it("persists line conversions with the versioned endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...processingResponse,
          status: "completed",
          progress: { total: 1, completed: 1, failed: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await saveConvertedLyrics("song-1", [
      { lineNo: 0, reading: "にほんご", kr: "니혼고", jp: "nihongo", en: "" },
    ]);

    expect(fetchMock.mock.calls[0][0]).toContain("/api/v1/songs/song-1/lyrics");
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).lyrics[0].lineNo).toBe(0);
  });

  it("distinguishes an unavailable backend from missing lyrics", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(resolveLyrics({ title: "Song" })).rejects.toEqual(
      expect.objectContaining<Partial<BackendRequestError>>({
        name: "BackendRequestError",
        message: "backend_unavailable",
      })
    );
  });
});
