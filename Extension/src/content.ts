import { parseLrcWithPronunciation } from "./utils/lyrics/parseLrcWithPronunciation";

type LyricLine = {
  time: number;
  original: string;
  reading: string;
  kr: string;
  jp: string;
  en: string;
};

let lastSongKey: string | null = null;
let currentLyrics: LyricLine[] = [];
let currentLineIndex = -1;

const INTRO_TEXT = "♪ 전주 ♪";
const INSTRUMENTAL_TEXT = "♪ 간주 ♪";

function cleanTitle(title: string): string {
  if (title.includes(" - ")) {
    title = title.split(" - ")[0];
  }
  return title.trim();
}

function cleanArtist(artist: string): string {
  if (artist.includes("•")) {
    artist = artist.split("•")[0];
  }
  return artist.trim();
}

function getSongInfo(): { title: string; artist: string } | null {
  const titleElement =
    document.querySelector("ytmusic-player-bar .title") ??
    document.querySelector("#layout ytmusic-player-bar .title");

  const artistElement =
    document.querySelector("ytmusic-player-bar .byline") ??
    document.querySelector("#layout ytmusic-player-bar .byline");

  if (!titleElement || !artistElement) return null;

  const title = cleanTitle(titleElement.textContent?.trim() || "");
  const artist = cleanArtist(artistElement.textContent?.trim() || "");

  if (!title || !artist) return null;

  return { title, artist };
}

function createLine(
  id: string,
  fontSize: string,
  opacity = "1",
  weight = "400"
): HTMLDivElement {
  const el = document.createElement("div");
  el.id = id;
  el.style.fontSize = fontSize;
  el.style.opacity = opacity;
  el.style.fontWeight = weight;
  el.style.lineHeight = "1.45";
  return el;
}

function createLyricsOverlay(): void {
  if (document.getElementById("lyrikana-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "lyrikana-overlay";

  overlay.style.position = "fixed";
  overlay.style.bottom = "120px";
  overlay.style.left = "50%";
  overlay.style.transform = "translateX(-50%)";
  overlay.style.background = "rgba(0,0,0,0.74)";
  overlay.style.color = "white";
  overlay.style.padding = "18px 28px";
  overlay.style.borderRadius = "14px";
  overlay.style.zIndex = "99999";
  overlay.style.maxWidth = "82vw";
  overlay.style.minWidth = "360px";
  overlay.style.textAlign = "center";
  overlay.style.whiteSpace = "pre-wrap";
  overlay.style.backdropFilter = "blur(6px)";
  overlay.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
  overlay.style.pointerEvents = "none";
  overlay.style.userSelect = "none";

  const originalLine = createLine("lyrikana-original-line", "24px", "1", "700");
  const readingLine = createLine("lyrikana-reading-line", "18px", "0.92", "500");
  const krLine = createLine("lyrikana-kr-line", "17px", "0.85", "400");
  const nextLine = createLine("lyrikana-next-line", "16px", "0.58", "400");

  originalLine.style.marginBottom = "6px";
  readingLine.style.marginBottom = "4px";
  krLine.style.marginBottom = "10px";

  originalLine.innerText = "LyriKana loading...";
  readingLine.innerText = "";
  krLine.innerText = "";
  nextLine.innerText = "";

  overlay.appendChild(originalLine);
  overlay.appendChild(readingLine);
  overlay.appendChild(krLine);
  overlay.appendChild(nextLine);
  document.body.appendChild(overlay);
  console.log("[LyriKana] overlay created");
}

function updateLyricsDisplay(
  current?: Partial<LyricLine> | null,
  next?: Partial<LyricLine> | null,
  overrideOriginal = ""
): void {
  const originalLine = document.getElementById("lyrikana-original-line");
  const readingLine = document.getElementById("lyrikana-reading-line");
  const krLine = document.getElementById("lyrikana-kr-line");
  const nextLine = document.getElementById("lyrikana-next-line");

  if (!originalLine || !readingLine || !krLine || !nextLine) return;

  originalLine.innerText = overrideOriginal || current?.original || "";
  readingLine.innerText = overrideOriginal ? "" : current?.reading || "";
  krLine.innerText = overrideOriginal ? "" : current?.kr || "";
  nextLine.innerText = next?.original ? `다음: ${next.original}` : "";
}

function resetLyrics(message: string): void {
  currentLyrics = [];
  currentLineIndex = -1;
  updateLyricsDisplay(null, null, message);
}

function estimateLineDuration(line: LyricLine): number {
  const baseText = (line.reading || line.original || "").replace(/\s+/g, "");

  if (!baseText) return 2.5;

  let units = 0;

  for (const ch of baseText) {
    if (ch === "ー") {
      units += 1.2;
    } else if (ch === "っ" || ch === "ッ") {
      units += 0.4;
    } else if (/[ぁ-んァ-ン]/.test(ch)) {
      units += 1;
    } else if (/[一-龯々]/.test(ch)) {
      units += 1.1;
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      units += 0.8;
    } else {
      units += 0.6;
    }
  }

  const estimated = units * 0.24 + 0.9;

  return Math.min(8.5, Math.max(2.4, estimated));
}

function updateLyricsByTime(): void {
  const player = document.querySelector("video") as HTMLVideoElement | null;
  if (!player || currentLyrics.length === 0) return;

  const currentTime = player.currentTime;
  let newIndex = -1;

  for (let i = 0; i < currentLyrics.length; i++) {
    if (currentTime >= currentLyrics[i].time) {
      newIndex = i;
    } else {
      break;
    }
  }

  if (newIndex === -1) {
    if (currentLineIndex !== -3) {
      currentLineIndex = -3;
      updateLyricsDisplay(null, currentLyrics[0], INTRO_TEXT);
    }
    return;
  }

  const currentLine = currentLyrics[newIndex];
  const nextLine = currentLyrics[newIndex + 1];

  if (nextLine) {
    const gap = nextLine.time - currentLine.time;
    const estimatedEnd = currentLine.time + estimateLineDuration(currentLine);
    const remainingToNext = nextLine.time - currentTime;

    const isLikelyInstrumental =
      gap >= 7 &&
      currentTime >= estimatedEnd &&
      remainingToNext >= 1.8;

    if (isLikelyInstrumental) {
      if (currentLineIndex !== -2) {
        currentLineIndex = -2;
        updateLyricsDisplay(null, nextLine, INSTRUMENTAL_TEXT);
      }
      return;
    }
  }

  if (newIndex !== currentLineIndex) {
    // console.log("[LyriKana] line change:", {
    //   newIndex,
    //   currentTime,
    //   currentLine: currentLyrics[newIndex],
    //   nextLine: currentLyrics[newIndex + 1],
    // });
    currentLineIndex = newIndex;
    updateLyricsDisplay(currentLine, nextLine);
  }
}

async function fetchLyrics(title: string, artist: string): Promise<void> {
  try {
    const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
      title
    )}&artist_name=${encodeURIComponent(artist)}`;

    console.log("[LyriKana] fetching lyrics:", { title, artist, url });

    const res = await fetch(url);
    const data = await res.json();

    // console.log("[LyriKana] lyrics api response:", data);

    if (!Array.isArray(data) || data.length === 0) {
      resetLyrics("Lyrics not found");
      return;
    }

    const song = data.find((item) => item?.syncedLyrics) ?? data[0];
    // console.log("[LyriKana] selected song:", song);

    if (!song?.syncedLyrics) {
      resetLyrics("Synced lyrics not available");
      return;
    }

    updateLyricsDisplay(null, null, "Analyzing pronunciation...");

    currentLyrics = (await parseLrcWithPronunciation(
      song.syncedLyrics
    )) as LyricLine[];

    // console.log("[LyriKana] parsed lyrics:", currentLyrics);
    // console.log("[LyriKana] parsed lyrics length:", currentLyrics.length);

    currentLineIndex = -1;

    if (currentLyrics.length === 0) {
      resetLyrics("No lyric lines");
      return;
    }

    updateLyricsDisplay(currentLyrics[0], currentLyrics[1] ?? null);
  } catch (error) {
    console.error("[LyriKana] fetchLyrics error:", error);
    resetLyrics("Lyrics error");
  }
}

async function handleSongChange(): Promise<void> {
  const song = getSongInfo();
  if (!song) return;
  
  const songKey = `${song.title} - ${song.artist}`;

  if (songKey === lastSongKey) return;

  // console.log("[LyriKana] song info:", song);
  // console.log("[LyriKana] song key:", songKey);

  lastSongKey = songKey;
  resetLyrics("Loading lyrics...");
  await fetchLyrics(song.title, song.artist);
}

function startObserver(): void {
  const target = document.querySelector("ytmusic-player-bar");
  if (!target) {
    console.log("[LyriKana] player not found");
    return;
  }

  const observer = new MutationObserver(() => {
    void handleSongChange();
  });

  observer.observe(target, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // console.log("[LyriKana] observer started");
}

window.addEventListener("load", () => {
  createLyricsOverlay();
  console.log("[LyriKana] window loaded");
  startObserver();
  void handleSongChange();
  setInterval(updateLyricsByTime, 200);
});

