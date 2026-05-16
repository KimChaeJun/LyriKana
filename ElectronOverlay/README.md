# LyriKana Electron Overlay

Always-on-top companion overlay for the Chrome extension.

## Run

```bash
npm install
npm run dev
```

The app listens on `http://127.0.0.1:17654`.

The Chrome extension posts the current lyric line to:

```txt
POST /overlay
POST /settings
```
