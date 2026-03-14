import { buildLyricLine, type LyricLine } from "../pronunciation/lineBuilder";

function sleep(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function applyParsedLineSafetyFixes(line: LyricLine): LyricLine {
  let reading = line.reading;
  let kr = line.kr;
  let jp = line.jp;
  let en = line.en;

  // 최종 안전망: 埃を被って -> かぶって 로 보정
  if (line.original.includes("埃を被って")) {
    reading = reading
      .replace(/こうむって/g, "かぶって")
      .replace(/コウムッテ/g, "カブッテ");

    kr = kr
      .replace(/코오뭇테/g, "카붓테")
      .replace(/코우뭇테/g, "카붓테");

    jp = jp
      .replace(/코오뭇테/g, "카붓테")
      .replace(/코우뭇테/g, "카붓테");

    en = en
      .replace(/koumutte/g, "kabutte")
      .replace(/koomutte/g, "kabutte");
  }

  return {
    ...line,
    reading,
    kr,
    jp,
    en,
  };
}

export async function parseLrcWithPronunciation(lrc: string) {
  const rawLines = lrc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const parsed: LyricLine[] = [];

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

    const fixedLine = applyParsedLineSafetyFixes(lyricLine);

    console.log("[LyriKana] parsed line:", {
      time: fixedLine.time,
      original: fixedLine.original,
      reading: fixedLine.reading,
      kr: fixedLine.kr,
      jp: fixedLine.jp,
      en: fixedLine.en,
    });

    parsed.push(fixedLine);

    if (i % 4 === 3) {
      await sleep(0);
    }
  }

  return parsed;
}