# LyriKana 🎵

**Korean version available here → README_KR.md**

**LyriKana** is a Chrome extension that displays karaoke-style synced lyrics and pronunciation for songs playing on YouTube Music.

It helps users practice non-English songs (especially J-pop) by showing real-time lyrics along with Japanese pronunciation in **Korean or Romaji**.

---

## ✨ Features

* 🎧 **Automatic song detection** from YouTube Music
* 📝 **Synced lyrics display (LRC support)**
* 🇯🇵 **Japanese pronunciation support**

  * Korean pronunciation
  * Romaji pronunciation
  * Option to display both
* 📺 **Overlay lyrics UI** on YouTube Music
* 🪟 **Picture-in-Picture (PIP) lyrics window**
* 🎤 Designed for **song practice and karaoke-style learning**

---

## 🚀 Tech Stack

Frontend

* React
* TypeScript
* Vite
* Chrome Extension API

Lyrics Sources

* LRCLIB (primary lyrics API)
* Netease (planned)

Future Backend (planned)

* FastAPI
* Redis
* PostgreSQL

---

## 🏗️ Architecture

```
LyriKana
 ├ extension
 │   ├ content script (YouTube Music detection)
 │   ├ overlay UI (lyrics display)
 │   ├ PIP window
 │   └ settings popup
 │
 └ backend (planned)
     ├ lyrics API integration
     ├ caching
     └ user lyric corrections
```

Workflow

```
YouTube Music
      ↓
Song detection (content script)
      ↓
Lyrics fetch (LRCLIB)
      ↓
LRC parsing
      ↓
Pronunciation generation
      ↓
Overlay / PIP lyrics UI
```

---

## 📌 Roadmap

### MVP

* [ ] Detect currently playing song on YouTube Music
* [ ] Fetch lyrics from LRCLIB
* [ ] Parse LRC synced lyrics
* [ ] Display overlay lyrics
* [ ] Japanese → Romaji pronunciation

### Next

* [ ] Japanese → Korean pronunciation
* [ ] PIP lyrics window
* [ ] Lyrics UI improvements

### Future

* [ ] Backend API (FastAPI)
* [ ] Lyrics caching system
* [ ] User lyric correction system
* [ ] Support for more languages (French, Chinese, etc.)
* [ ] Pitch / rhythm analysis for singing practice

---

## 🎯 Project Goal

LyriKana aims to make practicing foreign-language songs easier by combining:

* **synced lyrics**
* **pronunciation support**
* **karaoke-style UI**

The goal is to create a lightweight tool that helps users sing along and improve their pronunciation while listening to music.

---

## 📜 License

This project is currently under development.
License will be added later.
