import type { TokenLite } from "./specialReadingRules";

const PARTICLE_SPOKEN_READING: Record<string, string> = {
  は: "わ",
  へ: "え",
  を: "を",
};

function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function isKana(text: string): boolean {
  return /^[ぁ-んァ-ヶー]+$/.test(text);
}

function isBoundarySurface(text: string): boolean {
  return /^[\p{P}\p{S}\s]+$/u.test(text);
}

function lastIndexOfBefore(
  text: string,
  searchValues: string[],
  endExclusive: number
): { index: number; value: string } | null {
  let best: { index: number; value: string } | null = null;

  for (const value of searchValues) {
    if (!value) continue;
    const index = text.lastIndexOf(value, Math.max(0, endExclusive - value.length));
    if (index < 0 || index + value.length > endExclusive) continue;
    if (!best || index > best.index) best = { index, value };
  }

  return best;
}

function rewriteParticleReadings(
  reading: string,
  tokens: TokenLite[],
  target: "display" | "spoken"
): string {
  let rewritten = katakanaToHiragana(reading);
  let cursor = rewritten.length;

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const surface = katakanaToHiragana(token.surface ?? "");
    if (!surface) continue;

    const isPronouncedParticle =
      token.pos === "助詞" && surface in PARTICLE_SPOKEN_READING;
    const tokenReading = katakanaToHiragana(
      token.reading && token.reading !== "*" ? token.reading : ""
    );
    const tokenPronunciation = katakanaToHiragana(
      token.pronunciation && token.pronunciation !== "*"
        ? token.pronunciation
        : ""
    );
    const spoken = PARTICLE_SPOKEN_READING[surface];
    const searchValues = isPronouncedParticle
      ? [...new Set([surface, spoken, tokenPronunciation])]
      : isKana(surface) || isBoundarySurface(surface)
        ? [surface]
        : [...new Set([tokenReading, tokenPronunciation])];
    const match = lastIndexOfBefore(rewritten, searchValues, cursor);
    if (!match) continue;

    const replacement = isPronouncedParticle
      ? target === "display"
        ? surface
        : spoken
      : match.value;
    rewritten =
      rewritten.slice(0, match.index) +
      replacement +
      rewritten.slice(match.index + match.value.length);
    cursor = match.index;
  }

  return rewritten;
}

export function normalizeDisplayReading(
  reading: string,
  tokens: TokenLite[]
): string {
  return rewriteParticleReadings(reading, tokens, "display");
}

export function toSpokenReading(
  displayReading: string,
  tokens: TokenLite[]
): string {
  let rewritten = normalizeDisplayReading(displayReading, tokens);
  let cursor = rewritten.length;

  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    const surface = katakanaToHiragana(token.surface ?? "");
    const tokenReading = katakanaToHiragana(
      token.reading && token.reading !== "*"
        ? token.reading
        : isKana(surface)
          ? surface
          : ""
    );
    const tokenPronunciation = katakanaToHiragana(
      token.pronunciation && token.pronunciation !== "*"
        ? token.pronunciation
        : tokenReading
    );
    const isPronouncedParticle =
      token.pos === "助詞" && surface in PARTICLE_SPOKEN_READING;
    const spokenParticle = PARTICLE_SPOKEN_READING[surface];
    const searchValues = isPronouncedParticle
      ? [...new Set([surface, spokenParticle, tokenReading, tokenPronunciation])]
      : [
          ...new Set([
            tokenReading,
            tokenPronunciation,
            ...(isBoundarySurface(surface) ? [surface] : []),
          ]),
        ];
    const match = lastIndexOfBefore(rewritten, searchValues, cursor);
    if (!match) continue;

    const replacement = isPronouncedParticle
      ? spokenParticle
      : tokenPronunciation || match.value;
    rewritten =
      rewritten.slice(0, match.index) +
      replacement +
      rewritten.slice(match.index + match.value.length);
    cursor = match.index;
  }

  return rewritten;
}
