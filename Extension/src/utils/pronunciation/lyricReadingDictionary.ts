export type LyricReadingOverride = {
  surface: string;
  reading: string;
  wrongReadings: string[];
};

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
  未来: "みらい",
  過去: "かこ",
  明日: "あした",
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
  瞬間: "しゅんかん",
  永遠: "えいえん",
  運命: "うんめい",
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
