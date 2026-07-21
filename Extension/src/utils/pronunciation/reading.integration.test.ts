import path from "node:path";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  getJapaneseReadingWithTokens,
  normalizeLyricTextForAnalysis,
} from "./reading";

const require = createRequire(import.meta.url);
const kuromoji = require("kuromoji");

describe("Japanese reading integration", () => {
  beforeAll(() => {
    vi.stubGlobal("kuromoji", kuromoji);
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("chrome", {
      runtime: {
        getURL: (resource: string) =>
          path.join(process.cwd(), "public", resource).replace(/\\/g, "/"),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network disabled in integration test")))
    );
  });

  it("runs the full tokenizer pipeline and selects 身体 as からだ by context", async () => {
    const result = await getJapaneseReadingWithTokens("身体を抱いて");

    expect(result.displayReading).toBe("からだをだいて");
    expect(result.spokenReading).toBe("からだをだいて");
    expect(result.selectedSource).toBe("lyric-context");
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "身体",
          reading: "からだをだいて",
          selected: true,
        }),
      ])
    );
  });

  it("keeps は in display reading and uses わ in spoken reading", async () => {
    const result = await getJapaneseReadingWithTokens("私はいつか");

    expect(result.displayReading).toBe("わたしはいつか");
    expect(result.spokenReading).toBe("わたしわいつか");
  });

  it("removes decorative quote variants before morphological analysis", () => {
    expect(normalizeLyricTextForAnalysis('⌈“私は”⌋ 「明日」')).toBe("私は 明日");
  });

  it("still recognizes は as a particle through decorative brackets", async () => {
    const result = await getJapaneseReadingWithTokens("⌈私は⌋いつか");

    expect(result.displayReading.replace(/\s+/g, "")).toBe("わたしはいつか");
    expect(result.spokenReading.replace(/\s+/g, "")).toBe("わたしわいつか");
  });

  it("uses tokenizer pronunciation to identify orthographic long vowels", async () => {
    const result = await getJapaneseReadingWithTokens("高校");

    expect(result.displayReading).toBe("こうこう");
    expect(result.spokenReading).toBe("こーこー");
  });
});
