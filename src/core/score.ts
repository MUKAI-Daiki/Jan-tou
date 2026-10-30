import { Decomposition, Mentsu, decomposeSelection, isSet } from './mentsu';
import {
  Kind,
  TileGroup,
  TileId,
  TileMod,
  baseTileAttack,
  isDragon,
  isFive,
  isHonor,
  isTerminal,
  isWind,
  kindOf,
  suitOf,
} from './tile';
import { JudgeContext, Yaku, calcYakuExpBonus, judgeDecompositionYaku } from './yaku';

export const SET_BONUS = {
  koutsu: 20,
  shuntsu: 10,
  toitsu: 5,
  kantsu: 30,
} as const;

export interface ScoreContext extends JudgeContext {
  level?: number;
  chain?: number;
  /** 二色同順(2)・二色同刻(3)による次チェーン倍率補正 */
  nextChainMult?: number;
  /** 牌ごとの特殊状態（gold / red / rainbow） */
  tileMods?: Readonly<Record<TileId, TileMod>>;
  /** 封印されている手牌IDと残りターン */
  sealedTiles?: Readonly<Record<TileId, number>>;
  /** 有効な装備IDのリスト（装備封印されていないもの） */
  activeEquips?: readonly string[];
  /** レベルアップボーナスによる牌種別の攻撃力加算 */
  bonusTileAtk?: Readonly<Record<TileGroup, number>>;
  /** プレイヤーの持続バフ */
  sanankouTurns?: number;
  sealYakuTurns?: number;
  slowTurns?: number;
  atkDownTurns?: number;
  venomTurns?: number;
  /** 敵の持続バフ */
  enemyDefendTurns?: number;
  /** リーチ状態かどうか */
  riichi?: boolean;
  /** リーチ中にツモ切り可能な直前補充牌 */
  drawnTiles?: readonly TileId[];
  /** 手牌全体で3セットが完成可能か（リーチ中判定用） */
  canCompleteThreeSets?: boolean;
}

export interface AttackEval {
  valid: boolean;
  reason?: string;
  decomp: Decomposition;
  mentsu: Mentsu[];
  yaku: Yaku[];
  /** 各牌の攻撃力合計 */
  tilePower: number;
  /** セット・ペア・カンのボーナス合計 */
  setBonus: number;
  /** カン補正後の基本攻撃力 */
  baseAttack: number;
  /** セット数による最終ダメージ倍率（0セット=1、1セット=1.5、2セット=2、3セット=3） */
  setCountMult: number;
  /** 職業効果によるダメージ倍率（雀剣士2倍、忍びの雀士2.5倍など） */
  jobDmgMult: number;
  /** 職業効果による追加チェーン数（忍びの雀士+1） */
  jobBonusChains: number;
  /** 麻雀医の役なし並びセットによるHP回復率（1組につき0.1＝10%） */
  basicShuntsuHealRate: number;
  /** 雀剣士の役なし同牌セットによるペア補充組数 */
  basicDrawPairs: number;
  /** 麻雀医の役なし並びセットによる2枚並び補充組数 */
  basicDrawSeq2: number;
  /** セットに含まれた金牌（＋赤牌）枚数 */
  goldCount: number;
  /** セットに含まれた赤牌枚数（同種牌の基礎攻撃力+5［永続］） */
  redCount: number;
  /** セットに含まれた虹牌枚数 */
  rainbowCount: number;
  /** セットに含まれた虹牌枚数（銭獲得用） */
  usedRainbowCount: number;
  /** 今回の攻撃で獲得する追加チェーン回数 */
  gainedChains: number;
  /** 役成立による獲得ボーナス経験値（倍率補正前） */
  yakuExp: number;
  /** リーチ3セット完成攻撃かどうか */
  isRiichiComplete: boolean;
  /** 最終ダメージ */
  damage: number;
}

function countEquip(equips: readonly string[] | undefined, id: string): number {
  if (!equips) return 0;
  return equips.filter((e) => e === id).length;
}

/** 装備効果も含めた牌の実効モディファイアを返す */
export function effectiveTileMod(
  t: TileId,
  mods?: Readonly<Record<TileId, TileMod>>,
  equips?: readonly string[],
): TileMod {
  const raw = mods?.[t] ?? 'normal';
  if (raw === 'rainbow' || raw === 'red') return raw;
  const k = kindOf(t);
  if (isFive(k) && countEquip(equips, 'all_five_red') > 0) return 'red';
  if (raw === 'gold') return 'gold';
  if (isHonor(k) && countEquip(equips, 'all_honor_gold') > 0) return 'gold';
  if (isDragon(k) && countEquip(equips, 'dragon_gold') > 0) return 'gold';
  return 'normal';
}

/** 1枚の牌の攻撃力（装備補正・レベルアップボーナス込み） */
export function calcSingleTilePower(
  k: Kind,
  equips?: readonly string[],
  bonusTileAtk?: Readonly<Record<TileGroup, number>>,
): number {
  let p = baseTileAttack(k);
  const s = suitOf(k);
  if (s === 'm') p += 5 * countEquip(equips, 'atk_man_2') + (bonusTileAtk?.m ?? 0);
  if (s === 'p') p += 5 * countEquip(equips, 'atk_pin_2') + (bonusTileAtk?.p ?? 0);
  if (s === 's') p += 5 * countEquip(equips, 'atk_sou_2') + (bonusTileAtk?.s ?? 0);
  if (isHonor(k)) p += 5 * countEquip(equips, 'atk_honor_2');
  if (isWind(k)) p += bonusTileAtk?.wind ?? 0;
  if (isDragon(k)) p += bonusTileAtk?.dragon ?? 0;
  if (isTerminal(k)) p += 5 * countEquip(equips, 'atk_term_2');
  return p;
}

export function evaluateDecomposition(
  d: Decomposition,
  allSelectedHandTiles: TileId[],
  ctx: ScoreContext = {},
): AttackEval {
  const equips = ctx.activeEquips;
  const allTiles: TileId[] = [
    ...allSelectedHandTiles,
    ...d.sets.filter((m) => m.declared).flatMap((m) => m.tiles),
  ];

  const unlockedWinds = new Set<Kind>();
  if (countEquip(equips, 'wind_east') > 0) unlockedWinds.add(27);
  if (countEquip(equips, 'wind_south') > 0) unlockedWinds.add(28);
  if (countEquip(equips, 'wind_west') > 0) unlockedWinds.add(29);
  if (countEquip(equips, 'wind_north') > 0) unlockedWinds.add(30);
  if (ctx.unlockedWinds) {
    for (const w of ctx.unlockedWinds) unlockedWinds.add(w);
  }
  const tanyaoUnlocked = Boolean(ctx.tanyaoUnlocked || countEquip(equips, 'unlock_tanyao') > 0);

  const isRiichiComplete = Boolean(
    ctx.riichi && d.sets.length === 3 && d.singles.length === 0 && d.pairs.length === 0,
  );

  const rawYaku = judgeDecompositionYaku(d, {
    unlockedWinds,
    tanyaoUnlocked,
    isRiichiComplete,
    job: ctx.job,
  });
  const yakuSealed = (ctx.sealYakuTurns ?? 0) > 0;
  const yaku = yakuSealed ? [] : rawYaku;

  const tilePower = allTiles.reduce(
    (sum, t) => sum + calcSingleTilePower(kindOf(t), equips, ctx.bonusTileAtk),
    0,
  );

  let setBonus = 0;
  for (const m of d.sets) {
    setBonus += SET_BONUS[m.type];
  }
  for (const p of d.pairs) {
    setBonus += SET_BONUS[p.type];
  }

  const flatAtk = 10 * countEquip(equips, 'flat_atk_10');
  const debuffAtk = ((ctx.atkDownTurns ?? 0) > 0 ? 10 : 0) + ((ctx.venomTurns ?? 0) > 0 ? 20 : 0);
  const rawAttack = Math.max(1, tilePower + setBonus + flatAtk - debuffAtk);

  const kanCount = d.sets.filter((m) => m.type === 'kantsu').length;
  const koutsuCount = d.sets.filter(isSet).length;
  const shuntsuCount = d.sets.filter((m) => m.type === 'shuntsu').length;

  // 役なし時のセット効果は廃止し、特定の職業でのみ効果がつく：
  // - 雀剣士(sword): 同牌セットを含む役なし攻撃が、ダメージ2倍＋補充にペアを引き込む
  // - 麻雀医(doctor): 並びセットを含む役なし攻撃が、回復10%＋補充に2個並びを引き込む
  // - 忍びの雀士(ninja): 字牌による同牌セットを含む1セット攻撃が、ダメージ2.5倍＋チェーン追加1
  const isSetsOnlyNoYaku = yaku.length === 0 && d.sets.length > 0;
  const isSwordKoutsuNoYaku = ctx.job === 'sword' && isSetsOnlyNoYaku && koutsuCount > 0;
  const isDoctorShuntsuNoYaku = ctx.job === 'doctor' && isSetsOnlyNoYaku && shuntsuCount > 0;
  const isNinjaHonorSingleSet =
    ctx.job === 'ninja' && d.sets.length === 1 && isSet(d.sets[0]) && isHonor(d.sets[0].kind);

  const basicShuntsuHealRate = isDoctorShuntsuNoYaku ? 0.1 * shuntsuCount : 0;
  const basicDrawPairs = isSwordKoutsuNoYaku ? koutsuCount : 0;
  const basicDrawSeq2 = isDoctorShuntsuNoYaku ? shuntsuCount : 0;

  let jobDmgMult = 1;
  if (isSwordKoutsuNoYaku) jobDmgMult *= 2;
  if (isNinjaHonorSingleSet) jobDmgMult *= 2.5;
  const jobBonusChains = isNinjaHonorSingleSet ? 1 : 0;

  const baseAttack = rawAttack * (1 + 0.5 * kanCount);

  // セット数ボーナス（役とも複合）：1セット=1.5倍、2セット=2倍、3セット=3倍
  const setCount = d.sets.length;
  const setCountMult = setCount >= 3 ? 3 : setCount === 2 ? 2 : setCount === 1 ? 1.5 : 1;

  // 金・赤・虹の色牌効果は、セット（d.sets）内に組み込まないと発動しない（銭獲得も同様）
  const setTileIds = new Set<TileId>(d.sets.flatMap((m) => m.tiles));
  let goldCount = 0;
  let redCount = 0;
  let rainbowCount = 0;
  for (const t of setTileIds) {
    const mod = effectiveTileMod(t, ctx.tileMods, equips);
    if (mod === 'gold' || mod === 'red') goldCount++;
    if (mod === 'red') redCount++;
    if (mod === 'rainbow') rainbowCount++;
  }
  const usedRainbowCount = rainbowCount;

  // ダメージ倍率計算
  const level = ctx.level ?? 0;
  const levelMult = 1 + level / 4;
  const yakuMult = yaku.reduce((acc, y) => acc * y.dmgMult, 1);
  const sanankouMult = (ctx.sanankouTurns ?? 0) > 0 ? 3 : 1;
  // リーチ完成時は「リーチ」役（dmgMult=2）としてyakuMultに含まれる。役封印中または役満時は重複させない
  const riichiMult = 1;
  const chain = ctx.chain ?? 0;
  const chainExtraMult = chain > 0 ? (ctx.nextChainMult ?? 1) : 1;
  const chainMult = (chain + 1) * chainExtraMult;
  const rainbowMult = rainbowCount > 0 ? Math.pow(2, rainbowCount) : 1;
  const goldMult = 1 + 0.5 * goldCount;
  const defendMult = (ctx.enemyDefendTurns ?? 0) > 0 ? 0.5 : 1;

  const damage = Math.max(
    1,
    Math.round(
      baseAttack *
        levelMult *
        setCountMult *
        jobDmgMult *
        yakuMult *
        sanankouMult *
        riichiMult *
        chainMult *
        rainbowMult *
        goldMult *
        defendMult,
    ),
  );

  // 獲得チェーン数の計算
  let gainedChains = 0;
  if (d.isFourPairs && !yakuSealed) {
    const nekoChains = yaku.filter((y) => y.id === 'neko_punch').reduce((a, y) => a + y.chains, 0);
    gainedChains += 4 + nekoChains;
  } else if (yaku.length > 0) {
    // 通常役（リーチ・つよつよこうげき含む）は1回、風牌セットは1組につき2回、ねこぱんちはペア数分
    const windChains = yaku.filter((y) => y.id.startsWith('wind_')).reduce((a, y) => a + y.chains, 0);
    const nekoChains = yaku.filter((y) => y.id === 'neko_punch').reduce((a, y) => a + y.chains, 0);
    const hasNormalYaku = yaku.some((y) => !y.id.startsWith('wind_') && y.id !== 'neko_punch');
    gainedChains += windChains + nekoChains + (hasNormalYaku ? 1 : 0);
  }
  if (isRiichiComplete && gainedChains === 0 && !yakuSealed) {
    gainedChains += 1;
  }
  gainedChains += jobBonusChains;
  if (rainbowCount > 0) {
    gainedChains += 2 * rainbowCount;
  }
  if ((ctx.slowTurns ?? 0) > 0) {
    gainedChains = 0;
  }

  const yakuExp = yaku.reduce((sum, y) => sum + calcYakuExpBonus(y), 0);

  const baseEval: AttackEval = {
    valid: true,
    decomp: d,
    mentsu: [...d.sets, ...d.pairs],
    yaku,
    tilePower,
    setBonus,
    baseAttack,
    setCountMult,
    jobDmgMult,
    jobBonusChains,
    basicShuntsuHealRate,
    basicDrawPairs,
    basicDrawSeq2,
    goldCount,
    redCount,
    rainbowCount,
    usedRainbowCount,
    gainedChains,
    yakuExp,
    isRiichiComplete,
    damage,
  };

  // バリデーション
  if (allTiles.length === 0) {
    return { ...baseEval, valid: false, reason: '攻撃に使う牌を選んでください', damage: 0 };
  }

  // 牌封印チェック
  if (ctx.sealedTiles) {
    for (const t of allSelectedHandTiles) {
      if ((ctx.sealedTiles[t] ?? 0) > 0) {
        return { ...baseEval, valid: false, reason: '封印されている牌は攻撃に使えません', damage: 0 };
      }
    }
  }

  // キープしたカンの制約：「2セット役以上」（または3セット揃えるリーチ完成）にしか使えない
  const hasDeclaredKan = d.sets.some((m) => m.declared);
  if (hasDeclaredKan) {
    const hasTwoOrMoreSetYaku = rawYaku.some((y) => y.tier === 2 || y.tier === 3 || y.id === 'riichi');
    if (d.sets.length < 2 || !hasTwoOrMoreSetYaku) {
      return {
        ...baseEval,
        valid: false,
        reason: 'キープしたカンは「2セット役以上」の攻撃にしか使えません',
        damage: 0,
      };
    }
  }

  // リーチ中の制約：3セット完成攻撃、または（未完成時は）直前補充牌1枚のツモ切りのみ可
  if (ctx.riichi) {
    if (!isRiichiComplete) {
      if (ctx.canCompleteThreeSets) {
        return {
          ...baseEval,
          valid: false,
          reason: 'リーチ中：3セットが揃っています！3セットすべてを選んで攻撃してください',
          damage: 0,
        };
      }
      const drawn = ctx.drawnTiles ?? [];
      const isTsumogiri =
        allSelectedHandTiles.length === 1 &&
        !hasDeclaredKan &&
        (drawn.length === 0 || drawn.includes(allSelectedHandTiles[0]));
      if (!isTsumogiri) {
        return {
          ...baseEval,
          valid: false,
          reason: 'リーチ中は3セットを揃えて攻撃するか、直前に補充された右端の牌1枚のみで攻撃（ツモ切り）してください',
          damage: 0,
        };
      }
    }
  }

  return baseEval;
}

/**
 * 選択された手牌（任意の枚数）とキープされたカンから、最も有利な分解・評価を返す。
 */
export function evaluateSelection(
  handTiles: TileId[],
  melds: Mentsu[] = [],
  ctx: ScoreContext = {},
): AttackEval {
  if (handTiles.length === 0 && melds.length === 0) {
    return evaluateDecomposition(
      { sets: [], pairs: [], singles: [], isFourPairs: false },
      [],
      ctx,
    );
  }

  const decomps = decomposeSelection(handTiles, melds);
  let best: AttackEval | null = null;

  const tierScore = (e: AttackEval): number => {
    if (e.yaku.some((y) => y.tier === 3)) return 4;
    if (e.decomp.isFourPairs) return 3;
    if (e.yaku.some((y) => y.tier === 2)) return 2;
    if (e.yaku.some((y) => y.tier === 1)) return 1;
    return 0;
  };

  const isBetter = (a: AttackEval, b: AttackEval): boolean => {
    if (a.valid !== b.valid) return a.valid;
    const ta = tierScore(a);
    const tb = tierScore(b);
    if (ta !== tb) return ta > tb;
    if (a.decomp.sets.length !== b.decomp.sets.length) {
      return a.decomp.sets.length > b.decomp.sets.length;
    }
    if (a.damage !== b.damage) return a.damage > b.damage;
    if (a.gainedChains !== b.gainedChains) return a.gainedChains > b.gainedChains;
    return a.decomp.pairs.length > b.decomp.pairs.length;
  };

  for (const d of decomps) {
    const ev = evaluateDecomposition(d, handTiles, ctx);
    if (best === null || isBetter(ev, best)) {
      best = ev;
    }
  }

  return best!;
}
