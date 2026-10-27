/**
 * 牌の定義。
 * - 下位8ビット (id & 0xff) が従来の 0..135 (種類 = (id & 0xff) >> 2)
 * - 上位ビット (id >>> 8) は山外生成や変化牌用のユニーク連番
 * - 種類(kind): 0-8 萬子 / 9-17 筒子 / 18-26 索子 / 27-30 東南西北 / 31-33 白發中
 * - 全34種136枚を使用
 */

export type TileId = number;
export type Kind = number;
export type Suit = 'm' | 'p' | 's' | 'z';
export type TileMod = 'normal' | 'gold' | 'red' | 'rainbow';

export const KIND_COUNT = 34;
export const TILE_COUNT = 136;

/** ゲーム内で使用する全34種類の牌 */
export const ACTIVE_KINDS: readonly Kind[] = Array.from({ length: KIND_COUNT }, (_, i) => i);

export const kindOf = (id: TileId): Kind => (id & 0xff) >> 2;

export const makeTileId = (kind: Kind, uid: number): TileId => ((uid & 0x7fffff) << 8) | ((kind & 0x3f) << 2);

export const suitOf = (k: Kind): Suit =>
  k < 9 ? 'm' : k < 18 ? 'p' : k < 27 ? 's' : 'z';

/** 数牌は1-9、字牌は1-7（東南西北白發中） */
export const numOf = (k: Kind): number => (k < 27 ? (k % 9) + 1 : k - 26);

export const isHonor = (k: Kind): boolean => k >= 27;
export const isWind = (k: Kind): boolean => k >= 27 && k <= 30;
export const isDragon = (k: Kind): boolean => k >= 31;
export const isTerminal = (k: Kind): boolean => !isHonor(k) && (numOf(k) === 1 || numOf(k) === 9);
export const isYaochu = (k: Kind): boolean => isHonor(k) || isTerminal(k);
export const isSimple = (k: Kind): boolean => !isYaochu(k);
export const isFive = (k: Kind): boolean => !isHonor(k) && numOf(k) === 5;

/** 緑一色の構成牌: 索子2,3,4,6,8 と 發 */
const GREEN = new Set<Kind>([19, 20, 21, 23, 25, 32]);
export const isGreen = (k: Kind): boolean => GREEN.has(k);

/** 牌の基礎攻撃力: 1・9・字牌は10、2〜8はその数字 */
export const baseTileAttack = (k: Kind): number => (isYaochu(k) ? 10 : numOf(k));

const MAN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const PIN_NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const HONOR = ['東', '南', '西', '北', '白', '發', '中'];

/** 表示用ラベル（上段・下段） */
export function tileFace(k: Kind): { top: string; bottom: string } {
  const s = suitOf(k);
  const n = numOf(k);
  if (s === 'm') return { top: MAN_NUM[n - 1], bottom: '萬' };
  if (s === 'p') return { top: PIN_NUM[n - 1], bottom: '筒' };
  if (s === 's') return { top: String(n), bottom: '索' };
  return { top: HONOR[n - 1], bottom: '' };
}

/** ログ用の短い名前（例: 5筒, 白） */
export function kindName(k: Kind): string {
  const s = suitOf(k);
  const n = numOf(k);
  if (s === 'm') return `${n}萬`;
  if (s === 'p') return `${n}筒`;
  if (s === 's') return `${n}索`;
  return HONOR[n - 1];
}

export const suitName = (s: Suit): string =>
  s === 'm' ? '萬子' : s === 'p' ? '筒子' : s === 's' ? '索子' : '字牌';

export const allTileIds = (): TileId[] =>
  ACTIVE_KINDS.flatMap((k) => [k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 3]);

export const sortTiles = (ids: TileId[]): TileId[] =>
  [...ids].sort((a, b) => (a & 0xff) - (b & 0xff) || a - b);
