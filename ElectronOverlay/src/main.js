const { app, BrowserWindow, globalShortcut, ipcMain } = require("electron");
const http = require("node:http");
const path = require("node:path");
const {
  closeDatabase,
  getCachedLineReadings,
  getReadingCandidates,
  initDatabase,
  saveCachedLineReading,
  saveReadingCandidate,
  saveReadingCorrection,
} = require("./db");
const { analyzeWithSudachi } = require("./sudachi");

const PORT = 17654;
const BACKEND_URL = (process.env.LYRIKANA_BACKEND_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  ""
);
let overlayWindow = null;
let server = null;
let clickThrough = false;
let playerCommandQueue = [];
let latestSettings = null;

function enqueuePlayerCommand(command) {
  const allowedCommands = new Set(["play-pause", "next", "previous"]);
  if (!allowedCommands.has(command)) return false;

  playerCommandQueue.push({
    command,
    createdAt: Date.now(),
  });

  if (playerCommandQueue.length > 20) {
    playerCommandQueue = playerCommandQueue.slice(-20);
  }

  return true;
}

function drainPlayerCommands() {
  const commands = playerCommandQueue;
  playerCommandQueue = [];
  return commands;
}

function mergeWithLatestSettings(payload) {
  if (!latestSettings) return payload;

  return {
    ...payload,
    settings: {
      ...(payload?.settings ?? {}),
      ...latestSettings,
    },
  };
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 400,
    height: 260,
    minWidth: 420,
    minHeight: 180,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWindow.setBackgroundColor("#00000000");
  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.loadFile(path.join(__dirname, "overlay.html"));

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
}

function sendToOverlay(channel, payload) {
  if (!overlayWindow) {
    createOverlayWindow();
  }

  overlayWindow.webContents.once("did-finish-load", () => {
    overlayWindow?.webContents.send(channel, payload);
  });

  if (!overlayWindow.webContents.isLoading()) {
    overlayWindow.webContents.send(channel, payload);
  }
}

function setClickThrough(nextClickThrough) {
  clickThrough = Boolean(nextClickThrough);
  overlayWindow?.setIgnoreMouseEvents(clickThrough, { forward: true });
  overlayWindow?.webContents.send("click-through:update", clickThrough);
}

function toggleClickThrough() {
  setClickThrough(!clickThrough);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error("Request body too large"));
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

async function waitForBackend(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let delayMs = 250;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BACKEND_URL}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) {
        console.log(`[LyriKana] Backend ready at ${BACKEND_URL}`);
        return true;
      }
    } catch {
      // The backend task may still be starting; retry with a bounded backoff.
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(2000, Math.round(delayMs * 1.6));
  }

  console.warn(`[LyriKana] Backend unavailable at ${BACKEND_URL}; overlay remains active`);
  sendToOverlay("overlay:update", {
    songLabel: "LyriKana",
    original: "Backend unavailable",
    reading: "Start the LyriKana backend; the Extension will retry on the next track.",
    translation: "",
    next: "",
  });
  return false;
}

function startServer() {
  server = http.createServer(async (request, response) => {
    if (request.method === "OPTIONS") {
      writeJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      writeJson(response, 200, { status: "ok" });
      return;
    }

    if (request.method !== "POST") {
      writeJson(response, 404, { ok: false, error: "Not found" });
      return;
    }

    try {
      const body = await readRequestBody(request);
      const payload = body ? JSON.parse(body) : {};

      if (request.url === "/overlay") {
        sendToOverlay("overlay:update", mergeWithLatestSettings(payload));
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.url === "/settings") {
        latestSettings = {
          ...(latestSettings ?? {}),
          ...payload,
        };
        sendToOverlay("settings:update", payload);
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.url === "/playback") {
        sendToOverlay("playback:update", payload);
        writeJson(response, 200, { ok: true });
        return;
      }

      if (request.url === "/player/command") {
        writeJson(response, 200, {
          ok: enqueuePlayerCommand(payload.command),
        });
        return;
      }

      if (request.url === "/player/commands/poll") {
        writeJson(response, 200, {
          ok: true,
          data: {
            commands: drainPlayerCommands(),
          },
        });
        return;
      }

      if (request.url === "/cache/lines/get") {
        writeJson(response, 200, {
          ok: true,
          data: getCachedLineReadings(payload),
        });
        return;
      }

      if (request.url === "/cache/lines/save") {
        writeJson(response, 200, {
          ok: true,
          data: saveCachedLineReading(payload),
        });
        return;
      }

      if (request.url === "/reading/candidates/get") {
        writeJson(response, 200, {
          ok: true,
          data: getReadingCandidates(payload),
        });
        return;
      }

      if (request.url === "/reading/candidates/save") {
        writeJson(response, 200, {
          ok: true,
          data: saveReadingCandidate(payload),
        });
        return;
      }

      if (request.url === "/reading/corrections/save") {
        writeJson(response, 200, {
          ok: true,
          data: saveReadingCorrection(payload),
        });
        return;
      }

      if (request.url === "/reading/sudachi/analyze") {
        writeJson(response, 200, {
          ok: true,
          data: await analyzeWithSudachi(payload),
        });
        return;
      }

      writeJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      writeJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`[LyriKana] Electron overlay server listening on ${PORT}`);
  });
}

app.whenReady().then(() => {
  initDatabase(app);
  createOverlayWindow();
  startServer();
  void waitForBackend();
  globalShortcut.register("CommandOrControl+Alt+L", toggleClickThrough);

  app.on("activate", () => {
    if (!overlayWindow) {
      createOverlayWindow();
    }
  });
});

ipcMain.on("window:close", () => {
  overlayWindow?.close();
});

ipcMain.on("window:minimize", () => {
  overlayWindow?.minimize();
});

ipcMain.on("window:toggle-ignore-mouse", (_event, ignoreMouse) => {
  setClickThrough(ignoreMouse);
});

ipcMain.on("player:command", (_event, command) => {
  enqueuePlayerCommand(command);
});

app.on("before-quit", () => {
  globalShortcut.unregisterAll();
  server?.close();
  closeDatabase();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
