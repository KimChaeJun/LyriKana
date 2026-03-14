import {
  detectSpecialReadingCase,
  type TokenLite,
} from "./specialReadingRules";

declare const kuromoji: any;

let tokenizerPromise: Promise<any> | null = null;
const readingCache = new Map<string, string>();

const FURIGANA_PROXY_URL =
  "https://lyrikana-furigana-worker.kimchaejun1010.workers.dev";

export type ReadingResult = {
  reading: string;
  tokens: TokenLite[];
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

function countHiragana(text: string): number {
  const matches = text.match(/[ぁ-ん]/g);
  return matches ? matches.length : 0;
}

function countKanji(text: string): number {
  const matches = text.match(/[一-龯々]/g);
  return matches ? matches.length : 0;
}

function resolveTokenReading(token: any): string {
  const surface = token.surface_form ?? "";
  const reading = token.reading && token.reading !== "*" ? token.reading : "";
  const pronunciation =
    token.pronunciation && token.pronunciation !== "*" ? token.pronunciation : "";
  const pos = token.pos ?? "";

  // 조사 가나는 pronunciation 우선
  // は -> わ, へ -> え 같은 실제 발음 반영
  if (pos === "助詞") {
    if (surface === "は" && pronunciation) {
      return normalizeReadingText(pronunciation);
    }
    if (surface === "へ" && pronunciation) {
      return normalizeReadingText(pronunciation);
    }
    if (surface === "を" && pronunciation) {
      return normalizeReadingText(pronunciation);
    }
  }

  // 일반 가나 토큰은 원문 유지
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
  try {
    const res = await fetch(FURIGANA_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      console.warn("[LyriKana] Yahoo proxy HTTP error:", res.status);
      return null;
    }

    const data = await res.json();

    if (!data?.result?.word || !Array.isArray(data.result.word)) {
      console.warn("[LyriKana] Yahoo proxy invalid response:", data);
      return null;
    }

    const reading = normalizeReadingText(flattenYahooWords(data.result.word));

    console.log("[LyriKana] Yahoo reading:", {
      original: text,
      reading,
    });

    return reading || null;
  } catch (error) {
    console.warn("[LyriKana] Yahoo reading fallback failed:", error);
    return null;
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

      console.log("[LyriKana] building kuromoji tokenizer");

      kuromoji
        .builder({
          dicPath: chrome.runtime.getURL("dict") + "/",
        })
        .build((err: any, tokenizer: any) => {
          if (err) {
            console.error("[LyriKana] tokenizer error:", err);
            reject(err);
            return;
          }

          console.log("[LyriKana] tokenizer ready");
          resolve(tokenizer);
        });
    });
  }

  return tokenizerPromise;
}

async function tokenizeAndBuildLocalReading(text: string): Promise<ReadingResult> {
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

  console.log("[LyriKana] token debug", debugTokens);

  const localReading = rawTokens
    .map((token: any) => resolveTokenReading(token))
    .join("");

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

  const special = detectSpecialReadingCase(original, localReading, tokens);
  if (special.shouldFallback) {
    return {
      shouldTry: true,
      reasons: special.reasons,
    };
  }

  const normalized = normalizeReadingText(localReading);

  if (normalized === katakanaToHiragana(original)) {
    return {
      shouldTry: true,
      reasons: ["reading looks too close to raw surface text"],
    };
  }

  return { shouldTry: false, reasons: [] };
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

function breaksAiSouCase(original: string, localReading: string, yahooReading: string): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  if (!original.includes("愛")) return false;

  // 愛そう / 愛せ / 愛し  등에서 로컬의 あい 계열 정보가
  // Yahoo 결과에서 통째로 사라지면 reject
  if (local.includes("あい") && !yahoo.includes("あい")) {
    // 단, 愛お -> いとお 같은 정상 교정은 예외
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
    "いちまい",
    "いちさい",
    "いちじ",
  ];

  const yahooGoodHints = [
    "ひとり",
    "ふたり",
    "いっかい",
    "いっぽん",
    "いっぷん",
    "いっぱい",
    "いっぴき",
    "いちまい",
    "いっさい",
    "いちじ",
  ];

  return (
    localBadPatterns.some((pattern) => local.includes(pattern)) &&
    yahooGoodHints.some((pattern) => yahoo.includes(pattern))
  );
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

function shouldPreferYahooReading(
  original: string,
  localReading: string,
  yahooReading: string
): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  if (!yahoo) return false;

  // 1. Yahoo가 명백히 문제를 고쳤으면 우선 채택
  if (fixesAiOCase(local, yahoo)) return true;
  if (fixesNumericCounterCase(local, yahoo)) return true;
  if (fixesKunyomiMismatch(local, yahoo)) return true;

  // 2. Yahoo가 정보를 날렸으면 reject
  if (isSevereYahooShrink(local, yahoo)) return false;
  if (breaksAiSouCase(original, local, yahoo)) return false;

  // 3. 한자 포함 줄에서 Yahoo가 길이 유지 + local보다 덜 기계적이면 채택 가능
  const localKanjiCount = countKanji(original);
  if (localKanjiCount > 0 && yahoo.length >= local.length - 1) {
    return true;
  }

  return false;
}

export async function getJapaneseReading(text: string): Promise<string> {
  const result = await getJapaneseReadingWithTokens(text);
  return result.reading;
}

export async function getJapaneseReadingWithTokens(
  text: string
): Promise<ReadingResult> {
  const normalized = text.trim();
  if (!normalized) {
    return { reading: "", tokens: [] };
  }

  const cached = readingCache.get(normalized);
  if (cached) {
    const tokenizer = await getTokenizer();
    const rawTokens = tokenizer.tokenize(normalized);
    const tokens = rawTokens.map((token: any) => toTokenLite(token));

    return {
      reading: cached,
      tokens,
    };
  }

  const { tokens, reading: localReading } =
    await tokenizeAndBuildLocalReading(normalized);

  let finalReading = localReading;

  const fallbackDecision = shouldTryYahooFallback(
    normalized,
    localReading,
    tokens
  );

  if (fallbackDecision.shouldTry) {
    console.log("[LyriKana] special reading fallback:", {
      original: normalized,
      localReading,
      reasons: fallbackDecision.reasons,
    });

    const yahooReading = await getYahooReading(normalized);

    if (yahooReading) {
      const useYahoo = shouldPreferYahooReading(
        normalized,
        localReading,
        yahooReading
      );

      console.log("[LyriKana] fallback comparison:", {
        original: normalized,
        localReading,
        yahooReading,
        useYahoo,
      });

      finalReading = useYahoo ? yahooReading : localReading;
    }
  }

  finalReading = normalizeReadingText(finalReading);
  readingCache.set(normalized, finalReading);

  console.log("[LyriKana] final reading:", {
    original: normalized,
    localReading,
    finalReading,
  });

  return {
    reading: finalReading,
    tokens,
  };
}