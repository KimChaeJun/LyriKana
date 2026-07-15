import {
  buildFastLyricLine,
  buildLyricLine,
  type LyricLine,
} from "../pronunciation/lineBuilder";

const DEBUG_READING_LOGS = false;

export type BaseLyricLine = {
  time: number;
  original: string;
  lineNo?: number;
  reading: string;
  kr: string;
  jp: string;
  en: string;
};

export type LrcSyncMarker = {
  time: number;
};

export type BackgroundBuildOptions = {
  concurrency?: number;
  buildMode?: "fast" | "precise";
  songId?: string;
  indices?: number[];
  shouldStop?: () => boolean;
  onLine?: (index: number, line: LyricLine) => void;
  onError?: (index: number, original: string, error: unknown) => void;
};

function applyParsedLineSafetyFixes(line: LyricLine): LyricLine {
  let reading = line.reading;
  let displayReading = line.displayReading ?? line.reading;
  let spokenReading = line.spokenReading ?? line.reading;
  let kr = line.kr;
  let jp = line.jp;
  let en = line.en;

  // 최종 안전망: 埃を被って -> かぶって 로 보정
  if (line.original.includes("埃を被って")) {
    reading = reading
      .replace(/こうむって/g, "かぶって")
      .replace(/コウムッテ/g, "カブッテ");
    displayReading = displayReading
      .replace(/こうむって/g, "かぶって")
      .replace(/コウムッテ/g, "カブッテ");
    spokenReading = spokenReading
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
    displayReading,
    spokenReading,
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

export function parseLrcSyncMarkers(lrc: string): LrcSyncMarker[] {
  return lrc
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const match = line.match(/\[(\d{2}):(\d{2}(?:\.\d+)?)\]\s*(.*)/);
      if (!match) return [];

      const text = match[3].trim();
      if (text) return [];

      const minutes = parseInt(match[1], 10);
      const seconds = parseFloat(match[2]);

      return [{ time: minutes * 60 + seconds }];
    });
}

export async function enrichLyricsInBackground(
  baseLines: BaseLyricLine[],
  options: BackgroundBuildOptions = {}
): Promise<void> {
  const {
    concurrency = 3,
    buildMode = "precise",
    songId,
    indices,
    shouldStop = () => false,
    onLine,
    onError,
  } = options;

  let cursor = 0;
  const order = indices?.length
    ? [...new Set(indices)].filter((index) => index >= 0 && index < baseLines.length)
    : baseLines.map((_line, index) => index);
  const build = buildMode === "fast" ? buildFastLyricLine : buildLyricLine;

  const worker = async () => {
    while (true) {
      if (shouldStop()) return;

      const index = cursor;
      cursor += 1;

      if (index >= order.length) return;

      const lineIndex = order[index];
      const seed = baseLines[lineIndex];

      try {
        const built = await build(seed.time, seed.original, {
          songId,
          lineNo: seed.lineNo ?? lineIndex,
        });
        if (shouldStop()) return;

        const fixedLine = applyParsedLineSafetyFixes({
          ...built,
          original: seed.original,
        });

        if (DEBUG_READING_LOGS) {
          console.log("[LyriKana] enriched line:", {
            index: lineIndex,
            time: fixedLine.time,
            original: fixedLine.original,
            reading: fixedLine.reading,
            kr: fixedLine.kr,
          });
        }

        onLine?.(lineIndex, fixedLine);
      } catch (error) {
        if (DEBUG_READING_LOGS) {
          console.error("[LyriKana] buildLyricLine failed:", {
            index: lineIndex,
            original: seed.original,
            error,
          });
        }

        onError?.(lineIndex, seed.original, error);
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
