import { Mentsu, decompose } from './mentsu';
import { TileId, isYaochu } from './tile';
import { Yaku, YAKUMAN_HAN, judgeYaku } from './yaku';

/** 副底 */
export const BASE_FU = 20;
/** 七対子の固定符 */
export const CHIITOITSU_FU = 25;

export function mentsuFu(m: Mentsu): number {
  const yao = isYaochu(m.kind);
  switch (m.type) {
    case 'shuntsu':
    case 'toitsu':
      return 0;
    case 'koutsu':
      return yao ? 8 : 4; // 手牌はすべて門前なので、刻子は暗刻として扱う
    case 'kantsu':
      return yao ? 32 : 16; // 手牌の中の槓子も副露した暗槓も暗槓の符
  }
}

export const ceilTo = (v: number, unit: number): number => Math.ceil(v / unit) * unit;

export function calcFu(ms: Mentsu[]): number {
  if (ms.length === 4 && ms.every((m) => m.type === 'toitsu')) {
    return CHIITOITSU_FU;
  }
  return ceilTo(BASE_FU + ms.reduce((a, m) => a + mentsuFu(m), 0), 10);
}

/**
 * 面子数に応じたダメージ倍率ボーナス（案B）
 * - 1面子: ×1
 * - 2面子: ×2
 * - 3面子 / 七対子(対子4組): ×3
 */
export function mentsuMultiplier(ms: Mentsu[]): number {
  if (ms.length <= 1) return 1;
  if (ms.length === 2) return 2;
  return 3;
}

/** 満貫以上のランク名（満貫未満なら空文字） */
export function damageRank(fu: number, han: number): string {
  if (han >= YAKUMAN_HAN) {
    const n = Math.floor(han / YAKUMAN_HAN);
    return n === 1 ? '役満' : n === 2 ? 'ダブル役満' : `${n}倍役満`;
  }
  if (han >= 11) return '三倍満';
  if (han >= 8) return '倍満';
  if (han >= 6) return '跳満';
  if (han >= 5 || ceilTo(4 * fu * Math.pow(2, han + 2), 100) >= 8000) return '満貫';
  return '';
}

/**
 * 基本ダメージ計算（子のロン相当・満貫打ち切りあり）に、面子数倍率を掛ける
 * - 4翻以下: ceil100(4 × 符 × 2^(翻+2))（上限8,000）
 * - 5翻: 満貫 8,000
 * - 6〜7翻: 跳満 12,000
 * - 8〜10翻: 倍満 16,000
 * - 11〜12翻: 三倍満 24,000
 * - 13翻〜: 役満 32,000 × (han / 13)
 */
export function calcDamage(fu: number, han: number, multiplier = 1): number {
  let base: number;
  if (han >= YAKUMAN_HAN) {
    base = 32000 * Math.floor(han / YAKUMAN_HAN);
  } else if (han >= 11) {
    base = 24000;
  } else if (han >= 8) {
    base = 16000;
  } else if (han >= 6) {
    base = 12000;
  } else if (han >= 5) {
    base = 8000;
  } else {
    base = Math.min(8000, ceilTo(4 * fu * Math.pow(2, han + 2), 100));
  }
  return base * multiplier;
}

export interface AttackEval {
  valid: boolean;
  reason?: string;
  mentsu: Mentsu[];
  yaku: Yaku[];
  fu: number;
  han: number;
  multiplier: number;
  damage: number;
}

export const MAX_MENTSU = 3;

export function evaluateMentsu(ms: Mentsu[]): AttackEval {
  const isChiitoi = ms.length === 4 && ms.every((m) => m.type === 'toitsu');
  const yaku = judgeYaku(ms);
  const han = yaku.reduce((a, y) => a + y.han, 0);
  const fu = calcFu(ms);
  const multiplier = mentsuMultiplier(ms);
  const base = { mentsu: ms, yaku, fu, han, multiplier, damage: calcDamage(fu, han, multiplier) };

  if (ms.length === 0) return { ...base, valid: false, reason: '面子を選んでください', damage: 0 };
  if (!isChiitoi && ms.length > MAX_MENTSU) {
    return { ...base, valid: false, reason: `面子は${MAX_MENTSU}つまでです`, damage: 0 };
  }
  if (ms.length === 1 && ms[0].declared && han === 0) {
    return { ...base, valid: false, reason: '副露した槓子は単独では攻撃できません', damage: 0 };
  }
  if (ms.length >= 2 && han === 0) {
    return { ...base, valid: false, reason: '役がありません（2面子以上は役が必要）', damage: 0 };
  }
  return { ...base, valid: true };
}

/**
 * 選択された手牌と副露した槓子から、最もダメージの大きい解釈を返す。
 * 手牌を余りなく面子（または対子4組）に分けられない場合は invalid。
 */
export function evaluateSelection(handTiles: TileId[], melds: Mentsu[]): AttackEval {
  const decomps = handTiles.length === 0 ? [[]] : decompose(handTiles);
  if (decomps.length === 0) {
    return {
      valid: false,
      reason: '選んだ牌が面子（または対子4組）になっていません',
      mentsu: [],
      yaku: [],
      fu: 0,
      han: 0,
      multiplier: 1,
      damage: 0,
    };
  }
  let best: AttackEval | null = null;
  for (const d of decomps) {
    const ev = evaluateMentsu([...d, ...melds]);
    if (
      best === null ||
      (ev.valid && !best.valid) ||
      (ev.valid === best.valid && ev.damage > best.damage)
    ) {
      best = ev;
    }
  }
  return best!;
}
