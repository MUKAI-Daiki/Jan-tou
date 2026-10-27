import { KIND_COUNT, Kind, TileId, kindOf, numOf, isHonor } from './tile';

export type MentsuType = 'shuntsu' | 'koutsu' | 'kantsu' | 'toitsu';

export interface Mentsu {
  type: MentsuType;
  /** 順子なら最小の牌、刻子・槓子・対子ならその牌 */
  kind: Kind;
  tiles: TileId[];
  /** 副露した暗槓かどうか */
  declared: boolean;
}

/** 種類ごとの枚数分布で表した面子 */
interface KindMentsu {
  type: MentsuType;
  kind: Kind;
}

const canStartShuntsu = (k: Kind): boolean => !isHonor(k) && numOf(k) <= 7;

/**
 * 牌の集合を余りなく面子（または対子4組の七対子）に分ける方法をすべて列挙する。
 * 分けられない場合は空配列を返す。
 */
export function decompose(tiles: TileId[]): Mentsu[][] {
  if (tiles.length === 0) return [];
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of tiles) counts[kindOf(t)]++;

  const results: KindMentsu[][] = [];
  const cur: KindMentsu[] = [];

  const rec = (start: number) => {
    let k = start;
    while (k < KIND_COUNT && counts[k] === 0) k++;
    if (k === KIND_COUNT) {
      results.push([...cur]);
      return;
    }
    if (counts[k] >= 4) {
      counts[k] -= 4;
      cur.push({ type: 'kantsu', kind: k });
      rec(k);
      cur.pop();
      counts[k] += 4;
    }
    if (counts[k] >= 3) {
      counts[k] -= 3;
      cur.push({ type: 'koutsu', kind: k });
      rec(k);
      cur.pop();
      counts[k] += 3;
    }
    if (canStartShuntsu(k) && counts[k + 1] > 0 && counts[k + 2] > 0) {
      counts[k]--;
      counts[k + 1]--;
      counts[k + 2]--;
      cur.push({ type: 'shuntsu', kind: k });
      rec(k);
      cur.pop();
      counts[k]++;
      counts[k + 1]++;
      counts[k + 2]++;
    }
  };
  rec(0);

  // 七対子（異なる4種の対子＝8枚）の分解を追加
  if (tiles.length === 8) {
    const pairKinds: Kind[] = [];
    for (let k = 0; k < KIND_COUNT; k++) {
      if (counts[k] === 2) pairKinds.push(k);
    }
    if (pairKinds.length === 4) {
      results.push(pairKinds.map((k) => ({ type: 'toitsu', kind: k })));
    }
  }

  return results.map((ms) => assignTiles(ms, tiles));
}

/** 種類レベルの分解に、実際の牌IDを割り当てる */
function assignTiles(ms: KindMentsu[], tiles: TileId[]): Mentsu[] {
  const pool = new Map<Kind, TileId[]>();
  for (const t of tiles) {
    const k = kindOf(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(t);
  }
  const take = (k: Kind) => pool.get(k)!.pop()!;
  return ms.map((m) => {
    const ids =
      m.type === 'shuntsu'
        ? [take(m.kind), take(m.kind + 1), take(m.kind + 2)]
        : Array.from(
            { length: m.type === 'kantsu' ? 4 : m.type === 'koutsu' ? 3 : 2 },
            () => take(m.kind),
          );
    return { type: m.type, kind: m.kind, tiles: ids, declared: false };
  });
}

/** 面子に含まれる牌の種類一覧 */
export function mentsuKinds(m: Mentsu): Kind[] {
  if (m.type === 'shuntsu') return [m.kind, m.kind + 1, m.kind + 2];
  return new Array(m.type === 'kantsu' ? 4 : m.type === 'koutsu' ? 3 : 2).fill(m.kind);
}

export const isSet = (m: Mentsu): boolean => m.type === 'koutsu' || m.type === 'kantsu';

/** 手牌の中で暗槓を宣言できる牌の種類 */
export function kanCandidates(hand: TileId[]): Kind[] {
  const counts = new Map<Kind, number>();
  for (const t of hand) counts.set(kindOf(t), (counts.get(kindOf(t)) ?? 0) + 1);
  return [...counts.entries()].filter(([, c]) => c >= 4).map(([k]) => k);
}
