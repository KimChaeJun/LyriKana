import { afterEach, describe, expect, it, vi } from "vitest";

import { postElectronRequest, requestElectronData } from "./electron";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Electron local-network client", () => {
  it("routes overlay requests through the extension service worker", async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      payload: { ok: true },
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      runtime: { id: "test-extension", sendMessage },
    });

    await postElectronRequest("/overlay", { original: "line" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith({
      type: "LYRIKANA_ELECTRON_REQUEST",
      path: "/overlay",
      body: JSON.stringify({ original: "line" }),
    });
  });

  it("returns data from a relayed Electron response", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test-extension",
        sendMessage: vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          payload: { ok: true, data: { commands: ["next"] } },
        }),
      },
    });

    await expect(
      requestElectronData<{ commands: string[] }>("/player/commands/poll", {})
    ).resolves.toEqual({ commands: ["next"] });
  });
});
