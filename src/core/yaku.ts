import { Mentsu, isSet, mentsuKinds } from './mentsu';
import {
  Kind,
  isDragon,
  isGreen,
  isHonor,
  isSimple,
  isTerminal,
  isYaochu,
  kindName,
  numOf,
  suitOf,
} from './tile';

export interface Yaku {
  name: string;
  han: number;
  yakuman?: boolean;
}

export interface YakuCatalogEntry {
  name: string;
  hanText: string;
  scope: '1面子〜' | '2面子〜' | '3面子' | '対子4組' | '3面子 / 対子4組';
  desc: string;
  /** 具体例（面子ごとの Kind 配列） */
  example: readonly (readonly Kind[])[];
  yakuman?: boolean;
}

/** UI表示用の役一覧カタログ（筒子 9..17、索子 18..26、三元牌 31..33 で具体例を構成） */
export const YAKU_CATALOG: readonly YakuCatalogEntry[] = [
  {
    name: '役牌（白・發・中）',
    hanText: '1翻',
    scope: '1面子〜',
    desc: '三元牌の刻子・槓子（1組ごとに1翻）',
    example: [[33, 33, 33]],
  },
  {
    name: '一盃口',
    hanText: '1翻',
    scope: '2面子〜',
    desc: '同じ順子2組（七対子でも連続3種の対子があれば成立）',
    example: [[9, 10, 11], [9, 10, 11]],
  },
  {
    name: '二色同順',
    hanText: '2翻',
    scope: '2面子〜',
    desc: '筒子と索子で同じ数字の順子2組',
    example: [[10, 11, 12], [19, 20, 21]],
  },
  {
    name: '二色同刻',
    hanText: '2翻',
    scope: '2面子〜',
    desc: '筒子と索子で同じ数字の刻子・槓子2組',
    example: [[13, 13, 13], [22, 22, 22]],
  },
  {
    name: '二暗刻',
    hanText: '2翻',
    scope: '2面子〜',
    desc: '刻子・槓子が2組',
    example: [[10, 10, 10], [24, 24, 24]],
  },
  {
    name: '小三元',
    hanText: '2翻',
    scope: '2面子〜',
    desc: '三元牌の刻子・槓子が2組（役牌2つと合わせて計4翻）',
    example: [[31, 31, 31], [32, 32, 32]],
  },
  {
    name: '混全帯么九',
    hanText: '2翻',
    scope: '2面子〜',
    desc: '全面子に么九牌（1・9・字牌）を含み、順子と字牌を含む',
    example: [[9, 10, 11], [31, 31, 31]],
  },
  {
    name: '純全帯么九',
    hanText: '3翻',
    scope: '2面子〜',
    desc: '全面子に老頭牌（1・9）を含み、順子を含む',
    example: [[9, 10, 11], [24, 25, 26]],
  },
  {
    name: '混老頭',
    hanText: '2翻',
    scope: '2面子〜',
    desc: '么九牌（1・9・字牌）のみで構成（対子4組でも成立）',
    example: [[9, 9, 9], [33, 33, 33]],
  },
  {
    name: '七対子',
    hanText: '2翻',
    scope: '対子4組',
    desc: '異なる対子4組（8枚・25符固定）',
    example: [[10, 10], [13, 13], [20, 20], [32, 32]],
  },
  {
    name: '断么九',
    hanText: '1翻',
    scope: '3面子 / 対子4組',
    desc: '中張牌（2〜8）のみで構成',
    example: [[10, 11, 12], [13, 13, 13], [21, 22, 23]],
  },
  {
    name: '平和',
    hanText: '1翻',
    scope: '3面子',
    desc: '3面子すべてが順子',
    example: [[9, 10, 11], [12, 13, 14], [20, 21, 22]],
  },
  {
    name: '混一色',
    hanText: '1翻',
    scope: '3面子',
    desc: '1種類の数牌と字牌のみで構成（3面子攻撃時のみ複合）',
    example: [[9, 10, 11], [13, 14, 15], [31, 31, 31]],
  },
  {
    name: '清一色',
    hanText: '3翻',
    scope: '3面子',
    desc: '1種類の数牌のみで構成（3面子攻撃時のみ複合）',
    example: [[9, 10, 11], [12, 13, 14], [16, 16, 16]],
  },
  {
    name: '一気通貫',
    hanText: '3翻',
    scope: '3面子',
    desc: '同じ数牌で 123・456・789 の順子',
    example: [[18, 19, 20], [21, 22, 23], [24, 25, 26]],
  },
  {
    name: '三暗刻',
    hanText: '3翻',
    scope: '3面子',
    desc: '3面子すべてが刻子・槓子',
    example: [[10, 10, 10], [14, 14, 14], [25, 25, 25]],
  },
  {
    name: '三槓子',
    hanText: '4翻',
    scope: '3面子',
    desc: '3面子すべてが槓子',
    example: [[10, 10, 10, 10], [14, 14, 14, 14], [25, 25, 25, 25]],
  },
  {
    name: '大三元',
    hanText: '役満(13翻)',
    scope: '3面子',
    desc: '白・發・中の刻子・槓子3組',
    example: [[31, 31, 31], [32, 32, 32], [33, 33, 33]],
    yakuman: true,
  },
  {
    name: '字一色',
    hanText: '役満(13翻)',
    scope: '3面子',
    desc: '字牌のみで構成',
    example: [[31, 31, 31], [32, 32, 32], [33, 33, 33]],
    yakuman: true,
  },
  {
    name: '清老頭',
    hanText: '役満(13翻)',
    scope: '3面子 / 対子4組',
    desc: '老頭牌（1・9）のみで構成',
    example: [[9, 9, 9], [17, 17, 17], [18, 18, 18]],
    yakuman: true,
  },
  {
    name: '緑一色',
    hanText: '役満(13翻)',
    scope: '3面子 / 対子4組',
    desc: '索子の2・3・4・6・8と發のみで構成',
    example: [[19, 20, 21], [23, 23, 23], [32, 32, 32]],
    yakuman: true,
  },
];

/** 役満は13翻として扱う */
export const YAKUMAN_HAN = 13;

const yakuman = (name: string): Yaku => ({ name, han: YAKUMAN_HAN, yakuman: true });

/**
 * 雀頭を取り払った「3面子版」および「七対子（対子4組）」の役判定。
 * - 1面子：役牌のみ
 * - 2面子：役牌・一盃口・二色同順・二色同刻・二暗刻・小三元・混全帯么九・純全帯么九・混老頭
 * - 3面子：すべての役（染め手は3面子攻撃時のみ複合）
 * - 対子4組：七対子（一盃口・断么九・混老頭・清老頭・緑一色などと複合、染め手は3面子攻撃ではないため非複合）
 */
export function judgeYaku(ms: Mentsu[]): Yaku[] {
  const n = ms.length;
  const kinds = ms.flatMap(mentsuKinds);

  // ---- 七対子（対子4組） ----
  if (n === 4 && ms.every((m) => m.type === 'toitsu')) {
    const ym: Yaku[] = [];
    if (kinds.every(isHonor)) ym.push(yakuman('字一色'));
    if (kinds.every(isTerminal)) ym.push(yakuman('清老頭'));
    if (kinds.every(isGreen)) ym.push(yakuman('緑一色'));
    if (ym.length > 0) return ym;

    const yaku: Yaku[] = [{ name: '七対子', han: 2 }];

    // 対子4組の中に連続する数牌3種があれば、一盃口（同一順子2組）と複合
    const pairKinds = ms.map((m) => m.kind).sort((a, b) => a - b);
    const pairSet = new Set(pairKinds);
    const hasIipeikou = pairKinds.some(
      (k) => !isHonor(k) && numOf(k) <= 7 && pairSet.has(k + 1) && pairSet.has(k + 2),
    );
    if (hasIipeikou) yaku.push({ name: '一盃口', han: 1 });

    if (kinds.every(isSimple)) yaku.push({ name: '断么九', han: 1 });
    if (kinds.every(isYaochu)) yaku.push({ name: '混老頭', han: 2 });

    return yaku;
  }

  const sets = ms.filter(isSet);
  const dragonSets = sets.filter((m) => isDragon(m.kind));
  const allShuntsu = ms.every((m) => m.type === 'shuntsu');
  const allSets = sets.length === n;

  // ---- 役満（3面子のみ） ----
  if (n === 3) {
    const ym: Yaku[] = [];
    if (dragonSets.length === 3) ym.push(yakuman('大三元'));
    if (kinds.every(isHonor)) ym.push(yakuman('字一色'));
    if (kinds.every(isTerminal)) ym.push(yakuman('清老頭'));
    if (kinds.every(isGreen)) ym.push(yakuman('緑一色'));
    if (ym.length > 0) return ym;
  }

  const yaku: Yaku[] = [];

  // ---- 1面子から成立 ----
  for (const m of dragonSets) yaku.push({ name: `役牌 ${kindName(m.kind)}`, han: 1 });

  // ---- 2面子から成立 ----
  if (n >= 2) {
    if (dragonSets.length === 2) yaku.push({ name: '小三元', han: 2 });

    const shuntsu = ms.filter((m) => m.type === 'shuntsu');
    const shuntsuKinds = shuntsu.map((m) => m.kind);
    if (shuntsuKinds.some((k, i) => shuntsuKinds.indexOf(k) !== i)) {
      yaku.push({ name: '一盃口', han: 1 });
    }

    const hasNishokuDoujun = shuntsu.some((a, i) =>
      shuntsu.some((b, j) => i < j && numOf(a.kind) === numOf(b.kind) && suitOf(a.kind) !== suitOf(b.kind)),
    );
    if (hasNishokuDoujun) yaku.push({ name: '二色同順', han: 2 });

    const numSets = sets.filter((m) => !isHonor(m.kind));
    const hasNishokuDoukou = numSets.some((a, i) =>
      numSets.some((b, j) => i < j && numOf(a.kind) === numOf(b.kind) && suitOf(a.kind) !== suitOf(b.kind)),
    );
    if (hasNishokuDoukou) yaku.push({ name: '二色同刻', han: 2 });

    if (sets.length === 2) yaku.push({ name: '二暗刻', han: 2 });

    const hasHonor = kinds.some(isHonor);
    if (kinds.every(isYaochu)) {
      yaku.push({ name: '混老頭', han: 2 });
    } else if (ms.every((m) => mentsuKinds(m).some(isYaochu))) {
      if (hasHonor) yaku.push({ name: '混全帯么九', han: 2 });
      else yaku.push({ name: '純全帯么九', han: 3 });
    }
  }

  // ---- 3面子で成立 ----
  if (n === 3) {
    if (kinds.every(isSimple)) yaku.push({ name: '断么九', han: 1 });
    if (allShuntsu) yaku.push({ name: '平和', han: 1 });

    const suits = new Set(ms.map((m) => suitOf(m.kind)));
    if (allShuntsu && suits.size === 1) {
      const starts = ms.map((m) => numOf(m.kind)).sort();
      if (starts.join() === '1,4,7') yaku.push({ name: '一気通貫', han: 3 });
    }

    if (allSets) yaku.push({ name: '三暗刻', han: 3 });
    if (ms.every((m) => m.type === 'kantsu')) yaku.push({ name: '三槓子', han: 4 });

    const hasHonor = kinds.some(isHonor);
    const numberSuits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));

    // 染め手は3面子での攻撃時のみ複合する
    if (numberSuits.size === 1) {
      if (hasHonor) yaku.push({ name: '混一色', han: 1 });
      else yaku.push({ name: '清一色', han: 3 });
    }
  }

  return yaku;
}
