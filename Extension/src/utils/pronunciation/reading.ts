let tokenizerPromise: Promise<any> | null = null;

function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

export function getTokenizer() {
  if (!tokenizerPromise) {
    tokenizerPromise = new Promise((resolve, reject) => {
      if (typeof kuromoji === "undefined") {
        reject(new Error("kuromoji global is not loaded"));
        return;
      }

      kuromoji
        .builder({
          dicPath: chrome.runtime.getURL("dict") + "/",
        })
        .build((err: any, tokenizer: any) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(tokenizer);
        });
    });
  }

  return tokenizerPromise;
}

export async function getJapaneseReading(text: string): Promise<string> {
  const tokenizer = await getTokenizer();
  const tokens = tokenizer.tokenize(text);

  return tokens
    .map((token: any) => {
      if (token.reading && token.reading !== "*") {
        return katakanaToHiragana(token.reading);
      }
      return token.surface_form ?? "";
    })
    .join("");
}