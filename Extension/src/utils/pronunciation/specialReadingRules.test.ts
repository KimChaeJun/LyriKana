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

  it("keeps the particle は pronunciation rule and romaji output", () => {
    const result = buildPronunciation("には", "には", [
      { surface: "に", pos: "助詞" },
      { surface: "は", pos: "助詞" },
    ]);

    expect(result.kr).toBe("니와");
    expect(result.en).toBe("niha");
  });
});
