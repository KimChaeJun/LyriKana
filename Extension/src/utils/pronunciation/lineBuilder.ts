import { buildPronunciation } from "./converters.ts";
import { getJapaneseReading } from "./reading.ts";

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
  const reading = await getJapaneseReading(original);
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