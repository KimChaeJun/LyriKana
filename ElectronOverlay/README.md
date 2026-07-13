# LyriKana Electron Overlay

Always-on-top companion window for the LyriKana Chrome Extension.

Electron listens on `http://127.0.0.1:17654` for overlay/settings/playback updates and player command polling. It also exposes Sudachi analysis and a reusable line-reading cache. Lyrics lookup and song-level caching are owned by the FastAPI backend.

Use `LyriKana: Full Development` or `LyriKana: Start All` from the repository root. For an isolated run:

```powershell
npm ci
npm run dev
```

The app checks `LYRIKANA_BACKEND_URL` (default `http://127.0.0.1:8000`) without terminating if the backend is unavailable. `Ctrl+Alt+L` toggles click-through mode.
