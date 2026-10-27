import { KIND_COUNT, Kind, TileId, isHonor, isYaochu, kindOf, numOf } from './tile';

export type MentsuType = 'shuntsu' | 'koutsu' | 'kantsu' | 'toitsu';

export interface Mentsu {
  type: MentsuType;
  /** 並びセットなら最小の牌、同牌セット・カン・ペアならその牌 */
  kind: Kind;
  tiles: TileId[];
  /** キープしたカンかどうか */
  declared: boolean;
}

export interface Decomposition {
  /** 3枚セット（同牌セット・並びセット）およびカン */
  sets: Mentsu[];
  /** 2枚ペア */
  pairs: Mentsu[];
  /** セットにもペアにもならない余り牌 */
  singles: TileId[];
  /** 四対子（ペア4組、同牌セットを含まない）かどうか */
  isFourPairs: boolean;
}

interface KindMentsu {
  type: MentsuType;
  kind: Kind;
}

const canStartShuntsu = (k: Kind): boolean => !isHonor(k) && numOf(k) <= 7;

/**
 * 任意の枚数の手牌と選択されたカンから、可能なセット＋ペア＋余り牌の分解をすべて列挙する。
 */
export function decomposeSelection(handTiles: TileId[], melds: Mentsu[] = []): Decomposition[] {
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of handTiles) counts[kindOf(t)]++;

  const setPatterns: KindMentsu[][] = [];
  const seen = new Set<string>();
  const cur: KindMentsu[] = [];

  const searchSets = (start: number) => {
    const key = cur.map((m) => `${m.type[0]}${m.kind}`).join(',');
    if (!seen.has(key)) {
      seen.add(key);
      setPatterns.push([...cur]);
    }
    if (cur.length + melds.length >= 3) return;

    for (let k = start; k < KIND_COUNT; k++) {
      if (counts[k] === 0) continue;
      if (counts[k] >= 3) {
        counts[k] -= 3;
        cur.push({ type: 'koutsu', kind: k });
        searchSets(k);
        cur.pop();
        counts[k] += 3;
      }
      if (canStartShuntsu(k) && counts[k + 1] > 0 && counts[k + 2] > 0) {
        counts[k]--;
        counts[k + 1]--;
        counts[k + 2]--;
        cur.push({ type: 'shuntsu', kind: k });
        searchSets(k);
        cur.pop();
        counts[k]++;
        counts[k + 1]++;
        counts[k + 2]++;
      }
    }
  };
  searchSets(0);

  const results: Decomposition[] = [];

  // 四対子判定（カンを含まず、異なる4種のペアを含み、3枚以上の同種牌を含まない）
  if (melds.length === 0 && handTiles.length >= 8) {
    const hasTriple = counts.some((c) => c >= 3);
    const pairKinds: Kind[] = [];
    for (let k = 0; k < KIND_COUNT; k++) {
      if (counts[k] === 2) pairKinds.push(k);
    }
    if (!hasTriple && pairKinds.length >= 4) {
      const chosenPairs = pairKinds.slice(0, 4).map((k) => ({ type: 'toitsu' as const, kind: k }));
      const built = buildDecomposition([], chosenPairs, handTiles, [], true);
      results.push(built);
    }
  }

  for (const sp of setPatterns) {
    const rem = [...counts];
    for (const m of sp) {
      if (m.type === 'shuntsu') {
        rem[m.kind]--;
        rem[m.kind + 1]--;
        rem[m.kind + 2]--;
      } else {
        rem[m.kind] -= 3;
      }
    }
    const pairs: KindMentsu[] = [];
    for (let k = 0; k < KIND_COUNT; k++) {
      while (rem[k] >= 2) {
        rem[k] -= 2;
        pairs.push({ type: 'toitsu', kind: k });
      }
    }
    results.push(buildDecomposition(sp, pairs, handTiles, melds, false));
  }

  return results;
}

function buildDecomposition(
  setSpecs: KindMentsu[],
  pairSpecs: KindMentsu[],
  handTiles: TileId[],
  melds: Mentsu[],
  isFourPairs: boolean,
): Decomposition {
  const pool = new Map<Kind, TileId[]>();
  for (const t of handTiles) {
    const k = kindOf(t);
    if (!pool.has(k)) pool.set(k, []);
    pool.get(k)!.push(t);
  }
  const take = (k: Kind) => pool.get(k)!.pop()!;

  const handSets: Mentsu[] = setSpecs.map((m) => {
    const ids =
      m.type === 'shuntsu'
        ? [take(m.kind), take(m.kind + 1), take(m.kind + 2)]
        : [take(m.kind), take(m.kind), take(m.kind)];
    return { type: m.type, kind: m.kind, tiles: ids, declared: false };
  });

  const pairs: Mentsu[] = pairSpecs.map((p) => ({
    type: 'toitsu',
    kind: p.kind,
    tiles: [take(p.kind), take(p.kind)],
    declared: false,
  }));

  const singles: TileId[] = [];
  for (const arr of pool.values()) {
    for (const t of arr) singles.push(t);
  }

  return {
    sets: [...handSets, ...melds],
    pairs,
    singles,
    isFourPairs,
  };
}

/**
 * 牌の集合を余りなくセット（またはペア4組）に分ける方法を列挙する（互換・テスト用）
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

  if (tiles.length === 8) {
    const pairKinds: Kind[] = [];
    for (let k = 0; k < KIND_COUNT; k++) {
      if (counts[k] === 2) pairKinds.push(k);
    }
    if (pairKinds.length === 4) {
      results.push(pairKinds.map((k) => ({ type: 'toitsu', kind: k })));
    }
  }

  return results.map((ms) => {
    const pool = new Map<Kind, TileId[]>();
    for (const t of tiles) {
      const k = kindOf(t);
      if (!pool.has(k)) pool.set(k, []);
      pool.get(k)!.push(t);
    }
    const take = (k: Kind) => pool.get(k)!.pop()!;
    return ms.map((m) => ({
      type: m.type,
      kind: m.kind,
      tiles:
        m.type === 'shuntsu'
          ? [take(m.kind), take(m.kind + 1), take(m.kind + 2)]
          : Array.from(
              { length: m.type === 'kantsu' ? 4 : m.type === 'koutsu' ? 3 : 2 },
              () => take(m.kind),
            ),
      declared: false,
    }));
  });
}

/** セットに含まれる牌の種類一覧 */
export function mentsuKinds(m: Mentsu): Kind[] {
  if (m.type === 'shuntsu') return [m.kind, m.kind + 1, m.kind + 2];
  return new Array(m.type === 'kantsu' ? 4 : m.type === 'koutsu' ? 3 : 2).fill(m.kind);
}

export const isSet = (m: Mentsu): boolean => m.type === 'koutsu' || m.type === 'kantsu';

/** 手牌の中でカンを宣言できる牌の種類 */
export function kanCandidates(hand: TileId[]): Kind[] {
  const counts = new Map<Kind, number>();
  for (const t of hand) counts.set(kindOf(t), (counts.get(kindOf(t)) ?? 0) + 1);
  return [...counts.entries()].filter(([, c]) => c >= 4).map(([k]) => k);
}

/** counts から targetSets 個の3枚セットが作れるか判定 */
function canMakeSets(counts: number[], targetSets: number, start = 0): boolean {
  if (targetSets <= 0) return true;
  for (let k = start; k < KIND_COUNT; k++) {
    if (counts[k] === 0) continue;
    if (counts[k] >= 3) {
      counts[k] -= 3;
      if (canMakeSets(counts, targetSets - 1, k)) {
        counts[k] += 3;
        return true;
      }
      counts[k] += 3;
    }
    if (canStartShuntsu(k) && counts[k + 1] > 0 && counts[k + 2] > 0) {
      counts[k]--;
      counts[k + 1]--;
      counts[k + 2]--;
      if (canMakeSets(counts, targetSets - 1, k)) {
        counts[k]++;
        counts[k + 1]++;
        counts[k + 2]++;
        return true;
      }
      counts[k]++;
      counts[k + 1]++;
      counts[k + 2]++;
    }
  }
  return false;
}

/** 手牌＋カンで3セットがすでに完成しているか */
export function hasThreeSets(hand: TileId[], melds: Mentsu[]): boolean {
  const need = 3 - melds.length;
  if (need <= 0) return true;
  if (hand.length < need * 3) return false;
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of hand) counts[kindOf(t)]++;
  return canMakeSets(counts, need);
}

/**
 * 手牌から1枚捨てたときに「あと1枚で3セットが揃う状態（聴牌）」になる捨て牌候補一覧を返す。
 */
export function findRiichiDiscards(hand: TileId[], melds: Mentsu[]): TileId[] {
  const need = 3 - melds.length;
  if (need <= 0) return [];
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of hand) counts[kindOf(t)]++;

  // 手牌がちょうど need*3 枚（通常9枚）ある場合：1枚除いて残り (need*3 - 1) 枚が聴牌か調べる
  if (hand.length >= need * 3) {
    const validDiscards: TileId[] = [];
    for (const t of hand) {
      const tk = kindOf(t);
      counts[tk]--;
      let tenpai = false;
      for (let k = 0; k < KIND_COUNT; k++) {
        counts[k]++;
        if (canMakeSets(counts, need)) {
          tenpai = true;
        }
        counts[k]--;
        if (tenpai) break;
      }
      counts[tk]++;
      if (tenpai) validDiscards.push(t);
    }
    return validDiscards;
  }

  return [];
}

/**
 * リーチ宣言可能か判定：
 * あと1枚何らかの牌が加われば3セットが揃う状態（聴牌）かどうか。
 */
export function canDeclareRiichi(hand: TileId[], melds: Mentsu[]): boolean {
  const need = 3 - melds.length;
  if (need <= 0) return false;
  if (hand.length >= need * 3) {
    return findRiichiDiscards(hand, melds).length > 0;
  }
  if (hand.length === need * 3 - 1) {
    const counts = new Array<number>(KIND_COUNT).fill(0);
    for (const t of hand) counts[kindOf(t)]++;
    for (let k = 0; k < KIND_COUNT; k++) {
      counts[k]++;
      const ok = canMakeSets(counts, need);
      counts[k]--;
      if (ok) return true;
    }
  }
  return false;
}

/** マリガン可能判定：手牌に1・9・字牌が6枚以上含まれているか */
export function canMulliganHand(hand: TileId[]): boolean {
  return hand.filter((t) => isYaochu(kindOf(t))).length >= 6;
}
