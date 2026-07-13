# LyriKana 🎵

[한국어 README](README_KR.md)

LyriKana detects the track playing in YouTube Music and displays synchronized lyrics with Japanese readings, Korean pronunciation, and romaji in both an in-page overlay and an always-on-top Electron window.

## Implemented features

- Automatic YouTube Music track and playback-position detection
- FastAPI-first lyrics resolution with a persistent SQLite cache
- LRCLIB candidate selection using title, artist, album, and duration
- Synced LRC parsing and current/next-line rendering
- Japanese reading conversion using kuromoji, the existing exception rules, and optional Sudachi analysis
- Concurrent Korean pronunciation and romaji display
- Manifest V3 Chrome Extension and Electron always-on-top overlay
- Request cancellation and stale response protection on track changes
- Per-line conversion persistence with partial-failure progress
- One-command VSCode development environment

## Architecture

```text
YouTube Music
  └─ Chrome Extension: track/playback detection, pronunciation, page UI
       ├─ FastAPI: normalized identity, DB cache, LRCLIB, status and line storage
       │    └─ SQLite: song_info 1 ─ N lyrics
       └─ Electron Overlay: always-on-top UI, playback commands, Sudachi/reading cache
```

FastAPI is the sole lyrics provider. The Extension no longer calls LRCLIB directly. Electron is limited to presentation, playback command forwarding, and reusable reading-analysis cache data.

## Repository layout

```text
backend/                 FastAPI, SQLAlchemy, SQLite, LRCLIB, tests
Extension/               Manifest V3 Extension, Vite, TypeScript
ElectronOverlay/         Electron overlay and Sudachi bridge
lyrikana-data-core/      Correction data and JSONL tooling
docs/                    Database documentation
scripts/                 Setup, runtime, and test scripts
.vscode/                 F5 compound launch and Tasks
```

## Quick start

Prerequisites: Windows, VSCode, Python 3.11+, and Node.js 20+.

1. Clone the repository and open its root in VSCode.
2. Run `LyriKana: Install Dependencies` from `Tasks: Run Task` once.
3. Select `LyriKana: Full Development` in Run and Debug, then press F5.

F5 opens separate integrated terminals for FastAPI, the Vite Extension watcher, and Electron. Electron performs a bounded `/health` readiness check, but remains open in reconnect mode if the backend is temporarily unavailable. Stopping the compound launch stops all three terminals.

The same environment is available through `LyriKana: Start All`.

## Available VSCode Tasks

- `LyriKana: Backend`
- `LyriKana: Extension Watch`
- `LyriKana: Electron Overlay`
- `LyriKana: Start All`
- `LyriKana: Install Dependencies`
- `LyriKana: Build Extension`
- `LyriKana: Run Tests`

## Loading the Chrome Extension

1. Run F5 or `LyriKana: Build Extension`.
2. Open `chrome://extensions` and enable Developer mode.
3. Choose **Load unpacked** and select `Extension/dist`.
4. Reload the Extension after watcher rebuilds when Chrome requires it.

The manifest permits YouTube Music, FastAPI on `127.0.0.1:8000`, Electron on `127.0.0.1:17654`, and the existing furigana Worker. LRCLIB host permission is no longer needed.

## Environment

The setup Task copies `.env.example` to the ignored root `.env` when needed.

```env
APP_ENV=development
HOST=127.0.0.1
PORT=8000
DATABASE_URL=sqlite:///./lyrikana.db
LRCLIB_BASE_URL=https://lrclib.net
CORS_ORIGINS=http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173
LOG_LEVEL=INFO
LRCLIB_TIMEOUT_SECONDS=10
VITE_BACKEND_URL=http://127.0.0.1:8000
LYRIKANA_BACKEND_URL=http://127.0.0.1:8000
```

Chrome Extension origins are handled by a constrained FastAPI CORS regex. Do not put secrets in Extension environment values.

## Database and processing

The default development database is `backend/lyrikana.db`.

`song_info`
: Stores normalized track identity, metadata, raw LRC, processing status, and progress.

`lyrics`
: Stores `song_id`, line number/time, original text, reading, Korean pronunciation, romaji, nullable English, edit state, and reason tags per line.

Existing legacy `lyric` JSON rows are copied safely into the line table on startup without deleting the old table or database. States are `pending`, `fetching`, `processing`, `completed`, `partial`, and `failed`. Deterministic IDs, a unique identity constraint, and an in-process task registry prevent duplicate tracks and jobs.

## API

```text
GET   /health
POST  /api/v1/songs/resolve
GET   /api/v1/songs/{song_id}
GET   /api/v1/songs/{song_id}/lyrics
GET   /api/v1/songs/{song_id}/status
PATCH /api/v1/songs/{song_id}/lyrics
```

`POST /resolve` returns `202` and the current state immediately. The Extension polls only while the state is `pending/fetching`, using bounded exponential backoff, and starts rendering as soon as original lines are available. Compatibility `/api/lyrics/*` routes remain for existing callers.

## Tests and builds

Run `LyriKana: Run Tests`, or:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

This verifies the FastAPI/SQLite flow, normalization, deduplication, LRC parsing, cache and partial failure behavior, the Extension backend contract, the production Extension build, and the data-core TypeScript build.

## Known limitations

- YouTube Music DOM changes may require selector updates.
- Unsynced LRCLIB lyrics cannot provide accurate time-based display.
- Proper nouns and unusual lyrics can still require pronunciation corrections.
- The task registry targets the current single-process development deployment; introduce a durable queue only when multi-process deployment requires it.
- Chrome local-network policy changes may require permission approval or an Extension reload.

## Next steps

- Consolidate Electron reading candidates/corrections into backend models
- Add user correction UI and correction-history APIs
- Add pronunciation/translation modules for more languages
- Evaluate a durable queue and PostgreSQL when deployment scale requires them
