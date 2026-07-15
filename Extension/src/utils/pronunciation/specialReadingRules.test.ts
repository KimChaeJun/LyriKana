import { describe, expect, it } from "vitest";

import { buildPronunciation } from "./converters";
import { detectSpecialReadingCase, type TokenLite } from "./specialReadingRules";


const noun = (surface: string): TokenLite => ({ surface, pos: "名詞" });


describe("pronunciation regression rules", () => {
  it("flags contextual person and counter readings for precise fallback", () => {
    const person = detectSpecialReadingCase("一人", "いちにん", [noun("一"), noun("人")]);
    const counter = detectSpecialReadingCase("一回", "いちかい", [noun("一"), noun("回")]);

    expect(person.shouldFallback).toBe(true);
    expect(person.reasons.join(" ")).toContain("ひとり");
    expect(counter.shouldFallback).toBe(true);
    expect(counter.reasons.join(" ")).toContain("いっかい");
  });

  it("flags suspicious kanji/okurigana readings such as 被って", () => {
    const result = detectSpecialReadingCase("埃を被って", "ほこりをこうむって", [
      noun("埃"),
      { surface: "を", pos: "助詞" },
      { surface: "被って", pos: "動詞", reading: "コウムッテ" },
    ]);

    expect(result.shouldFallback).toBe(true);
    expect(result.reasons.join(" ")).toContain("被って");
  });

  it("separates the written は from its spoken わ pronunciation", () => {
    const result = buildPronunciation("には", "には", [
      { surface: "に", pos: "助詞" },
      { surface: "は", pos: "助詞", pronunciation: "ワ" },
    ]);

    expect(result.displayReading).toBe("には");
    expect(result.spokenReading).toBe("にわ");
    expect(result.kr).toBe("니와");
    expect(result.en).toBe("niwa");
  });

  it("keeps orthographic hiragana while transliterating 私はいつか as spoken", () => {
    const result = buildPronunciation("わたしはいつか", "私はいつか", [
      { surface: "私", pos: "名詞", reading: "ワタシ" },
      { surface: "は", pos: "助詞", pronunciation: "ワ" },
      { surface: "いつか", pos: "名詞", reading: "イツカ" },
    ]);

    expect(result.reading).toBe("わたしはいつか");
    expect(result.spokenReading).toBe("わたしわいつか");
    expect(result.kr).toBe("와타시와이츠카");
    expect(result.en).toBe("watashiwaitsuka");
  });

  it("renders dictionary-confirmed hiragana long vowels as hyphens", () => {
    const result = buildPronunciation("こうこう", "高校", [
      {
        surface: "高校",
        pos: "名詞",
        reading: "コウコウ",
        pronunciation: "コーコー",
      },
    ]);

    expect(result.displayReading).toBe("こうこう");
    expect(result.spokenReading).toBe("こーこー");
    expect(result.kr).toBe("코-코-");
    expect(result.jp).toBe("코-코-");
    expect(result.en).toBe("ko-ko-");
  });

  it("does not collapse separately pronounced adjacent vowels", () => {
    const result = buildPronunciation("かわいい", "可愛い", [
      {
        surface: "可愛い",
        pos: "形容詞",
        reading: "カワイイ",
        pronunciation: "カワイイ",
      },
    ]);

    expect(result.spokenReading).toBe("かわいい");
    expect(result.kr).toBe("카와이이");
    expect(result.en).toBe("kawaii");
  });
});
