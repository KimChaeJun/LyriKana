import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


type RuntimeListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
) => boolean | undefined;

let runtimeListener: RuntimeListener;
let sendNativeMessage: ReturnType<typeof vi.fn>;
let tabsQuery: ReturnType<typeof vi.fn>;
let tabRemovedListener: () => void;


beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  sendNativeMessage = vi.fn();
  tabsQuery = vi.fn().mockResolvedValue([]);

  vi.stubGlobal("chrome", {
    runtime: {
      id: "test-extension",
      lastError: undefined,
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      sendNativeMessage,
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListener = listener;
        }),
      },
      onStartup: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
    },
    windows: {
      create: vi.fn(),
      get: vi.fn(),
      onRemoved: { addListener: vi.fn() },
    },
    tabs: {
      query: tabsQuery,
      onCreated: { addListener: vi.fn() },
      onRemoved: {
        addListener: vi.fn((listener: () => void) => {
          tabRemovedListener = listener;
        }),
      },
      onUpdated: { addListener: vi.fn() },
    },
  });
});


afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});


async function requestElectronLaunch(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const keepChannelOpen = runtimeListener(
      { type: "LYRIKANA_ENSURE_ELECTRON" },
      {} as chrome.runtime.MessageSender,
      (response) => resolve(response as Record<string, unknown>)
    );
    expect(keepChannelOpen).toBe(true);
  });
}

async function requestBackendRelay(
  message: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const keepChannelOpen = runtimeListener(
      message,
      {} as chrome.runtime.MessageSender,
      (response) => resolve(response as Record<string, unknown>)
    );
    expect(keepChannelOpen).toBe(true);
  });
}


describe("Backend local-network relay", () => {
  it("fetches lyrics from the extension service worker origin", async () => {
    const payload = { status: "completed", song: { id: "song-1" } };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await import("./background");

    const response = await requestBackendRelay({
      type: "LYRIKANA_BACKEND_REQUEST",
      path: "/api/v1/songs/resolve",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Song" }),
    });

    expect(response).toMatchObject({ ok: true, status: 200, payload });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/songs/resolve",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      })
    );
  });

  it("relays overlay updates without a page-origin loopback request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    await import("./background");

    const response = await requestBackendRelay({
      type: "LYRIKANA_ELECTRON_REQUEST",
      path: "/overlay",
      body: JSON.stringify({ original: "line" }),
    });

    expect(response).toMatchObject({
      ok: true,
      status: 200,
      payload: { ok: true },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17654/overlay",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
      })
    );
  });
});


describe("Electron automatic launch service worker", () => {
  it("skips Native Messaging when the backend and Electron are healthy", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await import("./background");

    const response = await requestElectronLaunch();

    expect(response).toMatchObject({ ready: true, state: "already-running" });
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });

  it("launches the backend and Electron through the registered Native Host", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          new Response("{}", {
            status: sendNativeMessage.mock.calls.length > 0 ? 200 : 503,
          })
        )
      );
    vi.stubGlobal("fetch", fetchMock);
    sendNativeMessage.mockResolvedValue({ ok: true, state: "started" });
    await import("./background");

    const response = await requestElectronLaunch();

    expect(sendNativeMessage).toHaveBeenCalledWith("com.lyrikana.launcher", {
      command: "ensureElectron",
      source: "youtube-music",
    });
    expect(response).toMatchObject({ ready: true, state: "started" });
  });

  it("uses Native Messaging when Electron is up but the backend is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          new Response("{}", {
            status:
              url.includes(":17654/") || sendNativeMessage.mock.calls.length > 0 ? 200 : 503,
          })
        )
      )
    );
    sendNativeMessage.mockResolvedValue({ ok: true, state: "started" });
    await import("./background");

    const response = await requestElectronLaunch();

    expect(sendNativeMessage).toHaveBeenCalledOnce();
    expect(response).toMatchObject({ ready: true, state: "started" });
  });
});


describe("YouTube Music overlay lifecycle", () => {
  it("hides the overlay when the last YouTube Music tab or app closes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    tabsQuery.mockResolvedValue([]);
    await import("./background");

    tabRemovedListener();
    await vi.advanceTimersByTimeAsync(870);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17654/lifecycle",
      expect.objectContaining({ body: JSON.stringify({ active: false }) })
    );
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });

  it("ignores a transient zero-tab result during a player reload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    tabsQuery
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { id: 7, url: "https://music.youtube.com/watch?v=next" } as chrome.tabs.Tab,
      ]);
    await import("./background");

    tabRemovedListener();
    await vi.advanceTimersByTimeAsync(120);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:17654/lifecycle",
      expect.objectContaining({ body: JSON.stringify({ active: false }) })
    );

    await vi.advanceTimersByTimeAsync(750);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17654/lifecycle",
      expect.objectContaining({ body: JSON.stringify({ active: true }) })
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "http://127.0.0.1:17654/lifecycle",
      expect.objectContaining({ body: JSON.stringify({ active: false }) })
    );
  });

  it("keeps the overlay visible while another YouTube Music tab or app remains", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    tabsQuery.mockResolvedValue([
      { id: 7, url: "https://music.youtube.com/watch?v=test" } as chrome.tabs.Tab,
    ]);
    await import("./background");

    tabRemovedListener();
    await vi.advanceTimersByTimeAsync(120);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:17654/lifecycle",
      expect.objectContaining({ body: JSON.stringify({ active: true }) })
    );
    expect(sendNativeMessage).not.toHaveBeenCalled();
  });
});
