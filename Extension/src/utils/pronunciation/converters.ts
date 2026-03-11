import {
  DIGRAPH_KANA,
  KANA_TO_EN,
  KANA_TO_JP,
  KANA_TO_KR,
} from "./kanaMaps";
import { toHiragana } from "./normalizeKana";

type PronunciationMode = "KR" | "JP" | "EN";

function isSmallTsu(char: string): boolean {
  return char === "っ";
}

function isLongVowelMark(char: string): boolean {
  return char === "ー";
}

function getNextUnit(text: string, index: number): { unit: string; nextIndex: number } {
  const twoChar = text.slice(index, index + 2);

  if (DIGRAPH_KANA.includes(twoChar)) {
    return { unit: twoChar, nextIndex: index + 2 };
  }

  return { unit: text[index], nextIndex: index + 1 };
}

function getMap(mode: PronunciationMode): Record<string, string> {
  if (mode === "KR") return KANA_TO_KR;
  if (mode === "EN") return KANA_TO_EN;
  return KANA_TO_JP;
}

function getInitialConsonantForSokuon(unit: string, mode: PronunciationMode): string {
  const base = mode === "KR"
    ? KANA_TO_KR[unit]
    : mode === "EN"
      ? KANA_TO_EN[unit]
      : KANA_TO_JP[unit];

  if (!base) return "";

  if (mode === "KR") {
    const first = base[0];
    const allowed = ["ㄱ", "ㄲ", "ㅋ", "ㅅ", "ㅆ", "ㅈ", "ㅊ", "ㅂ", "ㅍ", "ㄷ", "ㅌ"];
    return allowed.includes(first) ? first : "";
  }

  return base[0] ?? "";
}

function repeatLastVowel(output: string, mode: PronunciationMode): string {
  if (!output) return output;

  if (mode === "JP") {
    const m = output.match(/[aeiou](?!.*[aeiou])/);
    return m ? output + m[0] : output;
  }

  if (mode === "EN") {
    if (output.endsWith("ah")) return output + "-ah";
    if (output.endsWith("ee")) return output + "-ee";
    if (output.endsWith("oo")) return output + "-oo";
    if (output.endsWith("eh")) return output + "-eh";
    if (output.endsWith("oh")) return output + "-oh";
    return output;
  }

  if (mode === "KR") {
    if (output.endsWith("아")) return output + "아";
    if (output.endsWith("이")) return output + "이";
    if (output.endsWith("우")) return output + "우";
    if (output.endsWith("에")) return output + "에";
    if (output.endsWith("오")) return output + "오";
    return output;
  }

  return output;
}

function joinTokens(tokens: string[], mode: PronunciationMode): string {
  if (mode === "KR") return tokens.join("");
  if (mode === "JP") return tokens.join("");
  return tokens.join("-");
}

export function convertKana(readingInput: string, mode: PronunciationMode): string {
  const reading = toHiragana(readingInput);
  const map = getMap(mode);

  const tokens: string[] = [];
  let i = 0;
  let sokuonPending = false;

  while (i < reading.length) {
    const char = reading[i];

    if (char === " ") {
      tokens.push(" ");
      i += 1;
      continue;
    }

    if (isSmallTsu(char)) {
      sokuonPending = true;
      i += 1;
      continue;
    }

    if (isLongVowelMark(char)) {
      if (tokens.length > 0) {
        tokens[tokens.length - 1] = repeatLastVowel(tokens[tokens.length - 1], mode);
      }
      i += 1;
      continue;
    }

    const { unit, nextIndex } = getNextUnit(reading, i);
    const mapped = map[unit] ?? unit;

    let finalToken = mapped;

    if (sokuonPending) {
      const onset = getInitialConsonantForSokuon(unit, mode);

      if (mode === "KR") {
        finalToken = onset ? `${onset}${mapped}` : mapped;
      } else {
        finalToken = onset ? `${onset}${mapped}` : mapped;
      }

      sokuonPending = false;
    }

    tokens.push(finalToken);
    i = nextIndex;
  }

  const result = joinTokens(tokens, mode)
    .replace(/\s+/g, " ")
    .trim();

  return postProcess(result, mode);
}

function postProcess(result: string, mode: PronunciationMode): string {
  if (mode === "JP") {
    return result
      .replace(/\bn b/g, "mb")
      .replace(/\bn m/g, "mm")
      .replace(/\bn p/g, "mp");
  }

  if (mode === "EN") {
    return result
      .replace(/\bn b/g, "m b")
      .replace(/\bn m/g, "m m")
      .replace(/\bn p/g, "m p");
  }

  if (mode === "KR") {
    return result
      .replace(/ㄴ바/g, "ㅁ바")
      .replace(/ㄴ비/g, "ㅁ비")
      .replace(/ㄴ부/g, "ㅁ부")
      .replace(/ㄴ베/g, "ㅁ베")
      .replace(/ㄴ보/g, "ㅁ보")
      .replace(/ㄴ파/g, "ㅁ파")
      .replace(/ㄴ피/g, "ㅁ피")
      .replace(/ㄴ푸/g, "ㅁ푸")
      .replace(/ㄴ페/g, "ㅁ페")
      .replace(/ㄴ포/g, "ㅁ포");
  }

  return result;
}

export function buildPronunciation(reading: string) {
  return {
    reading: toHiragana(reading),
    kr: convertKana(reading, "KR"),
    jp: convertKana(reading, "JP"),
    en: convertKana(reading, "EN"),
  };
}