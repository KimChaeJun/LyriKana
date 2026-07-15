export type LyricReadingOverride = {
  surface: string;
  reading: string;
  wrongReadings: string[];
};

export type LyricReadingCandidateSource =
  | "lyric-lexicon"
  | "lyric-context"
  | "explicit-ruby";

export type LyricReadingCandidate = {
  surface: string;
  surfaceStart: number;
  surfaceEnd: number;
  wordReading: string;
  lineReading: string;
  source: LyricReadingCandidateSource;
  score: number;
  reasons: string[];
};

export type LyricReadingResolution = {
  reading: string;
  candidates: LyricReadingCandidate[];
  selected: LyricReadingCandidate | null;
};

type AmbiguousReadingRule = {
  surface: string;
  readings: string[];
};

const AMBIGUOUS_LYRIC_READINGS: AmbiguousReadingRule[] = [
  { surface: "身体", readings: ["しんたい", "からだ"] },
  { surface: "運命", readings: ["うんめい", "さだめ"] },
  { surface: "永遠", readings: ["えいえん", "とわ"] },
  { surface: "宇宙", readings: ["うちゅう", "そら"] },
  { surface: "地球", readings: ["ちきゅう", "ほし"] },
  { surface: "瞬間", readings: ["しゅんかん", "とき"] },
  { surface: "時間", readings: ["じかん", "とき"] },
  { surface: "理由", readings: ["りゆう", "わけ"] },
  { surface: "未来", readings: ["みらい", "あした"] },
  { surface: "明日", readings: ["あした", "あす"] },
  { surface: "現実", readings: ["げんじつ", "りある"] },
];

const BODY_FORMAL_CONTEXT =
  /身体(?:検査|測定|能力|機能|構造|活動|障害|特徴|表現|接触|拘束|操作|的)/;
const BODY_COLLOQUIAL_CONTEXT =
  /身体(?:を|が|は|に|へ|で|の|ごと|中)?[^。！？\n]{0,10}(?:抱|震|触|痛|熱|冷|燃|刻|流|委|預|重|軽)/;

export const LYRIC_READING_OVERRIDES: LyricReadingOverride[] = [
  { surface: "解けない", reading: "ほどけない", wrongReadings: ["とけない"] },
  { surface: "今世", reading: "こんせい", wrongReadings: ["こんよ", "いませ", "こんせ"] },
  { surface: "宝物", reading: "たからもの", wrongReadings: ["ほうもつ"] },
  { surface: "愛おしい", reading: "いとおしい", wrongReadings: ["あいおしい"] },
  { surface: "愛おし", reading: "いとおし", wrongReadings: ["あいおし"] },
  {
    surface: "灯りの灯らない蛍光灯",
    reading: "あかりのともらないけいこうとう",
    wrongReadings: [
      "ともしびのともらないけいこうとう",
      "とうりのともらないけいこうとう",
      "あかりのともろないけいこうとう",
    ],
  },
  { surface: "灯りの", reading: "あかりの", wrongReadings: ["ともしびの", "とうりの"] },
  { surface: "灯らない", reading: "ともらない", wrongReadings: ["ともろない"] },
  { surface: "失く", reading: "なく", wrongReadings: ["しつく"] },
  { surface: "周る", reading: "まわる", wrongReadings: ["しゅうる"] },
  { surface: "抱きしめ", reading: "だきしめ", wrongReadings: ["いだきしめ"] },
  { surface: "抱き締め", reading: "だきしめ", wrongReadings: ["いだきしめ"] },
  { surface: "被って", reading: "かぶって", wrongReadings: ["こうむって"] },
  { surface: "被る", reading: "かぶる", wrongReadings: ["こうむる"] },
  {
    surface: "埃を被って",
    reading: "ほこりをかぶって",
    wrongReadings: ["ほこりをこうむって"],
  },
];

export const LYRIC_COMMON_READINGS: Record<string, string> = {
  今世: "こんせい",
  来世: "らいせ",
  前世: "ぜんせ",
  現世: "げんせ",
  宝物: "たからもの",
  灯り: "あかり",
  灯ら: "ともら",
  灯らない: "ともらない",
  蛍光灯: "けいこうとう",
  周る: "まわる",
  世界: "せかい",
  過去: "かこ",
  今日: "きょう",
  昨日: "きのう",
  大人: "おとな",
  子供: "こども",
  上手: "じょうず",
  下手: "へた",
  本当: "ほんとう",
  言葉: "ことば",
  心臓: "しんぞう",
  心音: "しんおん",
  約束: "やくそく",
  記憶: "きおく",
  孤独: "こどく",
  奇跡: "きせき",
  涙声: "なみだごえ",
  物語: "ものがたり",
  何度: "なんど",
  何回: "なんかい",
  何処: "どこ",
  何故: "なぜ",
  一人: "ひとり",
  二人: "ふたり",
  一回: "いっかい",
  一階: "いっかい",
  一分: "いっぷん",
  一本: "いっぽん",
  一杯: "いっぱい",
  一匹: "いっぴき",
};

const LYRIC_ABSTRACT_WRAP_CONTEXT =
  /(?:温もり|ぬくもり|光|闇|愛|優しさ|夢|声|風|音|記憶|孤独|幸せ|悲しみ|涙|希望|世界)に包まれ/;

function literalPattern(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function katakanaToHiragana(value: string): string {
  return value.replace(/[\u30a1-\u30f6]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 0x60)
  );
}

function hiraganaToKatakana(value: string): string {
  return value.replace(/[\u3041-\u3096]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) + 0x60)
  );
}

function explicitReadingForms(rule: AmbiguousReadingRule): string[] {
  return [
    ...rule.readings,
    ...rule.readings.map((reading) => hiraganaToKatakana(reading)),
  ];
}

function replaceKnownWordReading(
  lineReading: string,
  knownReadings: string[],
  replacement: string
): string {
  for (const knownReading of knownReadings) {
    const index = lineReading.indexOf(knownReading);
    if (index < 0) continue;

    return (
      lineReading.slice(0, index) +
      replacement +
      lineReading.slice(index + knownReading.length)
    );
  }

  return lineReading;
}

function explicitRubyReading(
  original: string,
  rule: AmbiguousReadingRule
): string | null {
  const readings = explicitReadingForms(rule).map(escapePattern).join("|");
  const pattern = new RegExp(
    `${escapePattern(rule.surface)}\\s*(?:[（(［\\[](${readings})[）)］\\]]|<rt>\\s*(${readings})\\s*</rt>)`,
    "i"
  );
  const match = original.match(pattern);
  const reading = match?.[1] ?? match?.[2] ?? "";
  const normalized = katakanaToHiragana(reading);
  return rule.readings.includes(normalized) ? normalized : null;
}

function candidateFor(
  original: string,
  currentReading: string,
  rule: AmbiguousReadingRule,
  wordReading: string,
  source: LyricReadingCandidateSource,
  score: number,
  reasons: string[]
): LyricReadingCandidate {
  const surfaceStart = original.indexOf(rule.surface);
  return {
    surface: rule.surface,
    surfaceStart,
    surfaceEnd: surfaceStart + rule.surface.length,
    wordReading,
    lineReading: replaceKnownWordReading(
      currentReading,
      rule.readings,
      wordReading
    ),
    source,
    score,
    reasons,
  };
}

export function stripExplicitLyricReadings(original: string): string {
  let stripped = original;

  for (const rule of AMBIGUOUS_LYRIC_READINGS) {
    const readings = explicitReadingForms(rule).map(escapePattern).join("|");
    const parenthetical = new RegExp(
      `${escapePattern(rule.surface)}\\s*[（(［\\[](?:${readings})[）)］\\]]`,
      "gi"
    );
    const htmlRuby = new RegExp(
      `<ruby>\\s*${escapePattern(rule.surface)}\\s*<rt>\\s*(?:${readings})\\s*</rt>\\s*</ruby>`,
      "gi"
    );
    stripped = stripped
      .replace(parenthetical, rule.surface)
      .replace(htmlRuby, rule.surface);
  }

  return stripped;
}

export function resolveLyricReadingCandidates(
  original: string,
  reading: string
): LyricReadingResolution {
  let resolvedReading = reading;
  const candidates: LyricReadingCandidate[] = [];
  let selected: LyricReadingCandidate | null = null;

  for (const rule of AMBIGUOUS_LYRIC_READINGS) {
    if (!original.includes(rule.surface)) continue;

    let selectedForRule: LyricReadingCandidate | null = null;
    const explicitReading = explicitRubyReading(original, rule);
    const contextualReading =
      rule.surface === "身体" && BODY_FORMAL_CONTEXT.test(original)
        ? "しんたい"
        : rule.surface === "身体" && BODY_COLLOQUIAL_CONTEXT.test(original)
          ? "からだ"
          : null;

    for (const wordReading of rule.readings) {
      let source: LyricReadingCandidateSource = "lyric-lexicon";
      let score = 0.25;
      const reasons = [`${rule.surface} has multiple established or lyric readings`];

      if (contextualReading === wordReading) {
        source = "lyric-context";
        score = 0.9;
        reasons.push(
          wordReading === "からだ"
            ? "physical or colloquial lyric context favors からだ"
            : "formal compound context favors しんたい"
        );
      }

      if (explicitReading === wordReading) {
        source = "explicit-ruby";
        score = 1;
        reasons.push("the lyric text explicitly supplies this reading");
      }

      const candidate = candidateFor(
        original,
        resolvedReading,
        rule,
        wordReading,
        source,
        score,
        reasons
      );
      candidates.push(candidate);

      if (
        (source === "explicit-ruby" || source === "lyric-context") &&
        (!selectedForRule || candidate.score > selectedForRule.score)
      ) {
        selectedForRule = candidate;
      }
    }

    if (selectedForRule) {
      resolvedReading = replaceKnownWordReading(
        resolvedReading,
        rule.readings,
        selectedForRule.wordReading
      );
      selected = {
        ...selectedForRule,
        lineReading: resolvedReading,
      };
    }
  }

  return {
    reading: resolvedReading,
    candidates,
    selected,
  };
}

export function getLyricCommonReading(surface: string): string | undefined {
  return LYRIC_COMMON_READINGS[surface];
}

export function applyLyricReadingDictionary(
  original: string,
  reading: string
): string {
  let nextReading = reading;

  for (const override of LYRIC_READING_OVERRIDES) {
    if (!original.includes(override.surface)) continue;

    for (const wrongReading of override.wrongReadings) {
      nextReading = nextReading.replace(
        literalPattern(wrongReading),
        override.reading
      );
    }
  }

  if (LYRIC_ABSTRACT_WRAP_CONTEXT.test(original)) {
    nextReading = nextReading.replace(/くるまれ/g, "つつまれ");
  }

  return nextReading;
}
