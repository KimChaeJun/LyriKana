import { getJapaneseReading } from "./reading";
import { buildPronunciation } from "./converters";

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

    console.log("[LyriKana] reading:", {
      original,
      reading,
    });
  } catch (err) {
    console.error("[LyriKana] reading fallback:", err);
    reading = original;
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