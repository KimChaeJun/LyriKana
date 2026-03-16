import {
  detectSpecialReadingCase,
  type TokenLite,
} from "./specialReadingRules";

declare const kuromoji: any;

let tokenizerPromise: Promise<any> | null = null;
const readingCache = new Map<string, ReadingResult>();

const FURIGANA_PROXY_URL =
  "https://lyrikana-furigana-worker.kimchaejun1010.workers.dev";
const YAHOO_TIMEOUT_MS = 2500;

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

function resolveTokenReading(token: any): string {
  const surface = token.surface_form ?? "";
  const reading = token.reading && token.reading !== "*" ? token.reading : "";
  const pronunciation =
    token.pronunciation && token.pronunciation !== "*" ? token.pronunciation : "";
  const pos = token.pos ?? "";

  // 조사 가나는 pronunciation 우선
  if (pos === "助詞") {
    if (surface === "は" && pronunciation) {
      return normalizeReadingText(pronunciation);
    }
    if (surface === "へ" && pronunciation) {
      return normalizeReadingText(pronunciation);
    }
    if (surface === "を") {
      return "を";
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

function getCounterCompoundReading(
  current: TokenLite,
  next: TokenLite | undefined
): { reading: string; consumeNext: boolean } | null {
  if (!next) return null;

  const pair = `${current.surface}${next.surface}`;

  const pairMap: Record<string, string> = {
    一人: "ひとり",
    二人: "ふたり",
    一回: "いっかい",
    一階: "いっかい",
    一分: "いっぷん",
    一本: "いっぽん",
    一杯: "いっぱい",
    一匹: "いっぴき",
  };

  if (pair in pairMap) {
    return {
      reading: pairMap[pair],
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

    const counterCompound = getCounterCompoundReading(current, next);
    if (counterCompound) {
      out.push(counterCompound.reading);
      if (counterCompound.consumeNext) {
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
  if (original.length > 24) {
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

function breaksParticleWaCase(
  tokens: TokenLite[],
  localReading: string,
  yahooReading: string
): boolean {
  const local = normalizeReadingText(localReading);
  const yahoo = normalizeReadingText(yahooReading);

  for (const token of tokens) {
    if (
      token.surface === "は" &&
      token.pos === "助詞" &&
      token.pronunciation === "ワ"
    ) {
      if (local.includes("わ") && !yahoo.includes("わ")) {
        return true;
      }
    }
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
  if (breaksParticleWaCase(tokens, local, yahoo)) return false;

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
    return cached;
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
        yahooReading,
        tokens
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

  const result = {
    reading: finalReading,
    tokens,
  };

  readingCache.set(normalized, result);

  console.log("[LyriKana] final reading:", {
    original: normalized,
    localReading,
    finalReading,
  });

  return result;
}