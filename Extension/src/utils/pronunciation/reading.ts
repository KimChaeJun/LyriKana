let tokenizerPromise: Promise<any> | null = null;
const readingCache = new Map<string, string>();

const FURIGANA_PROXY_URL =
  "https://lyrikana-furigana-worker.kimchaejun1010.workers.dev";

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

function looksSuspicious(original: string, localReading: string): boolean {
  if (!hasKanji(original)) return false;

  const normalized = normalizeReadingText(localReading);

  if (original.includes("愛お") && normalized.includes("あいお")) return true;
  if (original.includes("被って") && /こう|こー/.test(normalized)) return true;
  if (hasKanji(original) && normalized === katakanaToHiragana(original)) return true;

  return false;
}

function resolveTokenReading(token: any): string {
  const surface = token.surface_form ?? "";
  const reading = token.reading && token.reading !== "*" ? token.reading : "";
  const pronunciation =
    token.pronunciation && token.pronunciation !== "*" ? token.pronunciation : "";

  if (isKana(surface)) {
    return katakanaToHiragana(surface);
  }

  const raw = reading || pronunciation || surface;
  return normalizeReadingText(raw);
}

function flattenYahooWords(words: any[]): string {
  return words
    .map((word) => {
      if (word.subword && Array.isArray(word.subword)) {
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
      headers: { "Content-Type": "application/json" },
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

export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji global not loaded"));
        return;
      }

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

          resolve(tokenizer);
        });
    });
  }

  return tokenizerPromise;
}

async function getLocalReading(text: string): Promise<string> {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);

  console.log(
    "[LyriKana] token debug",
    tokens.map((token: any) => ({
      surface: token.surface_form,
      basic: token.basic_form,
      reading: token.reading,
      pronunciation: token.pronunciation,
      pos: token.pos,
    }))
  );

  return tokens.map((token: any) => resolveTokenReading(token)).join("");
}

export async function getJapaneseReading(text: string): Promise<string> {
  const normalized = text.trim();
  if (!normalized) return "";

  const cached = readingCache.get(normalized);
  if (cached) return cached;

  const localReading = await getLocalReading(normalized);
  let finalReading = localReading;

  if (looksSuspicious(normalized, localReading)) {
    const yahooReading = await getYahooReading(normalized);
    if (yahooReading) {
      finalReading = yahooReading;
    }
  }

  finalReading = normalizeReadingText(finalReading);
  readingCache.set(normalized, finalReading);

  console.log("[LyriKana] final reading:", {
    original: normalized,
    localReading,
    finalReading,
  });

  return finalReading;
}