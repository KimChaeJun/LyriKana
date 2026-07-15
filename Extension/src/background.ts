const NATIVE_HOST_NAME = "com.lyrikana.launcher";
const ELECTRON_HEALTH_URL = "http://127.0.0.1:17654/health";
const ELECTRON_LIFECYCLE_URL = "http://127.0.0.1:17654/lifecycle";
const YOUTUBE_MUSIC_URL_PATTERN = "https://music.youtube.com/*";
const BACKEND_HEALTH_URL = `${(
  import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "")}/health`;
const LAUNCH_COOLDOWN_MS = 5000;
const PRESENCE_DEACTIVATE_GRACE_MS = 750;

type BackendRelayRequest = {
  type: "LYRIKANA_BACKEND_REQUEST";
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

type BackendRelayResponse = {
  ok: boolean;
  status: number;
  payload?: unknown;
  error?: string;
};

type ElectronRelayRequest = {
  type: "LYRIKANA_ELECTRON_REQUEST";
  path: string;
  body?: string;
};

const ALLOWED_ELECTRON_PATHS = new Set([
  "/overlay",
  "/settings",
  "/playback",
  "/player/command",
  "/player/commands/poll",
  "/cache/lines/get",
  "/cache/lines/save",
  "/reading/candidates/get",
  "/reading/candidates/save",
  "/reading/corrections/save",
  "/reading/sudachi/analyze",
]);

let overlayWindowId: number | null = null;
let launchInFlight: Promise<RuntimeLaunchResult> | null = null;
let lastLaunchAttemptAt = 0;
let presenceSyncTimer: ReturnType<typeof setTimeout> | null = null;
let presenceSyncInFlight: Promise<void> | null = null;
let presenceSyncQueued = false;
let inactivePresenceFirstSeenAt: number | null = null;
let lastPostedPresence: boolean | null = null;

type RuntimeLaunchResult = {
  ready: boolean;
  state: "already-running" | "started" | "starting" | "cooldown" | "unavailable";
  error?: string;
};

type NativeHostResponse = {
  ok?: boolean;
  state?: string;
  error?: string;
};

async function isServiceHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(900),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function isAllowedBackendPath(path: string): boolean {
  return path === "/health" || /^\/api\/v1\/songs(?:\/|$)/.test(path);
}

async function relayBackendRequest(
  message: BackendRelayRequest
): Promise<BackendRelayResponse> {
  const method = (message.method || "GET").toUpperCase();
  if (
    !isAllowedBackendPath(message.path) ||
    !["GET", "POST", "PATCH"].includes(method)
  ) {
    return { ok: false, status: 400, error: "invalid_backend_request" };
  }

  const contentType = message.headers?.["content-type"];
  const headers = contentType ? { "Content-Type": contentType } : undefined;
  try {
    const response = await fetch(`${BACKEND_HEALTH_URL.replace(/\/health$/, "")}${message.path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : message.body,
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { detail: text };
      }
    }
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, error: "backend_unavailable" };
  }
}

async function relayElectronRequest(
  message: ElectronRelayRequest
): Promise<BackendRelayResponse> {
  if (!ALLOWED_ELECTRON_PATHS.has(message.path)) {
    return { ok: false, status: 400, error: "invalid_electron_request" };
  }

  try {
    const response = await fetch(`http://127.0.0.1:17654${message.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: message.body || "{}",
      cache: "no-store",
    });
    const text = await response.text();
    let payload: unknown;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    return { ok: response.ok, status: response.status, payload };
  } catch {
    return { ok: false, status: 0, error: "electron_unavailable" };
  }
}

async function isRuntimeHealthy(): Promise<boolean> {
  const [backendHealthy, electronHealthy] = await Promise.all([
    isServiceHealthy(BACKEND_HEALTH_URL),
    isServiceHealthy(ELECTRON_HEALTH_URL),
  ]);
  return backendHealthy && electronHealthy;
}

async function waitForRuntimeHealth(): Promise<boolean> {
  for (const delayMs of [100, 200, 350, 550, 800]) {
    if (await isRuntimeHealthy()) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return isRuntimeHealthy();
}

async function launchRuntime(): Promise<RuntimeLaunchResult> {
  if (await isRuntimeHealthy()) {
    return { ready: true, state: "already-running" };
  }

  if (Date.now() - lastLaunchAttemptAt < LAUNCH_COOLDOWN_MS) {
    return { ready: false, state: "cooldown" };
  }
  lastLaunchAttemptAt = Date.now();

  try {
    const nativeResponse = (await chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      {
        command: "ensureElectron",
        source: "youtube-music",
      }
    )) as NativeHostResponse | undefined;

    if (!nativeResponse?.ok) {
      return {
        ready: false,
        state: "unavailable",
        error: nativeResponse?.error || "native_host_failed",
      };
    }

    const ready = await waitForRuntimeHealth();
    return {
      ready,
      state: ready ? "started" : "starting",
    };
  } catch (error) {
    return {
      ready: false,
      state: "unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function ensureRuntimeRunning(): Promise<RuntimeLaunchResult> {
  if (launchInFlight) return launchInFlight;

  launchInFlight = launchRuntime().finally(() => {
    launchInFlight = null;
  });
  return launchInFlight;
}

async function postYouTubeMusicPresence(active: boolean): Promise<void> {
  try {
    await fetch(ELECTRON_LIFECYCLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    });
  } catch {
    // Electron may be intentionally stopped while no YouTube Music tab exists.
  }
}

async function syncYouTubeMusicPresenceOnce(): Promise<void> {
  let tabs: chrome.tabs.Tab[];
  try {
    tabs = await chrome.tabs.query({ url: YOUTUBE_MUSIC_URL_PATTERN });
  } catch {
    return;
  }

  const active = tabs.length > 0;
  if (active) {
    inactivePresenceFirstSeenAt = null;
    const runtime = await ensureRuntimeRunning();
    if (!runtime.ready) return;
  } else {
    const now = Date.now();
    if (inactivePresenceFirstSeenAt === null) {
      inactivePresenceFirstSeenAt = now;
    }

    const remainingGraceMs =
      PRESENCE_DEACTIVATE_GRACE_MS - (now - inactivePresenceFirstSeenAt);
    if (remainingGraceMs > 0) {
      scheduleYouTubeMusicPresenceSync(remainingGraceMs);
      return;
    }
  }

  if (active === lastPostedPresence) return;
  await postYouTubeMusicPresence(active);
  lastPostedPresence = active;
}

function syncYouTubeMusicPresence(): Promise<void> {
  if (presenceSyncInFlight) {
    presenceSyncQueued = true;
    return presenceSyncInFlight;
  }

  const sync = syncYouTubeMusicPresenceOnce().finally(() => {
    presenceSyncInFlight = null;
    if (presenceSyncQueued) {
      presenceSyncQueued = false;
      scheduleYouTubeMusicPresenceSync(0);
    }
  });
  presenceSyncInFlight = sync;
  return sync;
}

function scheduleYouTubeMusicPresenceSync(delayMs = 120): void {
  if (presenceSyncTimer !== null) clearTimeout(presenceSyncTimer);
  presenceSyncTimer = setTimeout(() => {
    presenceSyncTimer = null;
    void syncYouTubeMusicPresence();
  }, delayMs);
}

function openOverlayWindow(url: string): void {
  chrome.windows.create(
    {
      url,
      type: "popup",
      width: 920,
      height: 260,
      left: 180,
      top: 120,
      focused: true,
    },
    (createdWindow) => {
      overlayWindowId = createdWindow?.id ?? null;
    }
  );
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "LYRIKANA_ELECTRON_REQUEST") {
    void relayElectronRequest(message as ElectronRelayRequest).then(sendResponse);
    return true;
  }

  if (message?.type === "LYRIKANA_BACKEND_REQUEST") {
    void relayBackendRequest(message as BackendRelayRequest).then(sendResponse);
    return true;
  }

  if (message?.type === "LYRIKANA_ENSURE_ELECTRON") {
    void ensureRuntimeRunning().then((result) => {
      if (result.ready) scheduleYouTubeMusicPresenceSync(0);
      sendResponse(result);
    });
    return true;
  }

  if (message?.type !== "LYRIKANA_OPEN_OVERLAY") return false;

  const url = chrome.runtime.getURL("overlay/index.html");
  if (overlayWindowId !== null) {
    chrome.windows.get(overlayWindowId, (existingWindow) => {
      if (chrome.runtime.lastError || !existingWindow) {
        overlayWindowId = null;
        openOverlayWindow(url);
      }
    });
    return false;
  }

  openOverlayWindow(url);
  return false;
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === overlayWindowId) {
    overlayWindowId = null;
  }
  scheduleYouTubeMusicPresenceSync();
});

chrome.tabs.onCreated.addListener(() => scheduleYouTubeMusicPresenceSync());
chrome.tabs.onRemoved.addListener(() => scheduleYouTubeMusicPresenceSync());
chrome.tabs.onUpdated.addListener(() => scheduleYouTubeMusicPresenceSync());
chrome.runtime.onStartup.addListener(() => scheduleYouTubeMusicPresenceSync(250));
chrome.runtime.onInstalled.addListener(() => scheduleYouTubeMusicPresenceSync(250));

export {};
