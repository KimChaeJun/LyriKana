import { buildPronunciation } from "./converters";
import { getJapaneseReading } from "./reading";

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

  try {
    reading = await getJapaneseReading(original);
  } catch (error) {
    console.error("[LyriKana] reading fallback used:", {
      original,
      error,
    });
  }

  const pronunciation = buildPronunciation(reading);

  return {
    time,
    original,
    reading: pronunciation.reading,
    kr: pronunciation.kr,
    jp: pronunciation.jp,
    en: pronunciation.en,
  };
}