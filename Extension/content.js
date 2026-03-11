import { buildLyricLine, LyricLine } from "./src/utils/pronunciation/lineBuilder";

let lastSongKey = null;
let currentLyrics = [];
let currentLineIndex = -1;
const INTRO_TEXT = "♪ 전주 ♪";
const INSTRUMENTAL_TEXT = "♪ 간주 ♪";

function cleanTitle(title) {
    if (title.includes(" - ")) { title = title.split(" - ")[0]; }

    return title.trim();
}

function cleanArtist(artist) {
    if (artist.includes("•")) { artist = artist.split("•")[0]; }

    return artist.trim();
}

function getSongInfo() {
    const titleElement = document.querySelector("ytmusic-player-bar .title");
    const artistElement = document.querySelector("ytmusic-player-bar .byline");

    if (!titleElement || !artistElement) return null;

    const title = cleanTitle(titleElement.textContent.trim());
    const artist = cleanArtist(artistElement.textContent.trim());

    return { title, artist };
}

export async function parseLrcWithPronunciation(lrc: string): Promise<LyricLine[]> {
  const rawLines = lrc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = await Promise.all(
    rawLines.map(async (line) => {
      const match = line.match(/\[(\d{2}):(\d{2}\.\d{2})\]\s*(.*)/);
      if (!match) return null;

      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const original = match[3].trim();

      if (!original) return null;

      return buildLyricLine(minutes * 60 + seconds, original);
    })
  );

  return parsed.filter(Boolean) as LyricLine[];
}

function createLyricsOverlay() {
    if (document.getElementById("lyrikana-overlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "lyrikana-overlay";

    overlay.style.position = "fixed";
    overlay.style.bottom = "120px";
    overlay.style.left = "50%";
    overlay.style.transform = "translateX(-50%)";
    overlay.style.background = "rgba(0,0,0,0.72)";
    overlay.style.color = "white";
    overlay.style.padding = "18px 28px";
    overlay.style.borderRadius = "14px";
    overlay.style.zIndex = "99999";
    overlay.style.maxWidth = "80vw";
    overlay.style.minWidth = "320px";
    overlay.style.textAlign = "center";
    overlay.style.whiteSpace = "pre-wrap";
    overlay.style.backdropFilter = "blur(6px)";

    const currentLine = document.createElement("div");
    currentLine.id = "lyrikana-current-line";
    currentLine.style.fontSize = "24px";
    currentLine.style.fontWeight = "700";
    currentLine.style.lineHeight = "1.5";
    currentLine.style.marginBottom = "8px";

    const nextLine = document.createElement("div");
    nextLine.id = "lyrikana-next-line";
    nextLine.style.fontSize = "18px";
    nextLine.style.opacity = "0.65";
    nextLine.style.lineHeight = "1.4";

    currentLine.innerText = "LyriKana loading...";
    nextLine.innerText = "";

    overlay.appendChild(currentLine);
    overlay.appendChild(nextLine);
    document.body.appendChild(overlay);
}

function updateLyrics(currentText, nextText = "") {
    const currentLine = document.getElementById("lyrikana-current-line");
    const nextLine = document.getElementById("lyrikana-next-line");

    if (!currentLine || !nextLine) return;

    currentLine.innerText = currentText || "";
    nextLine.innerText = nextText || "";
}

async function fetchLyrics(title, artist) {
    try {
        const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}`;
        console.log("LyriKana API request:", url);

        const res = await fetch(url);
        const data = await res.json();

        console.log("LyriKana API response:", data);

        if (!data || data.length === 0) {
            console.log("LyriKana: No lyrics found in API response");
            updateLyrics("Loading lyrics...", "");
            currentLyrics = [];
            currentLineIndex = -1;
            return;
        }

        const song = data[0];
        console.log("LyriKana matched song:", song);

        if (!song.syncedLyrics) {
            console.log("LyriKana: syncedLyrics not available");
            updateLyrics("Loading lyrics...", "");
            currentLyrics = [];
            currentLineIndex = -1;
            return;
        }

        const lrc = song.syncedLyrics;
        console.log("LyriKana LRC loaded successfully");

        currentLyrics = parseLrc(lrc);
        currentLineIndex = -1;

        console.log("LyriKana parsed lyrics:", currentLyrics);

        if (currentLyrics.length === 0) {
            updateLyrics("Loading lyrics...", "");
            return;
        }

        updateLyrics(
            currentLyrics[0].text,
            currentLyrics[1] ? currentLyrics[1].text : ""
        );
    } catch (err) {
        console.error("LyriKana lyrics error:", err);
        updateLyrics("Loading lyrics...", "");
        currentLyrics = [];
        currentLineIndex = -1;
    }
}

async function handleSongChange() {
    const song = getSongInfo();
    if (!song) return;

    const songKey = `${song.title} - ${song.artist}`;

    if (songKey === lastSongKey) {
        return;
    }

    lastSongKey = songKey;
    console.log("LyriKana new song:", song);

    updateLyrics("Loading lyrics...");
    await fetchLyrics(song.title, song.artist);
}

function updateLyricsByTime() {
    const player = document.querySelector("video");
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

    // 첫 가사 시작 전
    if (newIndex === -1) {
        if (currentLineIndex !== -3) {
            currentLineIndex = -3;
            updateLyrics(INTRO_TEXT, currentLyrics[0]?.text || "");
        }
        return;
    }

    const currentLine = currentLyrics[newIndex];
    const nextLine = currentLyrics[newIndex + 1];

    // 긴 공백이면 간주 처리
    if (nextLine) {
        const gap = nextLine.time - currentLine.time;

        if (gap >= 6) {
            if (currentTime >= currentLine.time + 3 && currentTime < nextLine.time) {
                if (currentLineIndex !== -2) {
                    currentLineIndex = -2;
                    updateLyrics(INSTRUMENTAL_TEXT, nextLine.text || "");
                    console.log("LyriKana instrumental section");
                }
                return;
            }
        }
    }

    if (newIndex !== currentLineIndex) {
        currentLineIndex = newIndex;
        updateLyrics(
            currentLine.text,
            nextLine ? nextLine.text : ""
        );
        console.log("LyriKana current line:", currentLine);
    }
}

function startObserver() {
    const target = document.querySelector("ytmusic-player-bar");

    if (!target) {
        console.log("LyriKana: player not found");
        return;
    }

    const observer = new MutationObserver(() => {
        handleSongChange();
    });

    observer.observe(target, {
        childList: true,
        subtree: true
    });

    console.log("LyriKana observer started");
}

window.addEventListener("load", () => {
    createLyricsOverlay();
    startObserver();
    handleSongChange();
    setInterval(updateLyricsByTime, 200);
});