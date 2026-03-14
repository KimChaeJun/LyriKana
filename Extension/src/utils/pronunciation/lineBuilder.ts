import { getJapaneseReadingWithTokens } from "./reading";
import { buildPronunciation } from "./converters";
import type { TokenLite } from "./specialReadingRules";

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
  let reading = original;
  let tokens: TokenLite[] = [];

  try {
    const readingResult = await getJapaneseReadingWithTokens(original);
    reading = readingResult.reading;
    tokens = readingResult.tokens;

    console.log("[LyriKana] reading:", {
      original,
      reading,
      tokens,
    });
  } catch (err) {
    console.error("[LyriKana] reading fallback:", err);
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