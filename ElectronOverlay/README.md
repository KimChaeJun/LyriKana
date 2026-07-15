# LyriKana Electron Overlay

Always-on-top companion window for the LyriKana Chrome Extension.

Electron listens on `http://127.0.0.1:17654` for overlay/settings/playback updates and player command polling. It also exposes Sudachi analysis and a reusable line-reading cache. Lyrics lookup and song-level caching are owned by the FastAPI backend.

Use `LyriKana: Full Development` or `LyriKana: Start All` from the repository root. For an isolated run:

```powershell
npm ci
npm run dev
```

The app checks `LYRIKANA_BACKEND_URL` (default `http://127.0.0.1:8000`) without terminating if the backend is unavailable. `Ctrl+Alt+L` toggles click-through mode.

On Windows, opening YouTube Music in Chrome, Edge, or Chromium starts the FastAPI backend, waits for its health endpoint, and then launches the overlay through the Extension's Native Messaging host. The Extension keeps the overlay visible while at least one YouTube Music tab or installed PWA window remains, hides it after the last one closes, and restores the existing window when one reopens. The processes stay alive while the window is hidden. Run the repository task `LyriKana: Register Native Host` once after moving the repository or changing the launcher, then reload `Extension/dist` in the browser. Health checks and a single-instance lock reuse services that are already running instead of creating duplicates.
