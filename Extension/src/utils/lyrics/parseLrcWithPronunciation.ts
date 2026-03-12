import { buildLyricLine } from "../pronunciation/lineBuilder";

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function parseLrcWithPronunciation(lrc: string) {

  const rawLines = lrc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  console.log("[LyriKana] raw syncedLyrics:", lrc);

  const parsed = [];

  for (let i = 0; i < rawLines.length; i++) {

    const line = rawLines[i];

    const match = line.match(/\[(\d{2}):(\d{2}(?:\.\d+)?)\]\s*(.*)/);

    if (!match) continue;

    const minutes = parseInt(match[1], 10);
    const seconds = parseFloat(match[2]);

    const original = match[3].trim();

    if (!original) continue;

    const lyricLine = await buildLyricLine(
      minutes * 60 + seconds,
      original
    );

    parsed.push(lyricLine);

    // UI freeze 방지
    if (i % 4 === 3) {
      await sleep(0);
    }
  }

  return parsed;
}