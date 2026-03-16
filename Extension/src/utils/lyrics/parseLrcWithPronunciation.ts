import { buildLyricLine, type LyricLine } from "../pronunciation/lineBuilder";

export type BaseLyricLine = {
  time: number;
  original: string;
  reading: string;
  kr: string;
  jp: string;
  en: string;
};

export type BackgroundBuildOptions = {
  concurrency?: number;
  shouldStop?: () => boolean;
  onLine?: (index: number, line: LyricLine) => void;
  onError?: (index: number, original: string, error: unknown) => void;
};

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

export function parseLrcBase(lrc: string): BaseLyricLine[] {
  return lrc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/\[(\d{2}):(\d{2}(?:\.\d+)?)\]\s*(.*)/);
      if (!match) return [];

      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);
      const original = match[3].trim();

      if (!original) return [];

      return [
        {
          time: minutes * 60 + seconds,
          original,
          reading: "",
          kr: "",
          jp: "",
          en: "",
        },
      ];
    });
}

export async function enrichLyricsInBackground(
  baseLines: BaseLyricLine[],
  options: BackgroundBuildOptions = {}
): Promise<void> {
  const {
    concurrency = 3,
    shouldStop = () => false,
    onLine,
    onError,
  } = options;

  let cursor = 0;

  const worker = async () => {
    while (true) {
      if (shouldStop()) return;

      const index = cursor;
      cursor += 1;

      if (index >= baseLines.length) return;

      const seed = baseLines[index];

      try {
        const built = await buildLyricLine(seed.time, seed.original);
        if (shouldStop()) return;

        const fixedLine = applyParsedLineSafetyFixes({
          ...built,
          original: seed.original,
        });

        console.log("[LyriKana] enriched line:", {
          index,
          time: fixedLine.time,
          original: fixedLine.original,
          reading: fixedLine.reading,
          kr: fixedLine.kr,
        });

        onLine?.(index, fixedLine);
      } catch (error) {
        console.error("[LyriKana] buildLyricLine failed:", {
          index,
          original: seed.original,
          error,
        });

        onError?.(index, seed.original, error);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, () => worker())
  );
}

export async function parseLrcWithPronunciation(lrc: string): Promise<LyricLine[]> {
  const baseLines = parseLrcBase(lrc);
  const parsed: LyricLine[] = baseLines.map((line) => ({ ...line }));

  await enrichLyricsInBackground(baseLines, {
    concurrency: 3,
    onLine: (index, line) => {
      parsed[index] = line;
    },
  });

  return parsed;
}