import {
  getJapaneseReadingWithTokens,
  getLocalJapaneseReadingWithTokens,
  type ReadingCandidate,
  type ReadingContext,
} from "./reading";
import { buildPronunciation } from "./converters";
import type { TokenLite } from "./specialReadingRules";

const DEBUG_READING_LOGS = false;

export type LyricLine = {
  time: number;
  original: string;
  reading: string;
  displayReading?: string;
  spokenReading?: string;
  readingSource?: string;
  readingConfidence?: number;
  readingCandidates?: ReadingCandidate[];
  lineNo?: number;
  kr: string;
  jp: string;
  en: string;
};

export async function buildLyricLine(
  time: number,
  original: string,
  context: ReadingContext = {}
): Promise<LyricLine> {
  return buildLyricLineWithReader(
    time,
    original,
    getJapaneseReadingWithTokens,
    context
  );
}

export async function buildFastLyricLine(
  time: number,
  original: string,
  context: ReadingContext = {}
): Promise<LyricLine> {
  return buildLyricLineWithReader(
    time,
    original,
    getLocalJapaneseReadingWithTokens,
    context
  );
}

async function buildLyricLineWithReader(
  time: number,
  original: string,
  reader: typeof getJapaneseReadingWithTokens,
  context: ReadingContext
): Promise<LyricLine> {
  let reading = original;
  let tokens: TokenLite[] = [];
  let selectedSource = "original-fallback";
  let confidence = 0;
  let candidates: ReadingCandidate[] = [];

  try {
    const readingResult = await reader(original, context);
    reading = readingResult.reading;
    tokens = readingResult.tokens;
    selectedSource = readingResult.selectedSource;
    confidence = readingResult.confidence;
    candidates = readingResult.candidates;

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
    displayReading: pronunciation.displayReading,
    spokenReading: pronunciation.spokenReading,
    readingSource: selectedSource,
    readingConfidence: confidence,
    readingCandidates: candidates,
    lineNo: context.lineNo,
    kr: pronunciation.kr,
    jp: pronunciation.jp,
    en: pronunciation.en,
  };
}
