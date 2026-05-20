import type { TokenLite } from "./specialReadingRules";

export type PronunciationResult = {
  reading: string;
  kr: string;
  jp: string;
  en: string;
};

type Mode = "KR" | "JP" | "EN";

const DIGRAPH_TO_KR: Record<string, string> = {
  きゃ: "캬", きゅ: "큐", きょ: "쿄",
  ぎゃ: "갸", ぎゅ: "규", ぎょ: "교",

  しゃ: "샤", しゅ: "슈", しょ: "쇼",
  じゃ: "쟈", じゅ: "쥬", じょ: "죠",
  ぢゃ: "쟈", ぢゅ: "쥬", ぢょ: "죠",

  ちゃ: "차", ちゅ: "추", ちょ: "초",

  にゃ: "냐", にゅ: "뉴", にょ: "뇨",
  ひゃ: "햐", ひゅ: "휴", ひょ: "효",
  びゃ: "뱌", びゅ: "뷰", びょ: "뵤",
  ぴゃ: "퍄", ぴゅ: "퓨", ぴょ: "표",

  みゃ: "먀", みゅ: "뮤", みょ: "묘",
  りゃ: "랴", りゅ: "류", りょ: "료",

  ふぁ: "화", ふぃ: "휘", ふぇ: "훼", ふぉ: "호",
  つぁ: "차", つぃ: "치", つぇ: "체", つぉ: "초",
  うぃ: "위", うぇ: "웨", うぉ: "워",
  ゔぁ: "바", ゔぃ: "비", ゔぇ: "베", ゔぉ: "보",
  てぃ: "티", でぃ: "디",
  とぅ: "투", どぅ: "두", てゅ: "튜", でゅ: "듀",
  しぇ: "셰", じぇ: "제", ちぇ: "체",
};

const DIGRAPH_TO_JP: Record<string, string> = {
  きゃ: "캬", きゅ: "큐", きょ: "쿄",
  ぎゃ: "갸", ぎゅ: "규", ぎょ: "교",

  しゃ: "샤", しゅ: "슈", しょ: "쇼",
  じゃ: "쟈", じゅ: "쥬", じょ: "죠",
  ぢゃ: "쟈", ぢゅ: "쥬", ぢょ: "죠",

  ちゃ: "챠", ちゅ: "츄", ちょ: "쵸",

  にゃ: "냐", にゅ: "뉴", にょ: "뇨",
  ひゃ: "햐", ひゅ: "휴", ひょ: "효",
  びゃ: "뱌", びゅ: "뷰", びょ: "뵤",
  ぴゃ: "퍄", ぴゅ: "퓨", ぴょ: "표",

  みゃ: "먀", みゅ: "뮤", みょ: "묘",
  りゃ: "랴", りゅ: "류", りょ: "료",

  ふぁ: "화", ふぃ: "휘", ふぇ: "훼", ふぉ: "호",
  つぁ: "츠아", つぃ: "츠이", つぇ: "츠에", つぉ: "츠오",
  うぃ: "위", うぇ: "웨", うぉ: "워",
  ゔぁ: "바", ゔぃ: "비", ゔぇ: "베", ゔぉ: "보",
  てぃ: "티", でぃ: "디",
  とぅ: "투", どぅ: "두", てゅ: "튜", でゅ: "듀",
  しぇ: "셰", じぇ: "제", ちぇ: "체",
};

const DIGRAPH_TO_EN: Record<string, string> = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",

  しゃ: "sha", しゅ: "shu", しょ: "sho",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",

  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",

  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",

  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",

  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  つぁ: "tsa", つぃ: "tsi", つぇ: "tse", つぉ: "tso",
  うぃ: "wi", うぇ: "we", うぉ: "wo",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  てぃ: "ti", でぃ: "di",
  とぅ: "tu", どぅ: "du", てゅ: "tyu", でゅ: "dyu",
  しぇ: "she", じぇ: "je", ちぇ: "che",
};

const KANA_TO_KR: Record<string, string> = {
  あ: "아", い: "이", う: "우", え: "에", お: "오",

  か: "카", き: "키", く: "쿠", け: "케", こ: "코",
  が: "가", ぎ: "기", ぐ: "구", げ: "게", ご: "고",

  さ: "사", し: "시", す: "스", せ: "세", そ: "소",
  ざ: "자", じ: "지", ず: "즈", ぜ: "제", ぞ: "조",

  た: "타", ち: "치", つ: "츠", て: "테", と: "토",
  だ: "다", ぢ: "지", づ: "즈", で: "데", ど: "도",

  な: "나", に: "니", ぬ: "누", ね: "네", の: "노",
  は: "하", ひ: "히", ふ: "후", へ: "헤", ほ: "호",
  ば: "바", び: "비", ぶ: "부", べ: "베", ぼ: "보",
  ぱ: "파", ぴ: "피", ぷ: "푸", ぺ: "페", ぽ: "포",

  ま: "마", み: "미", む: "무", め: "메", も: "모",
  や: "야", ゆ: "유", よ: "요",
  ら: "라", り: "리", る: "루", れ: "레", ろ: "로",
  わ: "와", を: "오",
  ん: "ㄴ",

  ぁ: "아", ぃ: "이", ぅ: "우", ぇ: "에", ぉ: "오",
  ゃ: "야", ゅ: "유", ょ: "요",
  ゔ: "부",
  ー: "ー",
};

const KANA_TO_JP: Record<string, string> = {
  あ: "아", い: "이", う: "우", え: "에", お: "오",

  か: "카", き: "키", く: "쿠", け: "케", こ: "코",
  が: "가", ぎ: "기", ぐ: "구", げ: "게", ご: "고",

  さ: "사", し: "시", す: "스", せ: "세", そ: "소",
  ざ: "자", じ: "지", ず: "즈", ぜ: "제", ぞ: "조",

  た: "타", ち: "치", つ: "츠", て: "테", と: "토",
  だ: "다", ぢ: "지", づ: "즈", で: "데", ど: "도",

  な: "나", に: "니", ぬ: "누", ね: "네", の: "노",
  は: "하", ひ: "히", ふ: "후", へ: "헤", ほ: "호",
  ば: "바", び: "비", ぶ: "부", べ: "베", ぼ: "보",
  ぱ: "파", ぴ: "피", ぷ: "푸", ぺ: "페", ぽ: "포",

  ま: "마", み: "미", む: "무", め: "메", も: "모",
  や: "야", ゆ: "유", よ: "요",
  ら: "라", り: "리", る: "루", れ: "레", ろ: "로",
  わ: "와", を: "오",
  ん: "응",

  ぁ: "아", ぃ: "이", ぅ: "우", ぇ: "에", ぉ: "오",
  ゃ: "야", ゅ: "유", ょ: "요",
  ゔ: "부",
  ー: "ー",
};

const KANA_TO_EN: Record<string, string> = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",

  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",

  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",

  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",

  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",

  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", を: "o",
  ん: "n",

  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゃ: "ya", ゅ: "yu", ょ: "yo",
  ゔ: "vu",
  ー: "-",
};

function katakanaToHiragana(input: string): string {
  return input.replace(/[\u30a1-\u30f6]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );
}

function isSmallTsu(char: string): boolean {
  return char === "っ";
}

function isLongVowel(char: string): boolean {
  return char === "ー";
}

function isSmallKana(char: string): boolean {
  return /[ゃゅょぁぃぅぇぉゎ]/.test(char);
}

function getVowelFromKanaUnit(unit: string): string {
  const last = unit[unit.length - 1];

  if (/[あかがさざただなはばぱまやらわぁゃ]/.test(last)) return "a";
  if (/[いきぎしじちぢにひびぴみりぃ]/.test(last)) return "i";
  if (/[うくぐすずつづぬふぶぷむゆるぅゅゔ]/.test(last)) return "u";
  if (/[えけげせぜてでねへべぺめれぇ]/.test(last)) return "e";
  if (/[おこごそぞとのほぼぽもよろをぉょ]/.test(last)) return "o";

  return "";
}

function isHangulSyllable(char: string): boolean {
  return /^[가-힣]$/.test(char);
}

function getHangulParts(char: string): { choseong: number; jungseong: number; jongseong: number } | null {
  const code = char.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;

  return {
    choseong: Math.floor(code / 588),
    jungseong: Math.floor((code % 588) / 28),
    jongseong: code % 28,
  };
}

function hasFinalConsonant(char: string): boolean {
  const parts = getHangulParts(char);
  return parts ? parts.jongseong !== 0 : false;
}

function replaceFinalConsonant(char: string, jongseongIndex: number): string {
  const parts = getHangulParts(char);
  if (!parts) return char;

  return String.fromCharCode(
    0xac00 + parts.choseong * 588 + parts.jungseong * 28 + jongseongIndex
  );
}

function addFinalConsonant(char: string, jongseongIndex: number): string {
  const parts = getHangulParts(char);
  if (!parts) return char;
  if (parts.jongseong !== 0) return char;

  return String.fromCharCode(
    0xac00 + parts.choseong * 588 + parts.jungseong * 28 + jongseongIndex
  );
}

function endsWithNieunBatchim(char: string): boolean {
  const parts = getHangulParts(char);
  return !!parts && parts.jongseong === 4;
}

function startsWithLabial(token: string): boolean {
  return /^(바|비|부|베|보|파|피|푸|페|포|마|미|무|메|모)/.test(token);
}

function getNextUnit(reading: string, index: number): { unit: string; nextIndex: number } {
  const current = reading[index] ?? "";
  const next = reading[index + 1] ?? "";

  if (next && isSmallKana(next)) {
    return { unit: current + next, nextIndex: index + 2 };
  }

  return { unit: current, nextIndex: index + 1 };
}

function getMappedToken(unit: string, mode: Mode): string {
  if (mode === "KR") {
    return DIGRAPH_TO_KR[unit] ?? KANA_TO_KR[unit] ?? unit;
  }
  if (mode === "JP") {
    return DIGRAPH_TO_JP[unit] ?? KANA_TO_JP[unit] ?? unit;
  }
  return DIGRAPH_TO_EN[unit] ?? KANA_TO_EN[unit] ?? unit;
}

function duplicateInitialConsonant(token: string, mode: Mode): string {
  if (!token) return token;

  if (mode === "EN") {
    return token[0] + token;
  }

  const map: Record<string, string> = {
    카: "까", 키: "끼", 쿠: "꾸", 케: "께", 코: "꼬",
    타: "따", 테: "떼", 토: "또",
    치: "찌", 차: "짜", 추: "쭈", 초: "쪼",
    파: "빠", 피: "삐", 푸: "뿌", 페: "뻬", 포: "뽀",
    사: "싸", 시: "씨", 스: "쓰", 세: "쎄", 소: "쏘",
  };

  return map[token] ?? token;
}

function addSokuonAsBatchim(tokens: string[]): boolean {
  if (tokens.length === 0) return false;

  const last = tokens[tokens.length - 1];
  if (!last) return false;

  const lastChar = last[last.length - 1];
  if (!isHangulSyllable(lastChar)) return false;
  if (hasFinalConsonant(lastChar)) return false;

  // jongseong 19 = ㅅ
  tokens[tokens.length - 1] = last.slice(0, -1) + addFinalConsonant(lastChar, 19);
  return true;
}

function applyLongVowel(tokens: string[], previousUnit: string, mode: Mode): void {
  if (tokens.length === 0) return;

  const lastToken = tokens[tokens.length - 1];
  if (!lastToken) return;

  const vowel = getVowelFromKanaUnit(previousUnit);
  if (!vowel) {
    tokens[tokens.length - 1] = lastToken + "ー";
    return;
  }

  if (mode === "EN") {
    tokens[tokens.length - 1] = lastToken + vowel;
    return;
  }

  const longVowelMap: Record<string, string> = {
    a: "아",
    i: "이",
    u: "우",
    e: "에",
    o: "오",
  };

  tokens[tokens.length - 1] = lastToken + longVowelMap[vowel];
}

function postProcessKR(text: string): string {
  return text.replace(/ああ/g, "아아");
}

function isParticleHaToken(token: TokenLite | undefined): boolean {
  return !!token && token.surface === "は" && token.pos === "助詞";
}

function applyParticleWaRuleFromTokens(
  kr: string,
  tokens: TokenLite[]
): string {
  if (!kr || tokens.length === 0) return kr;

  const lastToken = tokens[tokens.length - 1];

  // 마지막 토큰이 조사 は 인 경우만 와 처리
  if (isParticleHaToken(lastToken) && kr.endsWith("하")) {
    return kr.slice(0, -1) + "와";
  }

  return kr;
}

function applyParticleWaRuleFromOriginal(
  kr: string,
  original?: string
): string {
  if (!kr || !original) return kr;

  let nextKr = kr;

  if (original.includes("には")) {
    nextKr = nextKr.replace(/니하/g, "니와");
  }
  if (original.includes("では")) {
    nextKr = nextKr.replace(/데하/g, "데와");
  }
  if (original.includes("とは")) {
    nextKr = nextKr.replace(/토하/g, "토와");
  }
  if (original.includes("しは")) {
    nextKr = nextKr.replace(/시하/g, "시와");
  }
  if (original.includes("へは")) {
    nextKr = nextKr.replace(/에하/g, "에와").replace(/헤하/g, "헤와");
  }
  if (original.trim().endsWith("は") && nextKr.endsWith("하")) {
    nextKr = nextKr.slice(0, -1) + "와";
  }

  return nextKr;
}

function convertKana(reading: string, mode: Mode): string {
  const hiraReading = katakanaToHiragana(reading);
  const normalizedReading = hiraReading;

  const tokens: string[] = [];
  let i = 0;
  let pendingSokuon = false;
  let previousUnit = "";

  while (i < normalizedReading.length) {
    const char = normalizedReading[i];

    if (isSmallTsu(char)) {
      if (mode === "KR") {
        const applied = addSokuonAsBatchim(tokens);
        if (!applied) {
          pendingSokuon = true;
        }
      } else {
        pendingSokuon = true;
      }

      i += 1;
      continue;
    }

    if (isLongVowel(char)) {
      applyLongVowel(tokens, previousUnit, mode);
      i += 1;
      continue;
    }

    const lookaheadTwo = normalizedReading.slice(i, i + 2);
    const isDigraph =
      lookaheadTwo.length === 2 &&
      (mode === "KR"
        ? lookaheadTwo in DIGRAPH_TO_KR
        : mode === "JP"
        ? lookaheadTwo in DIGRAPH_TO_JP
        : lookaheadTwo in DIGRAPH_TO_EN);

    const { unit, nextIndex } = isDigraph
      ? { unit: lookaheadTwo, nextIndex: i + 2 }
      : getNextUnit(normalizedReading, i);

    if (mode === "KR" && unit === "ん") {
      const nextTwo = normalizedReading.slice(nextIndex, nextIndex + 2);
      const nextIsDigraph = nextTwo.length === 2 && nextTwo in DIGRAPH_TO_KR;
      const nextUnit = nextIsDigraph ? nextTwo : normalizedReading[nextIndex] ?? "";
      const nextToken = nextUnit ? getMappedToken(nextUnit, "KR") : "";

      const last = tokens[tokens.length - 1];

      if (last && last.length > 0) {
        const lastChar = last[last.length - 1];

        if (isHangulSyllable(lastChar) && !hasFinalConsonant(lastChar)) {
          const jong = startsWithLabial(nextToken) ? 16 : 4;
          tokens[tokens.length - 1] =
            last.slice(0, -1) + addFinalConsonant(lastChar, jong);
        } else {
          tokens.push(startsWithLabial(nextToken) ? "ㅁ" : "ㄴ");
        }
      } else {
        tokens.push(startsWithLabial(nextToken) ? "ㅁ" : "ㄴ");
      }

      previousUnit = unit;
      i = nextIndex;
      continue;
    }

    let mapped = getMappedToken(unit, mode);

    if (pendingSokuon) {
      mapped = duplicateInitialConsonant(mapped, mode);
      pendingSokuon = false;
    }

    tokens.push(mapped);

    if (mode === "KR" && tokens.length >= 2) {
      const prev = tokens[tokens.length - 2];
      const curr = tokens[tokens.length - 1];

      if (prev && curr) {
        const lastChar = prev[prev.length - 1];
        if (endsWithNieunBatchim(lastChar) && startsWithLabial(curr)) {
          tokens[tokens.length - 2] =
            prev.slice(0, -1) + replaceFinalConsonant(lastChar, 16);
        }
      }
    }

    previousUnit = unit;
    i = nextIndex;
  }

  const joined = tokens.join("");
  return mode === "KR" ? postProcessKR(joined) : joined;
}

export function buildPronunciation(
  reading: string,
  original?: string,
  tokens: TokenLite[] = []
): PronunciationResult {
  const normalized = katakanaToHiragana(reading.trim());

  let kr = convertKana(normalized, "KR");
  const jp = convertKana(normalized, "JP");
  const en = convertKana(normalized, "EN");

  // 1순위: 토큰 기반 조사 は -> 와
  kr = applyParticleWaRuleFromTokens(kr, tokens);
  kr = applyParticleWaRuleFromOriginal(kr, original);

  return {
    reading: normalized,
    kr,
    jp,
    en,
  };
}
