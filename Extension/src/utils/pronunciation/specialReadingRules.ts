export type TokenLite = {
  surface: string;
  basic?: string;
  reading?: string;
  pronunciation?: string;
  pos?: string;
  wordType?: string;
};

export type SpecialReadingCheckResult = {
  shouldFallback: boolean;
  reasons: string[];
};

function normalize(text: string): string {
  return text.replace(/\s+/g, "");
}

function isKanjiChar(ch: string): boolean {
  return /[一-龯々]/.test(ch);
}

function isSingleKanji(text: string): boolean {
  return text.length === 1 && isKanjiChar(text);
}

function hasKanji(text: string): boolean {
  return /[一-龯々]/.test(text);
}

function hasOkuriganaPattern(text: string): boolean {
  return /[一-龯々][ぁ-ん]/.test(text);
}

function isHiragana(text: string): boolean {
  return /^[ぁ-んー]+$/.test(text);
}

function isParticleToken(token: TokenLite | undefined): boolean {
  return token?.pos === "助詞";
}

function isNounToken(token: TokenLite | undefined): boolean {
  return token?.pos === "名詞";
}

function isVerbOrAdjToken(token: TokenLite | undefined): boolean {
  return token?.pos === "動詞" || token?.pos === "形容詞";
}

function isDemonstrative(text: string): boolean {
  return /^(この|その|あの|どの)$/.test(text);
}

function isNumericKanji(text: string): boolean {
  return /^[一二三四五六七八九十百千万何]$/.test(text);
}

function isCounterLikeKanji(text: string): boolean {
  return /^(人|回|本|分|杯|階|匹|枚|歳|才|時|軒|着|羽|足|個|曲|冊|発)$/.test(
    text
  );
}

function readingLikeSeparateOnyomi(reading: string): boolean {
  const r = normalize(reading);

  return (
    r.includes("いちにん") ||
    r.includes("ににん") ||
    r.includes("さんにん") ||
    r.includes("よんにん") ||
    r.includes("しちにん") ||
    r.includes("くにん") ||
    r.includes("いちかい") ||
    r.includes("いちほん") ||
    r.includes("いちふん") ||
    r.includes("いちはい") ||
    r.includes("いちかい") ||
    r.includes("いちひき") ||
    r.includes("いちまい") ||
    r.includes("いちさい") ||
    r.includes("いちじ") ||
    r.includes("いっかい") === false && r.includes("いちかい")
  );
}

function detectSpecialPersonReading(
  original: string,
  localReading: string,
  tokens: TokenLite[]
): string[] {
  const reasons: string[] = [];

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];

    if (
      isNumericKanji(a.surface) &&
      b.surface === "人" &&
      isNounToken(a) &&
      isNounToken(b)
    ) {
      if (readingLikeSeparateOnyomi(localReading)) {
        reasons.push("numeric-kanji + 人 was split into separate onyomi tokens");
      } else {
        reasons.push("numeric-kanji + 人 compound may need contextual person reading");
      }
    }
  }

  if (original.includes("一人") && normalize(localReading).includes("いちにん")) {
    reasons.push("一人 is commonly ひとり in context");
  }

  if (original.includes("二人") && normalize(localReading).includes("ににん")) {
    reasons.push("二人 is commonly ふたり in context");
  }

  return reasons;
}

function detectNumericCounterReadingMismatch(
  original: string,
  localReading: string,
  tokens: TokenLite[]
): string[] {
  const reasons: string[] = [];
  const r = normalize(localReading);

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];

    if (
      isNumericKanji(a.surface) &&
      isCounterLikeKanji(b.surface) &&
      isNounToken(a) &&
      isNounToken(b)
    ) {
      reasons.push(
        `numeric-kanji + counter split detected (${a.surface}${b.surface})`
      );

      if (readingLikeSeparateOnyomi(r)) {
        reasons.push(
          `numeric-kanji + counter reading looks like rigid onyomi (${a.surface}${b.surface})`
        );
      }
    }
  }

  // line-level 대표 케이스
  if (original.includes("一回") && r.includes("いちかい")) {
    reasons.push("一回 is commonly いっかい, not いちかい");
  }
  if (original.includes("一分") && r.includes("いちふん")) {
    reasons.push("一分 is commonly いっぷん in counting contexts");
  }
  if (original.includes("一本") && r.includes("いちほん")) {
    reasons.push("一本 is commonly いっぽん, not いちほん");
  }
  if (original.includes("一杯") && r.includes("いちはい")) {
    reasons.push("一杯 is commonly いっぱい, not いちはい");
  }
  if (original.includes("一匹") && r.includes("いちひき")) {
    reasons.push("一匹 is commonly いっぴき, not いちひき");
  }
  if (original.includes("一階") && r.includes("いちかい")) {
    reasons.push("一階 is commonly いっかい, not いちかい");
  }

  return reasons;
}

function detectKanjiOkuriganaMismatch(
  localReading: string,
  tokens: TokenLite[]
): string[] {
  const reasons: string[] = [];

  for (const token of tokens) {
    const surface = token.surface ?? "";
    const reading = normalize(token.reading ?? "");
    const pronunciation = normalize(token.pronunciation ?? "");

    if (!surface || !hasOkuriganaPattern(surface)) continue;
    if (!isVerbOrAdjToken(token)) continue;

    reasons.push(`kanji+okurigana ${surface} may need kunyomi/contextual reading`);

    if (
      reading.startsWith("シツ") ||
      pronunciation.startsWith("シツ") ||
      reading.startsWith("アイ") ||
      pronunciation.startsWith("アイ")
    ) {
      reasons.push(`kanji+okurigana ${surface} looks like rigid onyomi output`);
    }
  }

  const r = normalize(localReading);
  if (r.includes("しつく")) {
    reasons.push("reading contains しつく pattern, often suspicious for 失く...");
  }
  if (r.includes("あいお")) {
    reasons.push("reading contains あいお pattern, often suspicious for 愛お...");
  }

  return reasons;
}

function detectDemonstrativeContextNounMismatch(tokens: TokenLite[]): string[] {
  const reasons: string[] = [];

  for (let i = 1; i < tokens.length; i += 1) {
    const prev = tokens[i - 1];
    const current = tokens[i];

    if (!isDemonstrative(prev.surface)) continue;
    if (!hasKanji(current.surface)) continue;
    if (!isNounToken(current)) continue;

    reasons.push(
      `demonstrative + kanji noun pattern (${prev.surface}${current.surface}) may need contextual reading`
    );
  }

  return reasons;
}

function detectSingleKanjiNounSplit(tokens: TokenLite[]): string[] {
  const reasons: string[] = [];

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    const next = tokens[i + 2];

    if (
      isSingleKanji(a.surface) &&
      isSingleKanji(b.surface) &&
      isNounToken(a) &&
      isNounToken(b)
    ) {
      if (isParticleToken(next) || !next) {
        reasons.push(
          `adjacent single-kanji noun split (${a.surface}+${b.surface}) may hide a compound reading`
        );
      }
    }
  }

  return reasons;
}

function detectReadingShapeMismatch(
  original: string,
  localReading: string,
  tokens: TokenLite[]
): string[] {
  const reasons: string[] = [];
  const o = normalize(original);
  const r = normalize(localReading);

  if (!hasKanji(o)) return reasons;

  if (o.includes("後") && (r.includes("ご") || r.includes("のち"))) {
    reasons.push("後 may require contextual reading like あと");
  }

  if (o.includes("被って") && (r.includes("こう") || r.includes("こー"))) {
    reasons.push("被って may be incorrectly pushed toward こうむ...");
  }

  const kanjiNounTokens = tokens.filter(
    (token) => hasKanji(token.surface) && isNounToken(token)
  );

  if (kanjiNounTokens.length >= 2 && isHiragana(r)) {
    reasons.push("multiple kanji noun tokens may need compound/contextual reading");
  }

  return reasons;
}

export function detectSpecialReadingCase(
  original: string,
  localReading: string,
  tokens: TokenLite[]
): SpecialReadingCheckResult {
  const reasons = [
    ...detectSpecialPersonReading(original, localReading, tokens),
    ...detectNumericCounterReadingMismatch(original, localReading, tokens),
    ...detectKanjiOkuriganaMismatch(localReading, tokens),
    ...detectDemonstrativeContextNounMismatch(tokens),
    ...detectSingleKanjiNounSplit(tokens),
    ...detectReadingShapeMismatch(original, localReading, tokens),
  ];

  const uniqueReasons = [...new Set(reasons)];

  return {
    shouldFallback: uniqueReasons.length > 0,
    reasons: uniqueReasons,
  };
}