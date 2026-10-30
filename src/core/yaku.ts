import { Decomposition, Mentsu, isSet, mentsuKinds } from './mentsu';
import {
  Kind,
  Suit,
  isDragon,
  isGreen,
  isHonor,
  isSimple,
  isTerminal,
  isYaochu,
  kindName,
  numOf,
  suitName,
  suitOf,
} from './tile';

export type YakuId =
  | 'riichi'
  | 'haku'
  | 'hatsu'
  | 'chun'
  | 'wind_27'
  | 'wind_28'
  | 'wind_29'
  | 'wind_30'
  | 'iipeikou'
  | 'nishoku_doujun'
  | 'nishoku_doukou'
  | 'niankou'
  | 'chanta'
  | 'tanyao'
  | 'four_pairs'
  | 'honiisou'
  | 'pinfu'
  | 'sanankou'
  | 'chinroutou'
  | 'chiniisou'
  | 'daisangen'
  | 'ryuuiisou'
  | 'tsuuiisou'
  | 'sankantsu';

export interface Yaku {
  id: YakuId;
  name: string;
  tier: 1 | 2 | 3 | 'special';
  /** 即時ダメージ倍率（通常1、タンヤオ1.5、發/リーチ2、役満相当10） */
  dmgMult: number;
  /** この役で発生するチェーン回数 */
  chains: number;
  /** 効果の短い説明 */
  effectText: string;
  /** 清一色成立時の数牌種類 */
  suit?: Suit;
}

export const YAKUMAN_IDS: ReadonlySet<YakuId> = new Set([
  'daisangen',
  'ryuuiisou',
  'tsuuiisou',
  'sankantsu',
]);

export function isYakumanYaku(id: YakuId): boolean {
  return YAKUMAN_IDS.has(id);
}

/** 役成立時の獲得経験値（1セット役・リーチ < 2セット役 < 3セット役 < 役満相当役） */
export function calcYakuExpBonus(y: Yaku): number {
  if (YAKUMAN_IDS.has(y.id)) return 1200;
  if (y.tier === 3) return 500;
  if (y.tier === 2 || y.tier === 'special') return 200;
  return 80;
}

/**
 * スコア計算用の役ポイント
 * （1セット役・リーチ ＜ 2セット役 ＜ 四対子 ＜ 3セット役（通常） ＜ 3セット役（役満相当））
 */
export function calcYakuScore(y: Yaku): number {
  if (YAKUMAN_IDS.has(y.id)) return 5000;
  if (y.tier === 3) return 1500;
  if (y.id === 'four_pairs' || y.tier === 'special') return 800;
  if (y.tier === 2) return 400;
  return 150;
}

export interface JudgeContext {
  unlockedWinds?: ReadonlySet<Kind>;
  tanyaoUnlocked?: boolean;
  /** リーチ中に3セットを完成させて攻撃したか */
  isRiichiComplete?: boolean;
}

export interface YakuCatalogEntry {
  name: string;
  scope: '1セット役' | '2セット役' | '3セット役' | '3セット役（役満）' | '特殊役' | '装備役';
  effect: string;
  desc: string;
  example: readonly (readonly Kind[])[];
  highTier?: boolean;
}

/** UI表示用の役一覧カタログ（シンプル表記＆具体例つき） */
export const YAKU_CATALOG: readonly YakuCatalogEntry[] = [
  // ---- 1セット役 ----
  {
    name: '白セット',
    scope: '1セット役',
    effect: '次被ダメ無効・チェーン1',
    desc: '「白」3枚（またはカン）',
    example: [[31, 31, 31]],
  },
  {
    name: '發セット',
    scope: '1セット役',
    effect: '威力2倍・チェーン1',
    desc: '「發」3枚（またはカン）',
    example: [[32, 32, 32]],
  },
  {
    name: '中セット',
    scope: '1セット役',
    effect: '補充3枚金化・+30銭・チェーン1',
    desc: '「中」3枚（またはカン）',
    example: [[33, 33, 33]],
  },
  {
    name: 'リーチ',
    scope: '1セット役',
    effect: '威力2倍・補充30%金化・チェーン1',
    desc: 'リーチ中に3セット完成で攻撃',
    example: [[0, 1, 2], [12, 13, 14], [20, 21, 22]],
  },

  // ---- 2セット役 ----
  {
    name: 'タンヤオ',
    scope: '2セット役',
    effect: '威力1.5倍・チェーン1',
    desc: '2〜8の数牌のみで2セット以上',
    example: [[1, 2, 3], [12, 12, 12]],
  },
  {
    name: '一盃口',
    scope: '2セット役',
    effect: 'ペア3組補充・チェーン1',
    desc: '同種・同数字の並びセット2組',
    example: [[0, 1, 2], [0, 1, 2]],
  },
  {
    name: '二色同順',
    scope: '2セット役',
    effect: '次チェーン倍率2倍・チェーン1',
    desc: '異種・同数字の並びセット2組',
    example: [[1, 2, 3], [10, 11, 12]],
  },
  {
    name: '二色同刻',
    scope: '2セット役',
    effect: '次チェーン倍率3倍・チェーン1',
    desc: '異種・同数字の同牌セット2組',
    example: [[4, 4, 4], [13, 13, 13]],
  },
  {
    name: '二暗刻',
    scope: '2セット役',
    effect: '同牌セット1組補充・チェーン1',
    desc: '同牌セット（またはカン）2組以上',
    example: [[1, 1, 1], [24, 24, 24]],
  },
  {
    name: 'チャンタ',
    scope: '2セット役',
    effect: '手牌と補充の1・9・字牌を金化・+50銭・チェーン1',
    desc: '全セットに1・9・字牌を含む2セット以上',
    example: [[0, 1, 2], [27, 27, 27]],
  },

  // ---- 特殊役 ----
  {
    name: '四対子',
    scope: '特殊役',
    effect: 'チェーン4',
    desc: '異なるペア4組（計8枚）',
    example: [[1, 1], [12, 12], [20, 20], [31, 31]],
  },

  // ---- 3セット役（他の役とも複合可能） ----
  {
    name: '混一色',
    scope: '3セット役',
    effect: '5T字牌を金で補充・チェーン1',
    desc: '1種の数牌＋字牌で3セット',
    example: [[0, 1, 2], [4, 5, 6], [27, 27, 27]],
  },
  {
    name: '平和',
    scope: '3セット役',
    effect: '5T毎ターンHP回復・チェーン1',
    desc: '並びセット3組',
    example: [[0, 1, 2], [12, 13, 14], [20, 21, 22]],
  },
  {
    name: '三暗刻',
    scope: '3セット役',
    effect: '5T威力3倍・チェーン1',
    desc: '同牌セット（またはカン）3組',
    example: [[1, 1, 1], [13, 13, 13], [25, 25, 25]],
  },
  {
    name: '清老頭',
    scope: '3セット役',
    effect: '5T補充が2〜8＆30%金化・+150銭・チェーン1',
    desc: '1・9の数牌のみで3セット',
    example: [[0, 0, 0], [8, 8, 8], [17, 17, 17]],
  },
  {
    name: '清一色',
    scope: '3セット役',
    effect: '5T山外から同種数牌を補充・チェーン1',
    desc: '同種の数牌のみで3セット',
    example: [[9, 10, 11], [12, 13, 14], [16, 16, 16]],
  },

  // ---- 3セット役（役満相当・非複合） ----
  {
    name: '大三元',
    scope: '3セット役（役満）',
    effect: '威力10倍・装備3個獲得・+500銭・チェーン1',
    desc: '白・發・中のセット3組（非複合）',
    example: [[31, 31, 31], [32, 32, 32], [33, 33, 33]],
    highTier: true,
  },
  {
    name: '緑一色',
    scope: '3セット役（役満）',
    effect: '威力10倍・HP全回復・+500銭・チェーン1',
    desc: '索子2・3・4・6・8と發のみで3セット（非複合）',
    example: [[19, 20, 21], [23, 23, 23], [32, 32, 32]],
    highTier: true,
  },
  {
    name: '字一色',
    scope: '3セット役（役満）',
    effect: '威力10倍・即時Lv+3・+500銭・チェーン1',
    desc: '字牌のみで3セット（非複合）',
    example: [[27, 27, 27], [28, 28, 28], [31, 31, 31]],
    highTier: true,
  },
  {
    name: '三槓子',
    scope: '3セット役（役満）',
    effect: '威力10倍・伝説装備1個・EXP30倍・+500銭・チェーン1',
    desc: 'カン3組（非複合）',
    example: [[1, 1, 1, 1], [13, 13, 13, 13], [25, 25, 25, 25]],
    highTier: true,
  },

  // ---- 装備解禁役 ----
  {
    name: '風牌セット',
    scope: '装備役',
    effect: 'チェーン2',
    desc: '対応する風の紋章所持時、その風牌3枚',
    example: [[27, 27, 27]],
  },
];

/**
 * 分解結果（Decomposition）に対して成立する役を判定する。
 * - 役満相当の3セット役（大三元・緑一色・字一色・三槓子）が成立した場合は他の役とは複合せず単体で返す。
 * - それ以外の役（通常3セット役・2セット役・1セット役・リーチ）はすべて複合する。
 */
export function judgeDecompositionYaku(d: Decomposition, ctx: JudgeContext = {}): Yaku[] {
  // 1. 四対子（ペア4組）
  if (d.isFourPairs) {
    return [
      {
        id: 'four_pairs',
        name: '四対子',
        tier: 'special',
        dmgMult: 1,
        chains: 4,
        effectText: '4回チェーン可能',
      },
    ];
  }

  const ms = d.sets;
  const n = ms.length;
  if (n === 0) return [];

  const kinds = ms.flatMap(mentsuKinds);
  const sets = ms.filter(isSet);
  const dragonSets = sets.filter((m) => isDragon(m.kind));
  const allShuntsu = ms.every((m) => m.type === 'shuntsu');
  const allSets = sets.length === n;

  // 2. 役満相当の3セット役（他の役とは複合しない）
  if (n === 3) {
    if (ms.every((m) => m.type === 'kantsu')) {
      return [
        {
          id: 'sankantsu',
          name: '三槓子',
          tier: 3,
          dmgMult: 10,
          chains: 1,
          effectText: '威力10倍・伝説装備1・EXP30倍・+500銭',
        },
      ];
    }
    if (dragonSets.length === 3) {
      return [
        {
          id: 'daisangen',
          name: '大三元',
          tier: 3,
          dmgMult: 10,
          chains: 1,
          effectText: '威力10倍・装備3個・+500銭',
        },
      ];
    }
    if (kinds.every(isGreen)) {
      return [
        {
          id: 'ryuuiisou',
          name: '緑一色',
          tier: 3,
          dmgMult: 10,
          chains: 1,
          effectText: '威力10倍・HP全回復・+500銭',
        },
      ];
    }
    if (kinds.every(isHonor)) {
      return [
        {
          id: 'tsuuiisou',
          name: '字一色',
          tier: 3,
          dmgMult: 10,
          chains: 1,
          effectText: '威力10倍・Lv+3・+500銭',
        },
      ];
    }
  }

  // 3. 複合可能な役（リーチ・通常3セット役・2セット役・1セット役）
  const yaku: Yaku[] = [];

  if (ctx.isRiichiComplete && n === 3) {
    yaku.push({
      id: 'riichi',
      name: 'リーチ',
      tier: 1,
      dmgMult: 2,
      chains: 1,
      effectText: '威力2倍・補充30%金化',
    });
  }

  // 通常3セット役（他の役とも複合する）
  if (n === 3) {
    if (kinds.every(isTerminal)) {
      yaku.push({
        id: 'chinroutou',
        name: '清老頭',
        tier: 3,
        dmgMult: 1,
        chains: 1,
        effectText: '5T補充2〜8＆30%金化・+150銭',
      });
    }

    const hasHonor = kinds.some(isHonor);
    const numberSuits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
    if (!hasHonor && numberSuits.size === 1) {
      const suit = [...numberSuits][0];
      yaku.push({
        id: 'chiniisou',
        name: '清一色',
        tier: 3,
        dmgMult: 1,
        chains: 1,
        effectText: `5T山外から${suitName(suit)}補充`,
        suit,
      });
    }
    if (allSets) {
      yaku.push({
        id: 'sanankou',
        name: '三暗刻',
        tier: 3,
        dmgMult: 1,
        chains: 1,
        effectText: '5T威力3倍',
      });
    }
    if (hasHonor && numberSuits.size === 1) {
      yaku.push({
        id: 'honiisou',
        name: '混一色',
        tier: 3,
        dmgMult: 1,
        chains: 1,
        effectText: '5T字牌を金で補充',
      });
    }
    if (allShuntsu) {
      yaku.push({
        id: 'pinfu',
        name: '平和',
        tier: 3,
        dmgMult: 1,
        chains: 1,
        effectText: '5T HP自動回復',
      });
    }
  }

  // 1セット役：三元牌
  for (const m of dragonSets) {
    if (m.kind === 31) {
      yaku.push({ id: 'haku', name: '白セット', tier: 1, dmgMult: 1, chains: 1, effectText: '次被ダメ無効' });
    } else if (m.kind === 32) {
      yaku.push({ id: 'hatsu', name: '發セット', tier: 1, dmgMult: 2, chains: 1, effectText: '威力2倍' });
    } else if (m.kind === 33) {
      yaku.push({ id: 'chun', name: '中セット', tier: 1, dmgMult: 1, chains: 1, effectText: '補充3枚金化・+30銭' });
    }
  }

  // 1セット役：解禁された風牌セット
  if (ctx.unlockedWinds) {
    for (const m of sets) {
      if (ctx.unlockedWinds.has(m.kind)) {
        const wId = `wind_${m.kind}` as YakuId;
        yaku.push({
          id: wId,
          name: `${kindName(m.kind)}セット`,
          tier: 1,
          dmgMult: 1,
          chains: 2,
          effectText: 'チェーン2',
        });
      }
    }
  }

  // 2セット役
  if (n >= 2) {
    const shuntsu = ms.filter((m) => m.type === 'shuntsu');
    const shuntsuKinds = shuntsu.map((m) => m.kind);
    if (shuntsuKinds.some((k, i) => shuntsuKinds.indexOf(k) !== i)) {
      yaku.push({
        id: 'iipeikou',
        name: '一盃口',
        tier: 2,
        dmgMult: 1,
        chains: 1,
        effectText: 'ペア3組補充',
      });
    }

    const hasNishokuDoujun = shuntsu.some((a, i) =>
      shuntsu.some((b, j) => i < j && numOf(a.kind) === numOf(b.kind) && suitOf(a.kind) !== suitOf(b.kind)),
    );
    if (hasNishokuDoujun) {
      yaku.push({
        id: 'nishoku_doujun',
        name: '二色同順',
        tier: 2,
        dmgMult: 1,
        chains: 1,
        effectText: '次チェーン倍率2倍',
      });
    }

    const numSets = sets.filter((m) => !isHonor(m.kind));
    const hasNishokuDoukou = numSets.some((a, i) =>
      numSets.some((b, j) => i < j && numOf(a.kind) === numOf(b.kind) && suitOf(a.kind) !== suitOf(b.kind)),
    );
    if (hasNishokuDoukou) {
      yaku.push({
        id: 'nishoku_doukou',
        name: '二色同刻',
        tier: 2,
        dmgMult: 1,
        chains: 1,
        effectText: '次チェーン倍率3倍',
      });
    }

    if (sets.length >= 2) {
      yaku.push({
        id: 'niankou',
        name: '二暗刻',
        tier: 2,
        dmgMult: 1,
        chains: 1,
        effectText: '同牌セット補充',
      });
    }

    if (ms.every((m) => mentsuKinds(m).some(isYaochu))) {
      yaku.push({
        id: 'chanta',
        name: 'チャンタ',
        tier: 2,
        dmgMult: 1,
        chains: 1,
        effectText: '1・9・字牌を金化・+50銭',
      });
    }

    // タンヤオは装備なしでも常時発動可能
    if (kinds.every(isSimple)) {
      yaku.push({
        id: 'tanyao',
        name: 'タンヤオ',
        tier: 2,
        dmgMult: 1.5,
        chains: 1,
        effectText: '威力1.5倍',
      });
    }
  }

  return yaku;
}

/** 従来の Mentsu[] を直接渡す場合のヘルパー */
export function judgeYaku(ms: Mentsu[], ctx: JudgeContext = {}): Yaku[] {
  const isFourPairs = ms.length === 4 && ms.every((m) => m.type === 'toitsu');
  const d: Decomposition = {
    sets: isFourPairs ? [] : ms.filter((m) => m.type !== 'toitsu'),
    pairs: isFourPairs ? ms : ms.filter((m) => m.type === 'toitsu'),
    singles: [],
    isFourPairs,
  };
  return judgeDecompositionYaku(d, ctx);
}

