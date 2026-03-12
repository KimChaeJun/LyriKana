let tokenizerPromise: Promise<any> | null = null;
const readingCache = new Map<string, string>();

function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function isKana(text: string): boolean {
  return /^[ぁ-んァ-ヶー]+$/.test(text);
}

export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji global is not loaded"));
        return;
      }

      console.log("[LyriKana] building kuromoji tokenizer");

      kuromoji
        .builder({
          dicPath: chrome.runtime.getURL("dict") + "/",
        })
        .build((err: any, tokenizer: any) => {
          if (err) {
            console.error("[LyriKana] kuromoji tokenizer error:", err);
            reject(err);
            return;
          }

          console.log("[LyriKana] kuromoji tokenizer ready");
          resolve(tokenizer);
        });
    });
  }

  return tokenizerPromise;
}

export async function getJapaneseReading(text: string): Promise<string> {
  const normalized = text.trim();
  if (!normalized) return "";

  const cached = readingCache.get(normalized);
  if (cached) return cached;

  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(normalized);

  const reading = tokens
    .map((token: any) => {
      const raw =
        token.pronunciation && token.pronunciation !== "*"
          ? token.pronunciation
          : token.reading && token.reading !== "*"
            ? token.reading
            : token.surface_form ?? "";

      if (isKana(raw)) {
        return katakanaToHiragana(raw);
      }

      if (!isKana(raw) && /[一-龯々]/.test(raw)) {
        console.log("[LyriKana] unresolved kanji token:", token);
      }

      return raw;
    })
    .join("");

  readingCache.set(normalized, reading);

  return reading;
}