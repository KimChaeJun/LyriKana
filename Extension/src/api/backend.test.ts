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
  cacheHit: false,
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
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      payload: processingResponse,
    });
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage },
    });

    const result = await resolveLyrics({
      title: "Song",
      artist: "Artist",
      duration: 180,
      playbackTime: 12.5,
    });

    expect(result.status).toBe("processing");
    expect(result.cacheHit).toBe(false);
    const message = sendMessage.mock.calls[0][0];
    expect(message.method).toBe("POST");
    expect(JSON.parse(String(message.body))).toMatchObject({
      title: "Song",
      duration: 180,
      playbackTime: 12.5,
    });
  });

  it("routes backend requests through the extension service worker", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
        ...processingResponse,
        status: "completed",
        progress: { total: 1, completed: 1, failed: 0 },
      },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage },
    });

    const result = await resolveLyrics({ title: "Song", artist: "Artist" });

    expect(result.status).toBe("completed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "LYRIKANA_BACKEND_REQUEST",
        path: "/api/v1/songs/resolve",
        method: "POST",
        headers: { "content-type": "application/json" },
      })
    );
  });

  it("reports the first DB lookup result and preserves a cache miss while polling", async () => {
    const initialResolve = vi.fn();
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(
        {
          ok: true,
          status: 202,
          payload: {
            ...processingResponse,
            status: "pending",
            lyrics: [],
            rawLrc: null,
            cacheHit: false,
          },
        }
      )
      .mockResolvedValueOnce(
        {
          ok: true,
          status: 200,
          payload: {
            ...processingResponse,
            cacheHit: true,
          },
        }
      );
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage },
    });

    const result = await resolveLyrics(
      { title: "First play", artist: "Artist" },
      undefined,
      initialResolve
    );

    expect(initialResolve).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", cacheHit: false })
    );
    expect(result).toMatchObject({ status: "processing", cacheHit: false });
  });

  it("persists line conversions with the versioned endpoint", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: {
          ...processingResponse,
          status: "completed",
          progress: { total: 1, completed: 1, failed: 0 },
      },
    });
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage },
    });

    await saveConvertedLyrics("song-1", [
      { lineNo: 0, reading: "にほんご", kr: "니혼고", jp: "nihongo", en: "" },
    ]);

    const message = sendMessage.mock.calls[0][0];
    expect(message.path).toBe("/api/v1/songs/song-1/lyrics");
    expect(JSON.parse(String(message.body)).lyrics[0].lineNo).toBe(0);
  });

  it("distinguishes an unavailable backend from missing lyrics", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn().mockRejectedValue(new TypeError("offline")),
      },
    });

    await expect(resolveLyrics({ title: "Song" })).rejects.toEqual(
      expect.objectContaining<Partial<BackendRequestError>>({
        name: "BackendRequestError",
        message: "backend_unavailable",
      })
    );
  });
});
