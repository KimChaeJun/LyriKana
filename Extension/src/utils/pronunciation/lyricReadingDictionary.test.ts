import { describe, expect, it } from "vitest";

import {
  resolveLyricReadingCandidates,
  stripExplicitLyricReadings,
} from "./lyricReadingDictionary";

describe("ambiguous lyric readings", () => {
  it("prefers からだ in a physical, colloquial lyric context", () => {
    const result = resolveLyricReadingCandidates(
      "身体を抱いて",
      "しんたいをいだいて"
    );

    expect(result.reading).toBe("からだをいだいて");
    expect(result.selected).toMatchObject({
      surface: "身体",
      wordReading: "からだ",
      source: "lyric-context",
    });
    expect(result.candidates.map((candidate) => candidate.wordReading)).toEqual(
      expect.arrayContaining(["しんたい", "からだ"])
    );
  });

  it("keeps しんたい for formal compounds", () => {
    const result = resolveLyricReadingCandidates(
      "身体検査を受ける",
      "しんたいけんさをうける"
    );

    expect(result.reading).toBe("しんたいけんさをうける");
    expect(result.selected).toMatchObject({
      wordReading: "しんたい",
      source: "lyric-context",
    });
  });

  it("does not guess an unmarked poetic reading", () => {
    const result = resolveLyricReadingCandidates(
      "運命を変える",
      "うんめいをかえる"
    );

    expect(result.reading).toBe("うんめいをかえる");
    expect(result.selected).toBeNull();
  });

  it("uses an explicit lyric ruby and removes it before analysis", () => {
    const original = "運命（さだめ）を変える";
    const result = resolveLyricReadingCandidates(
      original,
      "うんめいをかえる"
    );

    expect(stripExplicitLyricReadings(original)).toBe("運命を変える");
    expect(result.reading).toBe("さだめをかえる");
    expect(result.selected).toMatchObject({
      wordReading: "さだめ",
      source: "explicit-ruby",
      score: 1,
    });
  });

  it("normalizes katakana ruby used for creative J-pop readings", () => {
    const original = "現実（リアル）を越えて";
    const result = resolveLyricReadingCandidates(
      original,
      "げんじつをこえて"
    );

    expect(stripExplicitLyricReadings(original)).toBe("現実を越えて");
    expect(result.reading).toBe("りあるをこえて");
    expect(result.selected).toMatchObject({
      wordReading: "りある",
      source: "explicit-ruby",
    });
  });
});
