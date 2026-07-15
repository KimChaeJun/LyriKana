import {
  detectSpecialReadingCase,
  type TokenLite,
} from "./specialReadingRules";
import {
  applyLyricReadingDictionary,
  getLyricCommonReading,
  resolveLyricReadingCandidates,
  stripExplicitLyricReadings,
} from "./lyricReadingDictionary";
import {
  normalizeDisplayReading,
  toSpokenReading,
} from "./readingVariants";
import { requestElectronData } from "../../api/electron";

declare const kuromoji: any;

let tokenizerPromise: Promise<any> | null = null;
const readingCache = new Map<string, ReadingResult>();
const DEBUG_READING_LOGS = false;

const FURIGANA_PROXY_URL =
  "https://lyrikana-furigana-worker.kimchaejun1010.workers.dev";
const YAHOO_TIMEOUT_MS = 2500;
const YAHOO_FALLBACK_MAX_LENGTH = 42;

export type ReadingContext = {
  songId?: string;
  lineNo?: number;
};

export type ReadingCandidate = {
  reading: string;
  spokenReading: string;
  source: string;
  score: number;
  reasons: string[];
  selected: boolean;
  surface?: string;
  spanStart?: number;
  spanEnd?: number;
};

export type ReadingResult = {
  reading: string;
  displayReading: string;
  spokenReading: string;
  tokens: TokenLite[];
  candidates: ReadingCandidate[];
  selectedSource: string;
  confidence: number;
};

function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function isKana(text: string): boolean {
  return /^[ぁ-んァ-ヶー]+$/.test(text);
}

function hasKanji(text: string): boolean {
  return /[一-龯々]/.test(text);
}

function countKanji(text: string): number {
  const matches = text.match(/[一-龯々]/g);
  return matches ? matches.length : 0;
}

function kanaAndAsciiOnly(text: string): string {
  return katakanaToHiragana(text).replace(/[^ぁ-んーa-zA-Z0-9]/g, "");
}

function normalizeReadingText(input: string): string {
  let out = katakanaToHiragana(input);

  out = out
    .replace(/こー/g, "こう")
    .replace(/そー/g, "そう")
    .replace(/とー/g, "とう")
    .replace(/のー/g, "のう")
    .replace(/ほー/g, "ほう")
    .replace(/もー/g, "もう")
    .replace(/よー/g, "よう")
    .replace(/ろー/g, "ろう")
    .replace(/ごー/g, "ごう")
    .replace(/ぞー/g, "ぞう")
    .replace(/どー/g, "どう")
    .replace(/ぼー/g, "ぼう")
    .replace(/ぽー/g, "ぽう")
    .replace(/きょー/g, "きょう")
    .replace(/ぎょー/g, "ぎょう")
    .replace(/しょー/g, "しょう")
    .replace(/じょー/g, "じょう")
    .replace(/ちょー/g, "ちょう")
    .replace(/にょー/g, "にょう")
    .replace(/ひょー/g, "ひょう")
    .replace(/びょー/g, "びょう")
    .replace(/ぴょー/g, "ぴょう")
    .replace(/みょー/g, "みょう")
    .replace(/りょー/g, "りょう")
    .replace(/しゅー/g, "しゅう")
    .replace(/じゅー/g, "じゅう")
    .replace(/ちゅー/g, "ちゅう")
    .replace(/にゅー/g, "にゅう")
    .replace(/ひゅー/g, "ひゅう")
    .replace(/びゅー/g, "びゅう")
    .replace(/ぴゅー/g, "ぴゅう")
    .replace(/みゅー/g, "みゅう")
    .replace(/りゅー/g, "りゅう");

  return out;
}

function applyLyricContextReadingOverrides(
  original: string,
  reading: string
): string {
  return applyLyricReadingDictionary(original, reading);
}

function countHiragana(text: string): number {
  const matches = text.match(/[ぁ-ん]/g);
  return matches ? matches.length : 0;
}

function resolveTokenReading(token: any): string {
  const surface = token.surface_form ?? "";
  const reading = token.reading && token.reading !== "*" ? token.reading : "";
  const pronunciation =
    token.pronunciation && token.pronunciation !== "*" ? token.pronunciation : "";

  // 표시용 히라가나는 조사도 원문 표기를 유지한다. 실제 발음은 별도로 만든다.
  if (isKana(surface)) {
    return katakanaToHiragana(surface);
  }

  // 한자/혼합 토큰은 reading 우선
  const raw = reading || pronunciation || surface;
  return normalizeReadingText(raw);
}

function flattenYahooWords(words: any[]): string {
  return words
    .map((word) => {
      if (Array.isArray(word.subword) && word.subword.length > 0) {
        return word.subword
          .map((sub: any) => sub.furigana || sub.surface || "")
          .join("");
      }

      return word.furigana || word.surface || "";
    })
    .join("");
}

async function getYahooReading(text: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), YAHOO_TIMEOUT_MS);

  try {
    const res = await fetch(FURIGANA_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });

    if (!res.ok) {
      if (DEBUG_READING_LOGS) {
        console.warn("[LyriKana] Yahoo proxy HTTP error:", res.status);
      }
      return null;
    }

    const data = await res.json();

    if (!data?.result?.word || !Array.isArray(data.result.word)) {
      if (DEBUG_READING_LOGS) {
        console.warn("[LyriKana] Yahoo proxy invalid response:", data);
      }
      return null;
    }

    const reading = normalizeReadingText(flattenYahooWords(data.result.word));

    if (DEBUG_READING_LOGS) {
      console.log("[LyriKana] Yahoo reading:", {
        original: text,
        reading,
      });
    }

    return reading || null;
  } catch (error) {
    if (DEBUG_READING_LOGS) {
      console.warn("[LyriKana] Yahoo reading fallback failed:", error);
    }
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function toTokenLite(token: any): TokenLite {
  return {
    surface: token.surface_form ?? "",
    basic: token.basic_form ?? "",
    reading: token.reading ?? "",
    pronunciation: token.pronunciation ?? "",
    pos: token.pos ?? "",
    wordType: token.word_type ?? "",
  };
}

export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji global not loaded"));
        return;
      }

      if (DEBUG_READING_LOGS) {
        console.log("[LyriKana] building kuromoji tokenizer");
      }

      kuromoji
        .builder({
          dicPath: chrome.runtime.getURL("dict") + "/",
        })
        .build((err: any, tokenizer: any) => {
          if (err) {
            if (DEBUG_READING_LOGS) {
              console.error("[LyriKana] tokenizer error:", err);
            }
            reject(err);
            return;
          }

          if (DEBUG_READING_LOGS) {
            console.log("[LyriKana] tokenizer ready");
          }
          resolve(tokenizer);
        });
    });
  }

  return tokenizerPromise;
}

function getKnownCompoundReading(
  current: TokenLite,
  next: TokenLite | undefined
): { reading: string; consumeNext: boolean } | null {
  const singleReading = getLyricCommonReading(current.surface);
  if (singleReading) {
    return {
      reading: singleReading,
      consumeNext: false,
    };
  }

  if (!next) return null;

  const pair = `${current.surface}${next.surface}`;
  const pairReading = getLyricCommonReading(pair);
  if (pairReading) {
    return {
      reading: pairReading,
      consumeNext: true,
    };
  }

  return null;
}

function buildLocalReadingFromTokens(tokens: TokenLite[]): string {
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i += 1) {
    const current = tokens[i];
    const next = tokens[i + 1];

    const knownCompound = getKnownCompoundReading(current, next);
    if (knownCompound) {
      out.push(knownCompound.reading);
      if (knownCompound.consumeNext) {
        i += 1;
      }
      continue;
    }

    out.push(
      resolveTokenReading({
        surface_form: current.surface,
        reading: current.reading,
        pronunciation: current.pronunciation,
        pos: current.pos,
      })
    );
  }

  return normalizeReadingText(out.join(""));
}

async function tokenizeAndBuildLocalReading(
  text: string
): Promise<{ reading: string; tokens: TokenLite[] }> {
  const tokenizer = await getTokenizer();
  const rawTokens = tokenizer.tokenize(text);
  const tokens = rawTokens.map((token: any) => toTokenLite(token));

  const debugTokens = tokens.map((token: TokenLite) => ({
    surface: token.surface,
    basic: token.basic,
    word_type: token.wordType,
    reading: token.reading,
    pronunciation: token.pronunciation,
    pos: token.pos,
  }));

  if (DEBUG_READING_LOGS) {
    console.log("[LyriKana] token debug", debugTokens);
  }

  const localReading = buildLocalReadingFromTokens(tokens);

  return {
    tokens,
    reading: localReading,
  };
}

function shouldTryYahooFallback(
  original: string,
  localReading: string,
  tokens: TokenLite[]
): { shouldTry: boolean; reasons: string[] } {
  if (!hasKanji(original)) {
    return { shouldTry: false, reasons: [] };
  }

  // 긴 줄까지 전부 Yahoo fallback 보내면 체감속도가 너무 느려짐
  if (original.length > YAHOO_FALLBACK_MAX_LENGTH) {
    return {
      shouldTry: false,
      reasons: ["skip yahoo fallback for long line"],
    };
  }

  const special = detectSpecialReadingCase(original, localReading, tokens);
  if (special.shouldFallback) {
    return {
      shouldTry: true,
      reasons: special.reasons,
    };
  }

  const kanjiCount = countKanji(original);
  const hasMixedScript =
    /[ぁ-んァ-ヶー]/.test(original) && hasKanji(original);

  if (kanjiCount > 0 && (hasMixedScript || kanjiCount >= 2)) {
    return {
      shouldTry: true,
      reasons: ["kanji lyric line uses Yahoo comparison for contextual reading"],
    };
  }

  return { shouldTry: false, reasons: [] };
}

async function postElectronReading<T>(
  path: string,
  payload: unknown
): Promise<T | null> {
  return requestElectronData<T>(path, payload);
}

async function getSudachiReading(text: string): Promise<string | null> {
  const result = await postElectronReading<{ reading?: string }>(
    "/reading/sudachi/analyze",
    { text, splitMode: "C" }
  );
  const reading = normalizeReadingText(result?.reading ?? "");

  if (reading) {
    if (DEBUG_READING_LOGS) {
      console.log("[LyriKana] Sudachi reading:", {
        original: text,
        reading,
      });
    }
  }

  return reading || null;
}

function createReadingCandidate(
  reading: string,
  tokens: TokenLite[],
  source: string,
  score: number,
  reasons: string[],
  selected = false,
  span?: { surface: string; start: number; end: number }
): ReadingCandidate {
  const displayReading = normalizeDisplayReading(
    normalizeReadingText(reading),
    tokens
  );
  return {
    reading: displayReading,
    spokenReading: toSpokenReading(displayReading, tokens),
    source,
    score,
    reasons,
    selected,
    ...(span
      ? {
          surface: span.surface,
          spanStart: span.start,
          spanEnd: span.end,
        }
      : {}),
  };
}

function saveReadingCandidate(
  original: string,
  candidate: ReadingCandidate,
  context: ReadingContext
): void {
  void postElectronReading("/reading/candidates/save", {
    original,
    engineVersion: 11,
    songId: context.songId ?? "",
    lineNo: context.lineNo ?? -1,
    spanStart: candidate.spanStart ?? -1,
    spanEnd: candidate.spanEnd ?? -1,
    source: candidate.source,
    reading: candidate.reading,
    spokenReading: candidate.spokenReading,
    kr: "",
    jp: "",
    en: "",
    score: candidate.score,
    confidence: candidate.score,
    reasons: candidate.reasons,
    selected: candidate.selected,
  });
}

function saveReadingCandidates(
  original: string,
  candidates: ReadingCandidate[],
  context: ReadingContext
): void {
  for (const candidate of candidates) {
    saveReadingCandidate(original, candidate, context);
  }
}

function finalizeReadingResult(
  original: string,
  reading: string,
  tokens: TokenLite[],
  analyzerCandidates: ReadingCandidate[],
  selectedSource: string,
  confidence: number
): ReadingResult {
  const dictionaryReading = normalizeDisplayReading(
    applyLyricContextReadingOverrides(original, normalizeReadingText(reading)),
    tokens
  );
  const lyricResolution = resolveLyricReadingCandidates(
    original,
    dictionaryReading
  );
  const displayReading = normalizeDisplayReading(
    lyricResolution.reading,
    tokens
  );
  const effectiveSource = lyricResolution.selected?.source ?? selectedSource;
  const effectiveConfidence = lyricResolution.selected?.score ?? confidence;

  const lyricCandidates = lyricResolution.candidates.map((candidate) =>
    createReadingCandidate(
      candidate.lineReading,
      tokens,
      candidate.source,
      candidate.score,
      candidate.reasons,
      candidate.source === effectiveSource &&
        normalizeDisplayReading(candidate.lineReading, tokens) === displayReading,
      {
        surface: candidate.surface,
        start: candidate.surfaceStart,
        end: candidate.surfaceEnd,
      }
    )
  );

  const candidates = [...analyzerCandidates, ...lyricCandidates].map(
    (candidate) => ({
      ...candidate,
      selected:
        candidate.source === effectiveSource &&
        candidate.reading === displayReading,
    })
  );

  if (!candidates.some((candidate) => candidate.selected)) {
    candidates.push(
      createReadingCandidate(
        displayReading,
        tokens,
        effectiveSource,
        effectiveConfidence,
        ["selected final reading"],
        true
      )
    );
  }

  return {
    reading: displayReading,
    displayReading,
    spokenReading: toSpokenReading(displayReading, tokens),
    tokens,
    candidates,
    selectedSource: effectiveSource,
    confidence: effectiveConfidence,
  };
}

export async function getLocalJapaneseReadingWithTokens(
  text: string,
  _context: ReadingContext = {}
): Promise<ReadingResult> {
  const normalized = text.trim();
  if (!normalized) {
    return {
      reading: "",
      displayReading: "",
      spokenReading: "",
      tokens: [],
      candidates: [],
      selectedSource: "empty",
      confidence: 1,
    };
  }

  const analysisText = stripExplicitLyricReadings(normalized);
  const { tokens, reading } = await tokenizeAndBuildLocalReading(analysisText);
  const localCandidate = createReadingCandidate(
    reading,
    tokens,
    "kuromoji",
    0.5,
    ["local morphological analysis"]
  );
  return finalizeReadingResult(
    normalized,
    reading,
    tokens,
    [localCandidate],
    "kuromoji",
    0.5
  );
}

function isSevereYahooShrink(localReading: string, yahooReading: string): boolean {
  const localHira = countHiragana(localReading);
  const yahooHira = countHiragana(yahooReading);

  return yahooHira + 1 < localHira;
}

function fixesAiOCase(localReading: string, yahooReading: string): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  return local.includes("あいお") && yahoo.includes("いとお");
}

function fixesKunyomiMismatch(localReading: string, yahooReading: string): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  if (local.includes("しつく") && yahoo.includes("なく")) return true;
  if (local.includes("あいお") && yahoo.includes("いとお")) return true;
  if ((local.includes("こうむ") || local.includes("こーむ")) && yahoo.includes("かぶ")) {
    return true;
  }
  if ((local.includes("ごに") || local.includes("のち")) && yahoo.includes("あと")) {
    return true;
  }

  return false;
}

function breaksAiSouCase(original: string, localReading: string, yahooReading: string): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  if (!original.includes("愛")) return false;

  if (local.includes("あい") && !yahoo.includes("あい")) {
    if (fixesAiOCase(local, yahoo)) {
      return false;
    }
    return true;
  }

  return false;
}

function fixesNumericCounterCase(localReading: string, yahooReading: string): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  const localBadPatterns = [
    "いちにん",
    "ににん",
    "いちかい",
    "いちほん",
    "いちふん",
    "いちはい",
    "いちひき",
  ];

  const yahooGoodHints = [
    "ひとり",
    "ふたり",
    "いっかい",
    "いっぽん",
    "いっぷん",
    "いっぱい",
    "いっぴき",
  ];

  return (
    localBadPatterns.some((pattern) => local.includes(pattern)) &&
    yahooGoodHints.some((pattern) => yahoo.includes(pattern))
  );
}

function hasAdjacentSingleKanjiNounSplit(tokens: TokenLite[]): boolean {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    const afterNext = tokens[index + 2];

    const currentIsSingleKanjiNoun =
      current.surface.length === 1 && hasKanji(current.surface) && current.pos === "名詞";
    const nextIsSingleKanjiNoun =
      next.surface.length === 1 && hasKanji(next.surface) && next.pos === "名詞";
    const followedByParticleOrEnd = !afterNext || afterNext.pos === "助詞";

    if (currentIsSingleKanjiNoun && nextIsSingleKanjiNoun && followedByParticleOrEnd) {
      return true;
    }
  }

  return false;
}

function shouldPreferYahooReading(
  original: string,
  localReading: string,
  yahooReading: string,
  tokens: TokenLite[]
): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  if (!yahoo) return false;

  if (fixesAiOCase(local, yahoo)) return true;
  if (fixesNumericCounterCase(local, yahoo)) return true;
  if (fixesKunyomiMismatch(local, yahoo)) return true;

  if (isSevereYahooShrink(local, yahoo)) return false;
  if (breaksAiSouCase(original, local, yahoo)) return false;
  if (hasAdjacentSingleKanjiNounSplit(tokens) && local !== yahoo) return true;

  if (hasKanji(original) && local !== yahoo) {
    const localShape = kanaAndAsciiOnly(local);
    const yahooShape = kanaAndAsciiOnly(yahoo);

    if (yahooShape.length >= Math.max(1, localShape.length - 1)) {
      return true;
    }
  }

  return false;
}

export async function getJapaneseReading(
  text: string,
  context: ReadingContext = {}
): Promise<string> {
  const result = await getJapaneseReadingWithTokens(text, context);
  return result.reading;
}

export async function getJapaneseReadingWithTokens(
  text: string,
  context: ReadingContext = {}
): Promise<ReadingResult> {
  const normalized = text.trim();
  if (!normalized) {
    return {
      reading: "",
      displayReading: "",
      spokenReading: "",
      tokens: [],
      candidates: [],
      selectedSource: "empty",
      confidence: 1,
    };
  }

  const cached = readingCache.get(normalized);
  if (cached) {
    saveReadingCandidates(normalized, cached.candidates, context);
    return cached;
  }

  const analysisText = stripExplicitLyricReadings(normalized);
  const { tokens, reading: localReading } =
    await tokenizeAndBuildLocalReading(analysisText);

  const normalizedLocalReading = normalizeDisplayReading(localReading, tokens);
  let finalReading = normalizedLocalReading;
  let selectedSource = "kuromoji";
  let confidence = 0.5;
  const analyzerCandidates: ReadingCandidate[] = [
    createReadingCandidate(
      normalizedLocalReading,
      tokens,
      "kuromoji",
      0.5,
      ["local morphological analysis"]
    ),
  ];

  const fallbackDecision = shouldTryYahooFallback(
    analysisText,
    normalizedLocalReading,
    tokens
  );

  if (fallbackDecision.shouldTry) {
    if (DEBUG_READING_LOGS) {
        console.log("[LyriKana] special reading fallback:", {
          original: normalized,
          localReading: normalizedLocalReading,
          reasons: fallbackDecision.reasons,
        });
      }

    const rawSudachiReading = await getSudachiReading(analysisText);
    const sudachiReading = rawSudachiReading
      ? normalizeDisplayReading(rawSudachiReading, tokens)
      : null;

    if (sudachiReading) {
      const useSudachi = shouldPreferYahooReading(
        analysisText,
        normalizedLocalReading,
        sudachiReading,
        tokens
      );

      if (DEBUG_READING_LOGS) {
        console.log("[LyriKana] Sudachi comparison:", {
          original: normalized,
          localReading: normalizedLocalReading,
          sudachiReading,
          useSudachi,
        });
      }

      analyzerCandidates.push(
        createReadingCandidate(
          sudachiReading,
          tokens,
        "sudachi",
          useSudachi ? 0.65 : 0.35,
          fallbackDecision.reasons
        )
      );

      if (useSudachi) {
        finalReading = sudachiReading;
        selectedSource = "sudachi";
        confidence = 0.65;
      }
    }

    const rawYahooReading = await getYahooReading(analysisText);
    const yahooReading = rawYahooReading
      ? normalizeDisplayReading(rawYahooReading, tokens)
      : null;

    if (yahooReading) {
      const useYahoo = shouldPreferYahooReading(
        analysisText,
        finalReading,
        yahooReading,
        tokens
      );

      if (DEBUG_READING_LOGS) {
        console.log("[LyriKana] fallback comparison:", {
          original: normalized,
          currentReading: finalReading,
          yahooReading,
          useYahoo,
        });
      }

      analyzerCandidates.push(
        createReadingCandidate(
          yahooReading,
          tokens,
          "yahoo",
          useYahoo ? 0.65 : 0.35,
          fallbackDecision.reasons
        )
      );

      if (useYahoo) {
        finalReading = yahooReading;
        selectedSource = "yahoo";
        confidence = 0.65;
      }
    }
  }

  const result = finalizeReadingResult(
    normalized,
    finalReading,
    tokens,
    analyzerCandidates,
    selectedSource,
    confidence
  );

  readingCache.set(normalized, result);
  saveReadingCandidates(normalized, result.candidates, context);

  if (DEBUG_READING_LOGS) {
    console.log("[LyriKana] final reading:", {
      original: normalized,
      localReading: normalizedLocalReading,
      displayReading: result.displayReading,
      spokenReading: result.spokenReading,
      selectedSource: result.selectedSource,
    });
  }

  return result;
}
