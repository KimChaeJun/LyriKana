import { buildLyricLine } from "../pronunciation/lineBuilder";

export async function parseLrcWithPronunciation(lrc: string) {
  const rawLines = lrc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed = await Promise.all(
    rawLines.map(async (line) => {
      const match = line.match(/\[(\d{2}):(\d{2}(?:\.\d+)?)\]\s*(.*)/);
      if (!match) return null;

      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const original = match[3].trim();

      if (!original) return null;

      return buildLyricLine(minutes * 60 + seconds, original);
    })
  );

  return parsed.filter(Boolean);
}