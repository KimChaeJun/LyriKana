import {
  getJapaneseReadingWithTokens,
  getLocalJapaneseReadingWithTokens,
} from "./reading";
import { buildPronunciation } from "./converters";
import type { TokenLite } from "./specialReadingRules";

const DEBUG_READING_LOGS = false;

export type LyricLine = {
  time: number;
  original: string;
  reading: string;
  kr: string;
  jp: string;
  en: string;
};

export async function buildLyricLine(
  time: number,
  original: string
): Promise<LyricLine> {
  return buildLyricLineWithReader(time, original, getJapaneseReadingWithTokens);
}

export async function buildFastLyricLine(
  time: number,
  original: string
): Promise<LyricLine> {
  return buildLyricLineWithReader(
    time,
    original,
    getLocalJapaneseReadingWithTokens
  );
}

async function buildLyricLineWithReader(
  time: number,
  original: string,
  reader: typeof getJapaneseReadingWithTokens
): Promise<LyricLine> {
  let reading = original;
  let tokens: TokenLite[] = [];

  try {
    const readingResult = await reader(original);
    reading = readingResult.reading;
    tokens = readingResult.tokens;

    if (DEBUG_READING_LOGS) {
      console.log("[LyriKana] reading:", {
        original,
        reading,
        tokens,
      });
    }
  } catch (err) {
    if (DEBUG_READING_LOGS) {
      console.error("[LyriKana] reading fallback:", err);
    }
    reading = original;
    tokens = [];
  }

  const pronunciation = buildPronunciation(reading, original, tokens);

  return {
    time,
    original,
    reading: pronunciation.reading,
    kr: pronunciation.kr,
    jp: pronunciation.jp,
    en: pronunciation.en,
  };
}
