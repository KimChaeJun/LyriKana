# LyriKana 🎵

[한국어 README](README_KR.md)

LyriKana is a Windows-first YouTube Music companion and a local J-pop karaoke-lyrics authoring system. It shows synchronized lyrics in an always-on-top desktop overlay, while the backend can build a recording-specific karaoke timeline from user-supplied audio and lyrics. Japanese display readings, sung readings, Korean pronunciation, and romaji are stored independently so live versions, covers, stylized text, and alternate sung pronunciations can be corrected without changing the original lyric.

## What is implemented

- YouTube Music title, artist, video identity, duration, and song-local playback detection
- Synchronized LRC lookup through a FastAPI backend and LRCLIB as the current provider fallback
- A local karaoke database that separates a musical work from its studio, live, cover, and remix recordings
- Stable recording identity through provider recording IDs such as a YouTube video ID, instead of title parsing alone
- Persistent SQLite lyrics, audio-asset, analysis-job, token-timeline, and reading-candidate storage
- LRCLIB candidate ranking by sync availability, title, artist, album, and duration
- Protection against provider metadata overwriting the canonical YouTube Music identity
- Automatic recovery of older cached rows whose provider metadata mutated their artist identity
- Japanese reading analysis using kuromoji, lyric-specific rules, optional Sudachi analysis, and a bounded remote furigana fallback
- Separate display and spoken readings, so contextual particles such as `は` can remain `は` on screen while pronunciation output uses `wa`
- Decorative punctuation normalization with original-text offset preservation for forms such as `⌈私は⌋`, quotes, and brackets
- Multiple reading candidates for ambiguous text and numbers, including Japanese digits, English digits, and English-style year readings such as `1991`
- Acoustic candidate selection using a project-local Japanese phoneme CTC aligner
- GPU vocal separation through `audio-separator`, with Demucs and mix-through fallbacks
- A persistent analysis worker with atomic claims, heartbeats, leases, crash recovery, bounded retries, and review-required output
- Korean pronunciation and romaji generation with reusable line-level caches
- Current lyric, Korean pronunciation, reading, next-line preview, and optional intro/instrumental state
- Gapless MediaSource transition handling using YouTube Music's song-local progress instead of cumulative `<video>.currentTime`
- Non-blocking first-time lyric resolution: provider and analysis latency never forces playback to pause
- Request cancellation and stale-response protection when the track changes
- Manifest V3 Extension popup for visibility, content, theme, font, opacity, position, and timing settings
- Frameless always-on-top Electron overlay with previous, play/pause, and next controls
- Windows Native Messaging launcher for FastAPI and Electron
- Automatic overlay hide after the last YouTube Music tab/PWA closes and restore when one reopens

## Runtime architecture

```text
YouTube Music
  └─ Chrome Extension
       ├─ content script
       │    ├─ observes track metadata and song-local progress
       │    ├─ coordinates non-blocking lyric loading and track transitions
       │    └─ builds/caches pronunciation and sends overlay state
       ├─ service worker
       │    ├─ relays FastAPI and Electron requests
       │    └─ invokes the Windows Native Messaging launcher
       ├─ FastAPI backend (127.0.0.1:8000)
       │    ├─ recording-aware resolve, LRCLIB fallback, and audio ingest
       │    └─ SQLite works, recordings, lyrics, units, assets, and jobs
       ├─ Analysis worker
       │    ├─ vocal separation and Japanese forced alignment
       │    └─ persistent lease, retry, and confidence review
       └─ Electron overlay (127.0.0.1:17654)
            ├─ always-on-top presentation and player commands
            └─ Sudachi bridge and reusable reading caches
```

FastAPI is the only song-lyrics provider. The Extension does not call LRCLIB directly. Electron does not own song-level lyrics; it presents the current state, forwards player commands, and stores reusable reading-analysis data.

The karaoke authoring path runs in a separate worker process so model inference cannot block the FastAPI event loop:

```text
User-authorized audio + source lyrics
  └─ FastAPI ingest
       ├─ work / recording identity
       ├─ SHA-256 de-duplicated audio asset
       └─ persistent analysis job
            └─ Analysis Worker
                 ├─ audio-separator → vocals
                 ├─ lyric normalization and reading candidates
                 ├─ Japanese phoneme CTC / external aligner / MFA
                 ├─ line and token timeline
                 └─ confidence review → local karaoke DB
```

## Lyrics and playback flow

1. The content script reads the current title, artist, video ID when available, duration, and the player bar's song-local progress.
2. The Extension service worker relays `POST /api/v1/songs/resolve` to FastAPI.
3. FastAPI returns a completed local cache hit or creates a background LRCLIB fallback job and immediately responds with `202`.
4. The Extension polls with bounded backoff, but playback continues even on the first database miss.
5. When original lines are ready, cached readings are rendered first. Missing lines are processed in playback-priority order and persisted progressively.
6. A separately authored karaoke result can store recording-specific line, word, mora, or phoneme boundaries and acoustically selected sung readings.

The overlay path uses states such as `pending`, `fetching`, `processing`, `completed`, `partial`, and `failed`. The authoring path additionally uses `awaiting_audio`, `awaiting_lyrics`, `analysis_queued`, `analysis_running`, `review_required`, and `analysis_failed`.

## Requirements

- Windows 10 or 11 for automatic Native Messaging launch
- Chrome, Edge, or Chromium with Manifest V3 Extension support
- VSCode (recommended for the included tasks and F5 compound)
- Python 3.11+
- Node.js 20+ and `npm`
- PowerShell
- Network access to LRCLIB; the optional contextual furigana fallback also uses the configured Worker URL in the Extension manifest
- Optional karaoke-analysis runtime: an NVIDIA CUDA GPU is recommended; the current setup has been validated on an RTX 4050 Laptop GPU with 6 GB VRAM

## Quick start

1. Clone the repository and open its root in VSCode.
2. Run `Tasks: Run Task` → `LyriKana: Install Dependencies` once.
3. Run `LyriKana: Build Extension`, or start `LyriKana: Full Development` with F5.
4. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `Extension/dist`.
5. Open YouTube Music and play a track.

The setup task:

- creates `backend/.venv` and installs Python dependencies;
- runs `npm ci` in `Extension`, `ElectronOverlay`, and `lyrikana-data-core`;
- copies `.env.example` to the ignored root `.env` when needed;
- initializes the backend database;
- builds and registers the Windows Native Messaging host.

The equivalent command is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup.ps1
```

To install the isolated GPU analysis runtime, FFmpeg, separator model, and Japanese CTC model, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-analysis.ps1 -Runtime gpu
```

The analysis environment is intentionally separate at `backend/.venv-analysis`. Model caches, uploaded audio, generated stems, benchmark data, and local FFmpeg tools are ignored by Git.

After moving the repository, changing the launcher, or changing the Extension manifest key, run `LyriKana: Register Native Host` again and reload the unpacked Extension.

## Development

Select `LyriKana: Full Development` in Run and Debug and press F5. It starts four dedicated integrated terminals:

1. FastAPI with Uvicorn reload
2. The persistent karaoke analysis worker
3. Vite Extension build watcher
4. Electron overlay after a bounded backend health check

Stopping the compound launch stops all four development terminals. The same processes can be started with `Tasks: Run Task` → `LyriKana: Start All`.

Available tasks:

- `LyriKana: Backend`
- `LyriKana: Analysis Worker`
- `LyriKana: Extension Watch`
- `LyriKana: Electron Overlay`
- `LyriKana: Start All`
- `LyriKana: Install Dependencies`
- `LyriKana: Install Analysis Runtime`
- `LyriKana: Check Analysis Runtime`
- `LyriKana: Benchmark Japanese Aligner`
- `LyriKana: Register Native Host`
- `LyriKana: Build Extension`
- `LyriKana: Run Tests`

The Native Host starts a non-reloading backend process for normal browser use. After changing backend code outside the F5 development environment, restart that backend process before validating the change.

## Loading and updating the Extension

The production build directory is `Extension/dist`.

1. Build with `LyriKana: Build Extension` or `npm.cmd run build` from `Extension`.
2. Load `Extension/dist` as an unpacked Extension.
3. After a watcher rebuild, press the Extension's reload button in `chrome://extensions` when Chrome has not reloaded it automatically.
4. Refresh the YouTube Music tab so the new content script is injected.

The fixed development Extension ID is `ngdhgdbmndejbjcbglonhpgpflccnfdj`. Loading a different directory or a manifest without the fixed key changes the ID and breaks the registered Native Host origin.

## Using the overlay

The Electron window shows the song label, original lyric, Japanese reading, Korean pronunciation, and optional next line. Its controls send previous, play/pause, and next commands back to the active YouTube Music player.

- `Ctrl+Alt+L`: toggle click-through mode
- `−`: minimize
- `×`: close the overlay window

The Extension popup stores settings in `chrome.storage.sync`:

| Setting | Purpose |
| --- | --- |
| Overlay | Enable or hide lyric content |
| Japanese reading | Show or hide the reading line |
| Korean lyrics | Show or hide Korean pronunciation |
| Next lyric | Show or hide the next original line |
| Intro/instrumental | Show inferred or explicit gaps |
| Theme | Follow system, dark, or light |
| Font sizes | Minimum original, reading, and Korean sizes |
| Opacity | Electron card opacity |
| Bottom position | Stored layout preference |
| Preview timing | Shift lyric activation from -1.5 to +1.5 seconds |

## Automatic launch and lifecycle

When a YouTube Music tab or installed PWA opens, the Extension checks both local services. The Native Host starts a missing backend first, waits for `/health`, and then starts Electron. Health checks, a launcher mutex, and Electron's single-instance lock prevent duplicate services and windows.

The Extension tracks all YouTube Music tabs and PWA windows in the same browser profile. The overlay remains visible while at least one exists, hides after the last one closes, and restores the existing Electron window when one reopens. Hiding the window does not terminate FastAPI or Electron.

Automatic launch is currently Windows-only. Standalone YouTube Music clients that cannot run the browser Extension do not use this path.

## Configuration

The root `.env` is loaded by the backend and runtime scripts. Default values come from `.env.example`:

```env
APP_ENV=development
HOST=127.0.0.1
PORT=8000
DATABASE_URL=sqlite:///./lyrikana.db
LRCLIB_BASE_URL=https://lrclib.net
CORS_ORIGINS=http://localhost,http://127.0.0.1,http://localhost:5173,http://127.0.0.1:5173,https://music.youtube.com
LOG_LEVEL=INFO
LRCLIB_TIMEOUT_SECONDS=10
VITE_BACKEND_URL=http://127.0.0.1:8000
LYRIKANA_BACKEND_URL=http://127.0.0.1:8000

# Karaoke analysis (selected defaults)
ANALYSIS_DATA_DIR=backend/.analysis-data
ANALYSIS_MODEL_DIR=backend/.analysis-data/models
ANALYSIS_SEPARATOR=auto
ANALYSIS_SEPARATOR_MODEL=UVR-MDX-NET-Inst_HQ_3.onnx
ANALYSIS_DEVICE=cuda
ANALYSIS_ALIGNER=auto
ANALYSIS_CTC_MODEL=prj-beatrice/japanese-hubert-base-phoneme-ctc-v4
ANALYSIS_CTC_MAX_PATHS=8
ANALYSIS_CTC_CHUNK_SECONDS=25
ANALYSIS_WORKER_LEASE_SECONDS=900
ANALYSIS_WORKER_MAX_ATTEMPTS=3
ANALYSIS_LOW_CONFIDENCE_THRESHOLD=0.55
```

Do not put secrets in `VITE_*` variables because they are embedded in the Extension build.
See [`.env.example`](.env.example) for the full separator, external-aligner, MFA, timeout, upload-size, and worker configuration.

Local services:

| Service | Default address | Role |
| --- | --- | --- |
| FastAPI | `http://127.0.0.1:8000` | lyrics, status, cache, API docs |
| Electron | `http://127.0.0.1:17654` | overlay, settings, player commands, reading cache |

FastAPI accepts the configured development origins, the fixed YouTube Music origin, Extension origins, and loopback Private Network preflights. Other regular web origins remain blocked.

## Database and caches

The default backend database is `backend/lyrikana.db`.

`works`
: Canonical title/artist identity shared by related recordings.

`song_info`
: One concrete recording with provider identity, performer, version type, duration, source lyrics, status, progress, and errors.

`lyrics`
: One presentation line with start/end time, original text, written reading, acoustically selected sung reading, pronunciation outputs, confidence, source, and edit state.

`lyric_units` and `lyric_reading_candidates`
: Word/mora/phoneme timing plus every text and acoustic reading candidate considered during alignment.

`audio_assets` and `analysis_jobs`
: Authorized local audio de-duplicated by SHA-256 and the persistent lease-based worker queue.

`recording_key` uses provider identity when available, for example `youtube_music:<videoId>`. Consequently, a studio track, live performance, and creator cover can share one work while retaining different lyrics timing and corrections. Metadata-only requests keep a normalized title/artist fallback for compatibility. LRCLIB candidate metadata never replaces the canonical YouTube Music identity.

Startup migration backfills the new work/recording and analysis tables and copies legacy singular `lyric` JSON rows into `lyrics` without deleting the old table or database. See [the database ERD](docs/lyrikana-db-erd.md).

Electron stores a separate local SQLite cache for reading results, analyzer candidates, and corrections. Cache keys include engine version and, where available, song/line scope.

## API

FastAPI exposes interactive documentation at `http://127.0.0.1:8000/docs`.

```text
GET   /
GET   /health
POST  /api/v1/songs/resolve
GET   /api/v1/songs/{song_id}
GET   /api/v1/songs/{song_id}/lyrics
GET   /api/v1/songs/{song_id}/status
PATCH /api/v1/songs/{song_id}/lyrics
PUT   /api/v1/songs/{song_id}/source-lyrics
PUT   /api/v1/songs/{recording_id}/audio?filename=authorized.wav
GET   /api/v1/songs/{recording_id}/audio
POST  /api/v1/songs/{recording_id}/analysis
GET   /api/v1/songs/{recording_id}/analysis/{job_id}
POST  /api/v1/songs/{recording_id}/analysis/{job_id}/retry
```

Example resolve request:

```json
{
  "title": "GOOD DAY",
  "artist": "Mrs. GREEN APPLE",
  "duration": 258,
  "playbackTime": 2,
  "videoId": "youtube-video-id",
  "provider": "youtube_music",
  "versionType": "studio"
}
```

`POST /resolve` returns `202` with the current processing state. Compatibility routes under `/api/lyrics/*` remain available for older callers.

For karaoke authoring, upload only audio you are authorized to process, supply source lyrics if necessary, and enqueue an analysis job with the returned `audioAssetId`. LyriKana deliberately does not download audio from YouTube. See [the karaoke analysis pipeline](docs/karaoke-analysis-pipeline.md) for request examples and the external-aligner JSON contract.

## Karaoke analysis runtime

`ANALYSIS_SEPARATOR=auto` selects `audio-separator`, then Demucs, then the low-confidence passthrough adapter. `ANALYSIS_ALIGNER=auto` selects a configured external singing aligner, the project-local Japanese CTC aligner, MFA, then a deterministic timed-lyrics fallback.

The Japanese baseline uses the Apache-2.0 `prj-beatrice/japanese-hubert-base-phoneme-ctc-v4` model and OpenJTalk-style phonemes. It evaluates multiple lyric readings against one set of acoustic emissions, in bounded chunks suitable for the tested 6 GB GPU. Model loading is local-only during normal worker operation; downloads happen only during explicit setup.

Validate the installed runtime and the isolated separator path:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-analysis-runtime.ps1
```

Run the licensed PJS singing sample benchmark:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-japanese-aligner.ps1
```

On the initial RTX 4050 run, the `pjs056` sample matched 69 of 71 reference phonemes (97.18% coverage), with 42.822 ms boundary MAE, 80.43% of boundaries within 50 ms, and 89.13% within 100 ms. This is a reproducible baseline on one sample, not a full-corpus or commercial J-pop quality claim.

## Repository layout

```text
backend/                 FastAPI, SQLite, analysis worker/aligners, LRCLIB, tests
Extension/               Manifest V3 Extension, Vite, TypeScript, kuromoji data
ElectronOverlay/         Electron overlay, local reading DB, Sudachi bridge
lyrikana-data-core/      correction schema and JSONL dataset tooling
native-host/             Windows Native Messaging launcher source/build output
docs/                    database and karaoke-analysis documentation
scripts/                 setup, runtime checks, worker, registration, and tests
.vscode/                 tasks and the F5 compound launch
```

## Tests and builds

Run `LyriKana: Run Tests`, or:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

This runs:

- backend API, database migration, recording identity, analysis queue/lease, adapter/pipeline, alignment benchmark, normalization, LRCLIB ranking, LRC, retry, cache, and partial-state tests;
- Extension backend/Electron relay, playback transition, and pronunciation tests;
- the production Extension build;
- the `lyrikana-data-core` TypeScript build.

The Electron Sudachi bridge also has Python tests under `ElectronOverlay/tests`; they are not currently included in `scripts/test.ps1`.
The real separator and CTC model checks are intentionally separate because they require the optional analysis environment, downloaded model data, and considerably more runtime than unit tests.

## Troubleshooting

### The Extension changed but YouTube Music still runs old code

Rebuild `Extension/dist`, reload LyriKana in `chrome://extensions`, and refresh the YouTube Music tab. A Vite watcher build alone does not guarantee that Chrome reinjected the content script.

### Backend changes are not visible

The F5 backend uses `--reload`; the Native Host backend does not. Stop the process listening on port `8000` and reopen YouTube Music, or start `LyriKana: Backend` for development.

### The overlay says `Backend unavailable` or `Lyrics request error`

Check `http://127.0.0.1:8000/health`, restart the backend if needed, and reselect the track. For a server-side error, inspect the backend terminal before deleting any cache. Completed caches are designed to survive restarts and identity repair.

### Synced lyrics are not available

Playback continues without waiting. LyriKana can store plain LRCLIB lyrics, but time-based rendering requires timestamped LRC lines or an authored karaoke analysis result. Confirm that the LRCLIB result is marked **Synced**, or upload authorized audio and source lyrics through the analysis API.

### The analysis worker does not claim a job

Run `LyriKana: Analysis Worker` separately from FastAPI and inspect the job status for `awaiting_audio` or `awaiting_lyrics`. Use `LyriKana: Check Analysis Runtime` to verify FFmpeg, CUDA, ONNX Runtime, the separator model, and the isolated Python environment.

### The overlay does not start automatically

Run `LyriKana: Register Native Host`, reload the unpacked Extension, and confirm that its ID is `ngdhgdbmndejbjcbglonhpgpflccnfdj`. Re-register after moving the repository because the Native Host manifest contains an absolute executable path.

### The overlay ignores mouse input

Press `Ctrl+Alt+L` to turn click-through off.

## Known limitations

- YouTube Music DOM changes can require selector updates.
- Plain, unsynchronized lyrics still require the authoring pipeline before they can provide accurate time-based display.
- The current Japanese CTC checkpoint was trained on speech, not singing. Long notes, melisma, vocal effects, and unusual live phrasing can still require manual correction or a future singing-specific model.
- The reported PJS result covers one licensed sample only; broader corpus and real J-pop evaluation has not yet been completed.
- Low-confidence results are stored as `review_required`; no model output silently replaces user-edited lines.
- The analysis API and worker are implemented, but the Extension does not yet provide an upload/review UI or automatically enqueue the current track.
- LyriKana does not download YouTube audio. Users must supply audio they are authorized to process.
- LRCLIB fallback jobs still use the in-process registry; model analysis jobs use the persistent lease-based queue.
- Automatic launch and lifecycle integration currently require Windows Native Messaging.
- Chrome local-network policy changes may require a new permission approval or Extension reload.
