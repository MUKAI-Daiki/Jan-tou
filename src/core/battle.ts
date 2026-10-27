import { EQUIPMENTS, Rarity, getEquipment } from '../data/equipments';
import { EXP_PER_LEVEL, MAX_STAGE, MONSTERS, MonsterDef, PLAYER_INITIAL_HP } from '../data/monsters';
import { Mentsu, canDeclareRiichi, canMulliganHand, findRiichiDiscards, hasThreeSets } from './mentsu';
import { chooseMonsterSkill, rollMonsterDamage } from './monster';
import { Rng } from './rng';
import { AttackEval, ScoreContext, evaluateSelection } from './score';
import {
  ACTIVE_KINDS,
  KIND_COUNT,
  Kind,
  Suit,
  TileId,
  TileMod,
  allTileIds,
  isDragon,
  isFive,
  isHonor,
  isSimple,
  isYaochu,
  kindName,
  kindOf,
  makeTileId,
  suitName,
  suitOf,
} from './tile';

/** 基本手牌枚数（3セット＝9枚分。カン1つにつき手牌枠は-3枚） */
export const HAND_SIZE = 9;

export interface LogEntry {
  side: 'player' | 'monster' | 'system';
  text: string;
}

export interface BattleEvent {
  type: 'damage' | 'heal';
  target: 'player' | 'monster';
  amount: number;
}

export interface PlayerBuffs {
  /** 白セット：次の敵ダメージを無効化 */
  nullifyDamage: boolean;
  /** 混一色：字牌が金牌として補充される残りターン */
  honiisouTurns: number;
  /** 平和：毎ターンHP自動回復の残りターン */
  pinfuTurns: number;
  /** 三暗刻：ダメージ3倍の残りターン */
  sanankouTurns: number;
  /** 清老頭：補充が2〜8の数牌のみ＆30%金牌化の残りターン */
  chinroutouTurns: number;
  /** 清一色：残り牌外から同種数牌が補充される残りターン */
  chiniisouTurns: number;
  chiniisouSuit: Suit | null;
  /** 敵デバフ：役の効果封印 */
  sealYakuTurns: number;
  /** 敵デバフ：攻撃力合計-10 */
  atkDownTurns: number;
  /** 敵デバフ：チェーン不可 */
  slowTurns: number;
  /** 敵デバフ：猛毒（攻撃力-20＋攻撃後HP-10%） */
  venomTurns: number;
}

export interface EnemyBuffs {
  /** ためる：次ターンのダメージ3倍 */
  charged: boolean;
  /** 防御：被ダメージ半減の残りターン */
  defendTurns: number;
  /** 反射：受けたダメージの半分を跳ね返す残りターン */
  reflectTurns: number;
}

export interface SkillCooldowns {
  resetWall: number;
  copy: number;
  search: number;
}

export interface BattleState {
  rng: number;
  uid: number;
  stage: number;
  /** 残り牌 */
  wall: TileId[];
  /** 手牌 */
  hand: TileId[];
  /** キープしたカン */
  melds: Mentsu[];
  /** 直前の操作で補充された牌 */
  drawn: TileId[];
  /** 牌ごとの特殊状態（金牌・赤牌・虹牌） */
  tileMods: Record<TileId, TileMod>;
  /** 牌封印の残りターン数 */
  sealedTiles: Record<TileId, number>;
  /** 永続的に残り牌0になった牌種 */
  banishedKinds: Kind[];
  player: {
    hp: number;
    maxHp: number;
    level: number;
    exp: number;
  };
  /** 所持している装備ID一覧 */
  equipments: string[];
  /** 敵の「装備封印」で無効化中の装備インデックス */
  sealedEquipIndices: number[];
  monster: {
    def: MonsterDef;
    hp: number;
    maxHp: number;
  };
  turn: number;
  /** このターンに連続攻撃した回数（Chain数） */
  chain: number;
  /** 残りの追加攻撃（チェーン）ストック数 */
  extraChains: number;
  /** 二色同順(2)・二色同刻(3)による次チェーン倍率 */
  nextChainMult: number;
  /** リーチ宣言中かどうか */
  riichi: boolean;
  /** このバトルで使用したマリガン回数（最大2回） */
  mulligansUsed: number;
  /** このバトルで発動した敗北回避回数 */
  revivedThisBattle: number;
  /** 特殊行動「治療」がONかどうか */
  healMode: boolean;
  /** このバトルの経験値倍率（三槓子で30倍） */
  expMult: number;
  cooldowns: SkillCooldowns;
  buffs: PlayerBuffs;
  enemyBuffs: EnemyBuffs;
  /** バトル勝利後の装備報酬3択 */
  rewardChoices: string[];
  resets: number;
  status: 'playing' | 'reward' | 'won' | 'lost';
  log: LogEntry[];
  events: BattleEvent[];
}

export type Action =
  | { type: 'attack'; tiles: TileId[]; melds: number[] }
  | { type: 'kan'; kind: Kind }
  | { type: 'riichi'; discardTile?: TileId }
  | { type: 'cancel_riichi' }
  | { type: 'mulligan' }
  | { type: 'toggle_heal' }
  | { type: 'skill_reset_wall' }
  | { type: 'skill_copy'; targetTile: TileId; sourceTile: TileId }
  | { type: 'skill_search'; targetTile: TileId; kind: Kind }
  | { type: 'choose_reward'; equipId: string };

export interface StepResult {
  state: BattleState;
  error?: string;
  attack?: AttackEval;
}

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

export function getActiveEquips(s: BattleState): string[] {
  const sealed = new Set(s.sealedEquipIndices);
  return s.equipments.filter((_, idx) => !sealed.has(idx));
}

export function countActiveEquip(s: BattleState, id: string): number {
  return getActiveEquips(s).filter((e) => e === id).length;
}

export function buildScoreContext(s: BattleState): ScoreContext {
  return {
    level: s.player.level,
    chain: s.chain,
    nextChainMult: s.nextChainMult,
    tileMods: s.tileMods,
    sealedTiles: s.sealedTiles,
    activeEquips: getActiveEquips(s),
    sanankouTurns: s.buffs.sanankouTurns,
    sealYakuTurns: s.buffs.sealYakuTurns,
    slowTurns: s.buffs.slowTurns,
    atkDownTurns: s.buffs.atkDownTurns,
    venomTurns: s.buffs.venomTurns,
    enemyDefendTurns: s.enemyBuffs.defendTurns,
    riichi: s.riichi,
    drawnTiles: s.drawn,
    canCompleteThreeSets: hasThreeSets(s.hand, s.melds),
  };
}

function isKindBanished(s: BattleState, k: Kind): boolean {
  if (s.banishedKinds.includes(k)) return true;
  const equips = getActiveEquips(s);
  if (isHonor(k) && equips.includes('no_honor_wall')) return true;
  const suit = suitOf(k);
  if (suit === 'm' && equips.includes('no_man_wall')) return true;
  if (suit === 'p' && equips.includes('no_pin_wall')) return true;
  if (suit === 's' && equips.includes('no_sou_wall')) return true;
  return false;
}

function enforceWallRestrictions(s: BattleState): void {
  s.wall = s.wall.filter((t) => !isKindBanished(s, kindOf(t)));
}

function resetWallFull(s: BattleState): void {
  const used = new Set<TileId>([...s.hand, ...s.melds.flatMap((m) => m.tiles)]);
  s.wall = allTileIds().filter((t) => !used.has(t) && !isKindBanished(s, kindOf(t)));
  // 赤五の宝珠所持時は (id & 3) === 0 の5の牌に赤属性を付与
  const hasRedOne = countActiveEquip(s, 'red_five_1') > 0;
  const hasRedAll = countActiveEquip(s, 'all_five_red') > 0;
  for (const t of s.wall) {
    const k = kindOf(t);
    if (isFive(k) && (hasRedAll || (hasRedOne && (t & 3) === 0))) {
      s.tileMods[t] = 'red';
    }
  }
}

function decorateDrawnTile(
  s: BattleState,
  rng: Rng,
  tile: TileId,
  opts: { forceGold?: boolean; ignoreEffects?: boolean } = {},
): void {
  if (opts.ignoreEffects) return;
  const k = kindOf(tile);
  const equips = getActiveEquips(s);

  // 赤牌判定
  if (isFive(k)) {
    const hasRedAll = equips.includes('all_five_red');
    const hasRedOne = equips.includes('red_five_1');
    if (hasRedAll || (hasRedOne && (tile & 3) === 0)) {
      s.tileMods[tile] = 'red';
    }
  }

  // 虹牌直接抽選（補充牌10%で虹牌）
  const rainbowChanceCount = equips.filter((e) => e === 'draw_rainbow_10').length;
  for (let i = 0; i < rainbowChanceCount; i++) {
    if (rng.int(100) < 10) {
      s.tileMods[tile] = 'rainbow';
      return;
    }
  }

  // 金牌判定
  let isGold = Boolean(opts.forceGold || s.tileMods[tile] === 'gold' || s.tileMods[tile] === 'red');
  if (!isGold && s.buffs.honiisouTurns > 0 && isHonor(k)) isGold = true;
  if (!isGold && s.buffs.chinroutouTurns > 0 && rng.int(100) < 30) isGold = true;
  if (!isGold && isHonor(k) && equips.includes('all_honor_gold')) isGold = true;
  if (!isGold && isDragon(k) && equips.includes('dragon_gold')) isGold = true;

  const goldChanceCount = equips.filter((e) => e === 'draw_gold_10').length;
  for (let i = 0; i < goldChanceCount && !isGold; i++) {
    if (rng.int(100) < 10) isGold = true;
  }

  if (isGold) {
    if (s.tileMods[tile] !== 'red') {
      s.tileMods[tile] = 'gold';
    }
    // 金牌が手牌に入る際、30%の確率で虹牌になる
    const prismCount = equips.filter((e) => e === 'gold_to_rainbow_30').length;
    for (let i = 0; i < prismCount; i++) {
      if (rng.int(100) < 30) {
        s.tileMods[tile] = 'rainbow';
        break;
      }
    }
  }
}

function drawOne(
  s: BattleState,
  rng: Rng,
  opts: { forceGold?: boolean; forceKind?: Kind; ignoreEffects?: boolean } = {},
): TileId {
  enforceWallRestrictions(s);

  // 指定された種類の牌を山外または山から引く
  if (opts.forceKind !== undefined) {
    const idx = s.wall.findIndex((t) => kindOf(t) === opts.forceKind);
    let tile: TileId;
    if (idx >= 0) {
      tile = s.wall[idx];
      s.wall[idx] = s.wall[s.wall.length - 1];
      s.wall.pop();
    } else {
      tile = makeTileId(opts.forceKind, ++s.uid);
    }
    decorateDrawnTile(s, rng, tile, opts);
    s.hand.push(tile);
    s.drawn.push(tile);
    return tile;
  }

  // 清一色バフ中：残り牌外から成立させたスートの牌を補充
  if (!opts.ignoreEffects && s.buffs.chiniisouTurns > 0 && s.buffs.chiniisouSuit) {
    const base = s.buffs.chiniisouSuit === 'm' ? 0 : s.buffs.chiniisouSuit === 'p' ? 9 : 18;
    const k = base + rng.int(9);
    const tile = makeTileId(k, ++s.uid);
    decorateDrawnTile(s, rng, tile, opts);
    s.hand.push(tile);
    s.drawn.push(tile);
    return tile;
  }

  // 清老頭バフ中：すべて2〜8の数字牌のみ補充
  if (!opts.ignoreEffects && s.buffs.chinroutouTurns > 0) {
    const simpleIndices: number[] = [];
    for (let i = 0; i < s.wall.length; i++) {
      if (isSimple(kindOf(s.wall[i]))) simpleIndices.push(i);
    }
    let tile: TileId;
    if (simpleIndices.length > 0) {
      const wallIdx = simpleIndices[rng.int(simpleIndices.length)];
      tile = s.wall[wallIdx];
      s.wall[wallIdx] = s.wall[s.wall.length - 1];
      s.wall.pop();
    } else {
      const simpleKinds = ACTIVE_KINDS.filter((k) => isSimple(k) && !isKindBanished(s, k));
      const fallbackKind = simpleKinds.length > 0 ? simpleKinds[rng.int(simpleKinds.length)] : 1;
      tile = makeTileId(fallbackKind, ++s.uid);
    }
    decorateDrawnTile(s, rng, tile, opts);
    s.hand.push(tile);
    s.drawn.push(tile);
    return tile;
  }

  if (s.wall.length === 0) {
    resetWallFull(s);
    s.resets++;
    if (s.wall.length === 0) {
      // すべての牌種が封印されている極端な場合のフォールバック
      const tile = makeTileId(31, ++s.uid);
      decorateDrawnTile(s, rng, tile, opts);
      s.hand.push(tile);
      s.drawn.push(tile);
      return tile;
    }
    s.log.push({ side: 'system', text: `残り牌がなくなったため、山を補充した（${s.wall.length}枚）` });
  }

  const i = rng.int(s.wall.length);
  const tile = s.wall[i];
  s.wall[i] = s.wall[s.wall.length - 1];
  s.wall.pop();
  decorateDrawnTile(s, rng, tile, opts);
  s.hand.push(tile);
  s.drawn.push(tile);
  return tile;
}

function drawN(
  s: BattleState,
  rng: Rng,
  n: number,
  opts: { forceGold?: boolean; ignoreEffects?: boolean } = {},
): TileId[] {
  const out: TileId[] = [];
  for (let i = 0; i < n; i++) out.push(drawOne(s, rng, opts));
  return out;
}

function gainExp(s: BattleState, rawAmount: number): void {
  if (rawAmount <= 0) return;
  const amount = Math.round(rawAmount * s.expMult);
  s.player.exp += amount;
  while (s.player.exp >= EXP_PER_LEVEL) {
    s.player.exp -= EXP_PER_LEVEL;
    s.player.level++;
    s.player.maxHp = Math.round(s.player.maxHp * 1.1);
    const heal = Math.round(s.player.maxHp * 0.3);
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
    s.events.push({ type: 'heal', target: 'player', amount: heal });
    s.log.push({
      side: 'system',
      text: `レベルアップ！ Lv.${s.player.level} になった！（最大HP+10% ／ HP ${heal} 回復）`,
    });
  }
}

function applyLevelUpDirect(s: BattleState, levels: number): void {
  for (let i = 0; i < levels; i++) {
    s.player.level++;
    s.player.maxHp = Math.round(s.player.maxHp * 1.1);
    const heal = Math.round(s.player.maxHp * 0.3);
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
  }
  s.log.push({
    side: 'system',
    text: `字一色の効果でレベルが ${levels} 上がり、Lv.${s.player.level} になった！`,
  });
}

function grantEquipment(s: BattleState, equipId: string, rng: Rng): void {
  if (s.equipments.includes(equipId)) return;
  const def = getEquipment(equipId);
  s.equipments.push(equipId);
  s.log.push({ side: 'system', text: `装備「${def.name}」（${def.desc}）を獲得した！` });

  if (equipId === 'hp_up_10') {
    const diff = Math.round(s.player.maxHp * 0.1);
    s.player.maxHp += diff;
    s.player.hp += diff;
  } else if (equipId === 'hp_up_30') {
    const diff = Math.round(s.player.maxHp * 0.3);
    s.player.maxHp += diff;
    s.player.hp += diff;
  } else if (equipId === 'hp_double') {
    const diff = s.player.maxHp;
    s.player.maxHp *= 2;
    s.player.hp += diff;
  } else if (equipId === 'red_five_1') {
    for (const t of [...s.hand, ...s.wall]) {
      if (isFive(kindOf(t)) && (t & 3) === 0 && s.tileMods[t] !== 'rainbow') {
        s.tileMods[t] = 'red';
      }
    }
  } else if (equipId === 'all_five_red') {
    for (const t of [...s.hand, ...s.wall]) {
      if (isFive(kindOf(t)) && s.tileMods[t] !== 'rainbow') {
        s.tileMods[t] = 'red';
      }
    }
  } else if (equipId === 'banish_one_honor') {
    const honors: Kind[] = [27, 28, 29, 30, 31, 32, 33].filter((k) => !s.banishedKinds.includes(k));
    if (honors.length > 0) {
      const target = honors[rng.int(honors.length)];
      s.banishedKinds.push(target);
      enforceWallRestrictions(s);
      s.log.push({ side: 'system', text: `「${kindName(target)}」の残り牌が永続的に0になった！` });
    }
  }
  enforceWallRestrictions(s);
}

function rollRandomEquipments(
  s: BattleState,
  rng: Rng,
  count: number,
  minRarity: Rarity = 'common',
  forceAllowLegend = false,
): string[] {
  const order: Rarity[] = ['common', 'uncommon', 'rare', 'legend'];
  const minIdx = order.indexOf(minRarity);
  const owned = new Set(s.equipments);
  const canLegend = forceAllowLegend || s.stage >= 5 || minRarity === 'legend';

  let pool = EQUIPMENTS.filter(
    (e) =>
      !owned.has(e.id) &&
      order.indexOf(e.rarity) >= minIdx &&
      (canLegend || e.rarity !== 'legend'),
  );

  // 未所持の該当レアリティ装備が足りない場合は未所持全体から補う
  if (pool.length < count) {
    pool = EQUIPMENTS.filter((e) => !owned.has(e.id) && (canLegend || e.rarity !== 'legend'));
  }

  const rarityWeight = (r: Rarity): number =>
    r === 'common' ? 65 : r === 'uncommon' ? 24 : r === 'rare' ? 9 : 2;

  const chosen: string[] = [];
  const remaining = [...pool];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const weights = remaining.map((e) => rarityWeight(e.rarity));
    const idx = rng.weighted(weights);
    chosen.push(remaining[idx].id);
    remaining.splice(idx, 1);
  }
  return chosen;
}

function ensureStartDragonSet(s: BattleState, rng: Rng): void {
  if (countActiveEquip(s, 'start_dragon_set') <= 0) return;
  const dragons: Kind[] = [31, 32, 33];
  const hasDragonSet = dragons.some(
    (dk) =>
      s.hand.filter((t) => kindOf(t) === dk).length >= 3 ||
      s.melds.some((m) => m.kind === dk),
  );
  if (hasDragonSet || s.hand.length < 3) return;
  const dk = dragons[rng.int(dragons.length)];
  for (let i = 0; i < 3; i++) {
    const newTile = makeTileId(dk, ++s.uid);
    decorateDrawnTile(s, rng, newTile);
    s.hand[i] = newTile;
  }
  s.log.push({ side: 'system', text: `三元神の加護により、手牌に「${kindName(dk)}」のセットが宿った！` });
}

function checkPlayerDefeatOrRevive(s: BattleState): boolean {
  if (s.player.hp > 0) return false;
  const reviveEquipCount = countActiveEquip(s, 'revive_20');
  if (s.revivedThisBattle < reviveEquipCount) {
    s.revivedThisBattle++;
    s.player.hp = Math.max(1, Math.round(s.player.maxHp * 0.2));
    s.events.push({ type: 'heal', target: 'player', amount: s.player.hp });
    s.log.push({
      side: 'system',
      text: `不屈のリーチ棒が輝き、HPを ${s.player.hp} 回復して敗北を免れた！`,
    });
    return false;
  }
  s.player.hp = 0;
  s.status = 'lost';
  s.log.push({ side: 'system', text: 'あなたは倒れた……' });
  return true;
}

function executeSingleMonsterAction(s: BattleState, rng: Rng, allowMultiStrike: boolean): void {
  if (s.status !== 'playing' || s.monster.hp <= 0) return;
  const def = s.monster.def;
  const skill = chooseMonsterSkill(def, rng, allowMultiStrike);

  const chargeMult = s.enemyBuffs.charged ? 3 : 1;
  // ためる以外の行動をしたら溜め状態を消費
  if (skill.id !== 'charge') {
    s.enemyBuffs.charged = false;
  }

  const dmgCutCount = countActiveEquip(s, 'dmg_cut_10');
  const dmgCutMult = Math.pow(0.9, dmgCutCount);

  const dealDamageToPlayer = (rawDmg: number, label: string) => {
    if (s.buffs.nullifyDamage) {
      s.buffs.nullifyDamage = false;
      s.log.push({
        side: 'monster',
        text: `${def.name}の「${label}」！ → 白セットの障壁がダメージを無効化した！`,
      });
      return;
    }
    const dmg = Math.max(1, Math.round(rawDmg * chargeMult * dmgCutMult));
    s.player.hp = Math.max(0, s.player.hp - dmg);
    s.events.push({ type: 'damage', target: 'player', amount: dmg });
    s.log.push({
      side: 'monster',
      text: `${def.name}の「${label}」！ → ${dmg.toLocaleString()} ダメージ`,
    });
    gainExp(s, dmg);
    checkPlayerDefeatOrRevive(s);
  };

  switch (skill.id) {
    case 'normal': {
      dealDamageToPlayer(rollMonsterDamage(def.atk, rng), '通常攻撃');
      break;
    }
    case 'critical': {
      dealDamageToPlayer(rollMonsterDamage(def.atk, rng) * 2, 'クリティカル');
      break;
    }
    case 'seal_yaku': {
      s.buffs.sealYakuTurns = Math.max(s.buffs.sealYakuTurns, 3);
      s.log.push({ side: 'monster', text: `${def.name}の「封印」！ 3ターンの間、役の効果発動が無効化された！` });
      break;
    }
    case 'atk_down': {
      s.buffs.atkDownTurns = Math.max(s.buffs.atkDownTurns, 3);
      s.log.push({ side: 'monster', text: `${def.name}の「攻撃力ダウン」！ 3ターンの間、攻撃力合計に-10の補正！` });
      dealDamageToPlayer(Math.round(rollMonsterDamage(def.atk, rng) * 0.6), '追撃');
      break;
    }
    case 'charge': {
      s.enemyBuffs.charged = true;
      s.log.push({ side: 'monster', text: `${def.name}の「ためる」！ 次のターンのダメージが3倍になる！` });
      break;
    }
    case 'defend': {
      s.enemyBuffs.defendTurns = Math.max(s.enemyBuffs.defendTurns, 2);
      s.log.push({ side: 'monster', text: `${def.name}の「防御」！ 2ターンの間、敵へのダメージが半減する！` });
      break;
    }
    case 'slow': {
      s.buffs.slowTurns = Math.max(s.buffs.slowTurns, 2);
      s.extraChains = 0;
      s.chain = 0;
      s.log.push({ side: 'monster', text: `${def.name}の「鈍化」！ 装備効果を含めチェーンが完全に封じられた！` });
      break;
    }
    case 'seal_tiles': {
      const candidates = s.hand.filter((t) => !(s.sealedTiles[t] > 0));
      const count = Math.min(3, candidates.length);
      const pool = [...candidates];
      for (let i = 0; i < count; i++) {
        const idx = rng.int(pool.length);
        const t = pool[idx];
        pool.splice(idx, 1);
        s.sealedTiles[t] = 3;
      }
      s.log.push({ side: 'monster', text: `${def.name}の「牌封印」！ 手牌のうち${count}枚が3ターン攻撃に使えなくなった！` });
      break;
    }
    case 'heal': {
      const amount = Math.round(s.monster.maxHp * 0.3);
      s.monster.hp = Math.min(s.monster.maxHp, s.monster.hp + amount);
      s.events.push({ type: 'heal', target: 'monster', amount });
      s.log.push({ side: 'monster', text: `${def.name}の「回復」！ HPが ${amount.toLocaleString()} 回復した！` });
      break;
    }
    case 'double_strike': {
      s.log.push({ side: 'monster', text: `${def.name}の「連撃」！ 2回連続で行動する！` });
      executeSingleMonsterAction(s, rng, false);
      if (s.status === 'playing') executeSingleMonsterAction(s, rng, false);
      break;
    }
    case 'seal_equip': {
      const unsealed = s.equipments
        .map((_, idx) => idx)
        .filter((idx) => !s.sealedEquipIndices.includes(idx));
      if (unsealed.length > 0) {
        const pick = unsealed[rng.int(unsealed.length)];
        s.sealedEquipIndices.push(pick);
        const eq = getEquipment(s.equipments[pick]);
        s.log.push({ side: 'monster', text: `${def.name}の「装備封印」！ 装備「${eq.name}」が無効化された！` });
      } else {
        dealDamageToPlayer(rollMonsterDamage(def.atk, rng), '通常攻撃');
      }
      break;
    }
    case 'reflect': {
      s.enemyBuffs.reflectTurns = Math.max(s.enemyBuffs.reflectTurns, 2);
      s.log.push({ side: 'monster', text: `${def.name}の「反射」！ 2ターンの間、受けたダメージの半分を跳ね返す！` });
      break;
    }
    case 'half_hp': {
      if (s.buffs.nullifyDamage) {
        s.buffs.nullifyDamage = false;
        s.log.push({ side: 'monster', text: `${def.name}の「割合ダメージ」！ → 白セットの障壁が無効化した！` });
      } else {
        const dmg = Math.max(1, Math.floor(s.player.hp / 2));
        s.player.hp -= dmg;
        s.events.push({ type: 'damage', target: 'player', amount: dmg });
        s.log.push({ side: 'monster', text: `${def.name}の「割合ダメージ」！ HPが半分（-${dmg.toLocaleString()}）になった！` });
        gainExp(s, dmg);
      }
      break;
    }
    case 'venom': {
      s.buffs.venomTurns = Math.max(s.buffs.venomTurns, 5);
      s.log.push({
        side: 'monster',
        text: `${def.name}の「猛毒」！ 5ターンの間、攻撃力合計-20＋攻撃後にHP-10%！`,
      });
      break;
    }
    case 'triple_strike': {
      s.log.push({ side: 'monster', text: `${def.name}の「神速」！ 3回連続で行動する！` });
      for (let i = 0; i < 3 && s.status === 'playing'; i++) {
        executeSingleMonsterAction(s, rng, false);
      }
      break;
    }
    case 'break_hand_5': {
      const n = Math.min(5, s.hand.length);
      for (let i = 0; i < n; i++) {
        const idx = rng.int(s.hand.length);
        const [removed] = s.hand.splice(idx, 1);
        delete s.sealedTiles[removed];
      }
      s.drawn = [];
      drawN(s, rng, n, { ignoreEffects: true });
      s.log.push({
        side: 'monster',
        text: `${def.name}の「手牌破壊」！ 手牌${n}枚が消去され、素の残り牌${n}枚と入れ替わった！`,
      });
      break;
    }
    case 'break_kan': {
      if (s.melds.length > 0) {
        s.melds.pop();
        s.drawn = [];
        drawN(s, rng, 3, { ignoreEffects: true });
        s.log.push({
          side: 'monster',
          text: `${def.name}の「カン破壊」！ キープしていたカンが破壊され、素の残り牌3枚になった！`,
        });
      } else {
        dealDamageToPlayer(rollMonsterDamage(def.atk, rng), 'カン破壊（不発→強撃）');
      }
      break;
    }
    case 'break_all': {
      const targetCount = Math.max(8, HAND_SIZE - s.melds.length * 3);
      s.hand = [];
      s.sealedTiles = {};
      s.drawn = [];
      drawN(s, rng, targetCount, { ignoreEffects: true });
      s.log.push({
        side: 'monster',
        text: `${def.name}の「全破壊」！ 手牌がすべて消去され、素の残り牌が補充された！`,
      });
      break;
    }
  }
}

function endPlayerTurnAndAdvance(s: BattleState, rng: Rng): void {
  // 敵の行動
  executeSingleMonsterAction(s, rng, true);
  if (s.status !== 'playing') return;

  // ターン終了時の持続ターン経過処理
  const dec = (v: number) => Math.max(0, v - 1);
  s.buffs.honiisouTurns = dec(s.buffs.honiisouTurns);
  s.buffs.pinfuTurns = dec(s.buffs.pinfuTurns);
  s.buffs.sanankouTurns = dec(s.buffs.sanankouTurns);
  s.buffs.chinroutouTurns = dec(s.buffs.chinroutouTurns);
  s.buffs.chiniisouTurns = dec(s.buffs.chiniisouTurns);
  if (s.buffs.chiniisouTurns === 0) s.buffs.chiniisouSuit = null;

  s.buffs.sealYakuTurns = dec(s.buffs.sealYakuTurns);
  s.buffs.atkDownTurns = dec(s.buffs.atkDownTurns);
  s.buffs.slowTurns = dec(s.buffs.slowTurns);
  s.buffs.venomTurns = dec(s.buffs.venomTurns);

  s.enemyBuffs.defendTurns = dec(s.enemyBuffs.defendTurns);
  s.enemyBuffs.reflectTurns = dec(s.enemyBuffs.reflectTurns);

  s.cooldowns.resetWall = dec(s.cooldowns.resetWall);
  s.cooldowns.copy = dec(s.cooldowns.copy);
  s.cooldowns.search = dec(s.cooldowns.search);

  for (const tStr of Object.keys(s.sealedTiles)) {
    const t = Number(tStr);
    s.sealedTiles[t]--;
    if (s.sealedTiles[t] <= 0) delete s.sealedTiles[t];
  }

  // 毎ターン回復（平和バフ10% ＋ 装備「再生の牌皿」5%×所持数）
  const regenEquipCount = countActiveEquip(s, 'regen_5');
  const pinfuRate = s.buffs.pinfuTurns > 0 ? 0.1 : 0;
  const totalRegenRate = pinfuRate + regenEquipCount * 0.05;
  if (totalRegenRate > 0 && s.player.hp < s.player.maxHp) {
    const heal = Math.max(1, Math.round(s.player.maxHp * totalRegenRate));
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
    s.events.push({ type: 'heal', target: 'player', amount: heal });
    s.log.push({ side: 'system', text: `ターン終了時回復：HPが ${heal.toLocaleString()} 回復した` });
  }

  // 次ターン開始（鈍化中は装備によるチェーンプラスも封じる）
  s.turn++;
  s.chain = 0;
  s.extraChains = s.buffs.slowTurns > 0 ? 0 : countActiveEquip(s, 'always_chain_1');
  s.nextChainMult = 1;
}

function handleMonsterDefeated(s: BattleState, rng: Rng): void {
  s.log.push({ side: 'system', text: `${s.monster.def.name}を倒した！` });
  if (s.stage >= MAX_STAGE) {
    s.status = 'won';
    s.log.push({ side: 'system', text: '全8連戦を制覇した！完全勝利！！' });
  } else {
    s.status = 'reward';
    s.rewardChoices = rollRandomEquipments(s, rng, 3, 'common');
    s.log.push({ side: 'system', text: '報酬の装備を3つの中から1つ選んでください' });
  }
}

// ---------------------------------------------------------------------------
// 公開API
// ---------------------------------------------------------------------------

export function newBattle(defOrSeed?: MonsterDef | number, maybeSeed?: number): BattleState {
  const firstDef = typeof defOrSeed === 'object' && defOrSeed !== null ? defOrSeed : MONSTERS[0];
  const seed = typeof defOrSeed === 'number' ? defOrSeed : (maybeSeed ?? 1);

  const s: BattleState = {
    rng: seed,
    uid: 1,
    stage: firstDef.stage ?? 1,
    wall: allTileIds(),
    hand: [],
    melds: [],
    drawn: [],
    tileMods: {},
    sealedTiles: {},
    banishedKinds: [],
    player: {
      hp: PLAYER_INITIAL_HP,
      maxHp: PLAYER_INITIAL_HP,
      level: 0,
      exp: 0,
    },
    equipments: [],
    sealedEquipIndices: [],
    monster: {
      def: firstDef,
      hp: firstDef.hp,
      maxHp: firstDef.hp,
    },
    turn: 1,
    chain: 0,
    extraChains: 0,
    nextChainMult: 1,
    riichi: false,
    mulligansUsed: 0,
    revivedThisBattle: 0,
    healMode: false,
    expMult: 1,
    cooldowns: { resetWall: 0, copy: 0, search: 0 },
    buffs: {
      nullifyDamage: false,
      honiisouTurns: 0,
      pinfuTurns: 0,
      sanankouTurns: 0,
      chinroutouTurns: 0,
      chiniisouTurns: 0,
      chiniisouSuit: null,
      sealYakuTurns: 0,
      atkDownTurns: 0,
      slowTurns: 0,
      venomTurns: 0,
    },
    enemyBuffs: {
      charged: false,
      defendTurns: 0,
      reflectTurns: 0,
    },
    rewardChoices: [],
    resets: 0,
    status: 'playing',
    log: [{ side: 'system', text: `【${firstDef.rank}】${firstDef.name}（HP ${firstDef.hp}）が現れた！` }],
    events: [],
  };

  const rng = new Rng(seed);
  drawN(s, rng, HAND_SIZE);
  s.drawn = [s.hand[s.hand.length - 1]];
  s.rng = rng.state;
  return s;
}

/** 状態を進める純粋関数（入力の state は変更しない） */
export function step(prev: BattleState, action: Action): StepResult {
  const s: BattleState = structuredClone(prev);
  s.events = [];
  const rng = new Rng(s.rng);
  const fail = (error: string): StepResult => ({ state: prev, error });

  // 報酬選択画面での処理
  if (action.type === 'choose_reward') {
    if (s.status !== 'reward') return fail('現在は報酬選択中ではありません');
    if (!s.rewardChoices.includes(action.equipId)) return fail('選択できない装備です');

    grantEquipment(s, action.equipId, rng);

    // 次のステージへ進行（手牌・カン・持続バフ・残り牌状況を持ち越す）
    const nextStage = Math.min(MAX_STAGE, s.stage + 1);
    const nextDef = MONSTERS[nextStage - 1];
    s.stage = nextStage;
    s.monster = { def: nextDef, hp: nextDef.hp, maxHp: nextDef.hp };
    s.turn = 1;
    s.chain = 0;
    s.sealedEquipIndices = [];
    s.extraChains = s.buffs.slowTurns > 0 ? 0 : countActiveEquip(s, 'always_chain_1');
    s.nextChainMult = 1;
    s.riichi = false;
    s.mulligansUsed = 0;
    s.revivedThisBattle = 0;
    s.healMode = false;
    s.expMult = 1;
    s.enemyBuffs = { charged: false, defendTurns: 0, reflectTurns: 0 };
    s.rewardChoices = [];
    s.status = 'playing';

    ensureStartDragonSet(s, rng);
    s.log.push({
      side: 'system',
      text: `【${nextDef.rank}】${nextDef.name}（HP ${nextDef.hp}）が現れた！`,
    });
    s.rng = rng.state;
    return { state: s };
  }

  if (s.status !== 'playing') return fail('戦闘は終了しています');

  switch (action.type) {
    case 'toggle_heal': {
      if (countActiveEquip(s, 'unlock_heal') <= 0) return fail('装備「治癒の点棒」が必要です');
      s.healMode = !s.healMode;
      s.rng = rng.state;
      return { state: s };
    }

    case 'riichi': {
      if (s.riichi) return fail('すでにリーチ宣言中です');
      if (!canDeclareRiichi(s.hand, s.melds)) {
        return fail('リーチは「あと1枚で3セットが揃う状態」のときのみ宣言できます');
      }
      const need = 3 - s.melds.length;
      if (s.hand.length >= need * 3) {
        const discards = findRiichiDiscards(s.hand, s.melds);
        if (action.discardTile === undefined || !discards.includes(action.discardTile)) {
          return fail('リーチ宣言で捨てる牌（聴牌になる牌）を1枚選んでください');
        }
        // 選んだ捨て牌1枚を切ってリーチ宣言＆攻撃処理に移行
        s.riichi = true;
        const discardName = kindName(kindOf(action.discardTile));
        s.log.push({
          side: 'player',
          text: `${discardName} を切ってリーチ宣言！ 3セットが揃うまで自動で自摸切りを進めます！`,
        });
        // 切った牌を除外して1枚補充（その補充牌が s.drawn[0] になり、敵も行動する）
        const dIdx = s.hand.indexOf(action.discardTile);
        if (dIdx >= 0) s.hand.splice(dIdx, 1);
        delete s.sealedTiles[action.discardTile];
        s.drawn = [];
        drawOne(s, rng);
        endPlayerTurnAndAdvance(s, rng);
        s.rng = rng.state;
        return { state: s };
      }

      s.riichi = true;
      s.log.push({ side: 'player', text: 'リーチ宣言！ 3セットが揃うまで自動で自摸切りを進めます！' });
      s.rng = rng.state;
      return { state: s };
    }

    case 'cancel_riichi': {
      if (!s.riichi) return fail('現在はリーチ中ではありません');
      s.riichi = false;
      s.buffs.sealYakuTurns = Math.max(s.buffs.sealYakuTurns, 5);
      s.log.push({
        side: 'player',
        text: 'リーチをキャンセルした！（ペナルティ：5ターンの間、役の効果が発動しなくなる）',
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'mulligan': {
      if (s.turn !== 1 || s.chain > 0) return fail('マリガンは1ターン目の最初の行動前のみ可能です');
      if (s.mulligansUsed >= 2) return fail('マリガンは1バトルに2回までです');
      if (!canMulliganHand(s.hand)) return fail('手牌に1・9・字牌が6枚以上含まれていません');

      const count = s.hand.length;
      s.wall.push(...s.hand);
      s.hand = [];
      s.sealedTiles = {};
      s.drawn = [];
      drawN(s, rng, count);
      s.drawn = [s.hand[s.hand.length - 1]];
      s.mulligansUsed++;
      s.log.push({
        side: 'player',
        text: `マリガンを実行し、手牌${count}枚を引き直した（残り${2 - s.mulligansUsed}回）`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'kan': {
      if (s.riichi) return fail('リーチ中はカンできません');
      const tiles = s.hand.filter((t) => kindOf(t) === action.kind);
      if (tiles.length < 4) return fail('カンできる同一牌が4枚ありません');
      const kanTiles = tiles.slice(0, 4);
      s.hand = s.hand.filter((t) => !kanTiles.includes(t));
      for (const kt of kanTiles) delete s.sealedTiles[kt];
      s.melds.push({ type: 'kantsu', kind: action.kind, tiles: kanTiles, declared: true });
      s.drawn = [];
      drawOne(s, rng, { forceGold: true });
      s.log.push({
        side: 'player',
        text: `${kindName(action.kind)} をカンしてキープ！ 金牌を1枚補充した`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'skill_reset_wall': {
      if (countActiveEquip(s, 'skill_reset_wall') <= 0) return fail('装備「山積み直し機」が必要です');
      if (s.cooldowns.resetWall > 0) return fail(`クールタイム中です（あと${s.cooldowns.resetWall}ターン）`);
      resetWallFull(s);
      s.cooldowns.resetWall = 8;
      s.log.push({
        side: 'player',
        text: `特殊行動「残り牌リセット」！ 全種の残り牌が補充された（${s.wall.length}枚）`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'skill_copy': {
      if (countActiveEquip(s, 'skill_copy') <= 0) return fail('装備「鏡の牌（複製）」が必要です');
      if (s.cooldowns.copy > 0) return fail(`クールタイム中です（あと${s.cooldowns.copy}ターン）`);
      const targetIdx = s.hand.indexOf(action.targetTile);
      const sourceIdx = s.hand.indexOf(action.sourceTile);
      if (targetIdx < 0 || sourceIdx < 0 || targetIdx === sourceIdx) {
        return fail('手牌から変化元と変化先の2枚を指定してください');
      }
      const newKind = kindOf(action.sourceTile);
      const oldKind = kindOf(action.targetTile);
      const newTile = makeTileId(newKind, ++s.uid);
      if (s.tileMods[action.targetTile]) {
        s.tileMods[newTile] = s.tileMods[action.targetTile];
      }
      delete s.sealedTiles[action.targetTile];
      s.hand[targetIdx] = newTile;
      s.cooldowns.copy = 5;
      s.log.push({
        side: 'player',
        text: `特殊行動「複製」！ ${kindName(oldKind)} を ${kindName(newKind)} に変化させた！`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'skill_search': {
      if (countActiveEquip(s, 'skill_search') <= 0) return fail('装備「千里眼（サーチ）」が必要です');
      if (s.cooldowns.search > 0) return fail(`クールタイム中です（あと${s.cooldowns.search}ターン）`);
      const handIdx = s.hand.indexOf(action.targetTile);
      if (handIdx < 0) return fail('変化させる手牌を1枚選んでください');
      const wallIdx = s.wall.findIndex((t) => kindOf(t) === action.kind);
      if (wallIdx < 0) return fail('指定した牌は残り牌にありません');

      const oldKind = kindOf(action.targetTile);
      const picked = s.wall[wallIdx];
      s.wall[wallIdx] = s.wall[s.wall.length - 1];
      s.wall.pop();
      decorateDrawnTile(s, rng, picked);
      delete s.sealedTiles[action.targetTile];
      s.hand[handIdx] = picked;
      s.cooldowns.search = 5;
      s.log.push({
        side: 'player',
        text: `特殊行動「サーチ」！ ${kindName(oldKind)} を残り牌の ${kindName(action.kind)} に変化させた！`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'attack': {
      const tiles = [...new Set(action.tiles)];
      if (tiles.some((t) => !s.hand.includes(t))) return fail('手牌にない牌が含まれています');
      const meldIdx = [...new Set(action.melds)];
      if (meldIdx.some((i) => i < 0 || i >= s.melds.length)) return fail('カンの指定が不正です');
      const melds = meldIdx.map((i) => s.melds[i]);

      const ctx = buildScoreContext(s);
      const ev = evaluateSelection(tiles, melds, ctx);
      if (!ev.valid) return fail(ev.reason ?? '攻撃できません');

      const yakuIds = new Set(ev.yaku.map((y) => y.id));

      // 三槓子：このバトルの経験値30倍（ダメージ経験値が入る前に適用）
      if (yakuIds.has('sankantsu')) {
        s.expMult = 30;
      }

      const yakuText = ev.yaku.length > 0 ? ev.yaku.map((y) => y.name).join('・') : '役なし';
      const chainLabel = s.chain > 0 ? ` [${s.chain} Chain]` : '';
      const riichiLabel = ev.isRiichiComplete ? ' [リーチ完成×2]' : '';

      // 治療モード判定
      if (s.healMode) {
        s.healMode = false;
        const healAmount = ev.damage;
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + healAmount);
        s.events.push({ type: 'heal', target: 'player', amount: healAmount });
        s.log.push({
          side: 'player',
          text: `治療！${chainLabel} ${yakuText} → HPを ${healAmount.toLocaleString()} 回復した！`,
        });
      } else {
        s.monster.hp = Math.max(0, s.monster.hp - ev.damage);
        s.events.push({ type: 'damage', target: 'monster', amount: ev.damage });
        s.log.push({
          side: 'player',
          text: `攻撃！${chainLabel}${riichiLabel} ${yakuText} → ${ev.damage.toLocaleString()} ダメージ`,
        });
        gainExp(s, ev.damage);

        // レア装備「吸血の雀卓」：役なしおよび1セット役の攻撃時、与えたダメージ分自分を回復
        const isBasicOrTier1 = ev.yaku.length === 0 || ev.yaku.every((y) => y.tier === 1);
        if (isBasicOrTier1 && countActiveEquip(s, 'vamp_basic') > 0) {
          s.player.hp = Math.min(s.player.maxHp, s.player.hp + ev.damage);
          s.events.push({ type: 'heal', target: 'player', amount: ev.damage });
          s.log.push({ side: 'system', text: `吸収効果によりHPが ${ev.damage.toLocaleString()} 回復した！` });
        }

        // 敵の「反射」判定
        if (s.enemyBuffs.reflectTurns > 0 && s.monster.hp > 0) {
          const reflectDmg = Math.max(1, Math.floor(ev.damage / 2));
          s.player.hp = Math.max(0, s.player.hp - reflectDmg);
          s.events.push({ type: 'damage', target: 'player', amount: reflectDmg });
          s.log.push({
            side: 'monster',
            text: `反射ダメージ！ あなたは ${reflectDmg.toLocaleString()} ダメージを受けた！`,
          });
          gainExp(s, reflectDmg);
          if (checkPlayerDefeatOrRevive(s)) {
            s.rng = rng.state;
            return { state: s, attack: ev };
          }
        }
      }

      // 赤牌を役に含めて攻撃した場合、その場でボーナス経験値を獲得
      if (ev.yaku.length > 0 && ev.redCount > 0) {
        const bonusExp = 150 * ev.redCount;
        s.log.push({ side: 'system', text: `赤牌ボーナス！ 経験値 +${bonusExp * s.expMult} を獲得！` });
        gainExp(s, bonusExp);
      }

      // 役の効果適用
      let nextMult = 1;
      let forceGoldDrawCount = 0;
      let drawThreePairs = false;
      let drawTriple = false;
      let chantaGold = false;

      for (const y of ev.yaku) {
        switch (y.id) {
          case 'haku':
            s.buffs.nullifyDamage = true;
            s.log.push({ side: 'system', text: '【白セット効果】次の敵のダメージを無効化する障壁を展開！' });
            break;
          case 'chun':
            forceGoldDrawCount += 3;
            s.log.push({ side: 'system', text: '【中セット効果】補充牌のうち3枚が金牌になる！' });
            break;
          case 'iipeikou':
            drawThreePairs = true;
            s.log.push({ side: 'system', text: '【一盃口効果】ペア（2枚組）を3セット補充する！' });
            break;
          case 'nishoku_doujun':
            nextMult = Math.max(nextMult, 2);
            s.log.push({ side: 'system', text: '【二色同順効果】次のチェーン倍率が2倍になる！' });
            break;
          case 'nishoku_doukou':
            nextMult = Math.max(nextMult, 3);
            s.log.push({ side: 'system', text: '【二色同刻効果】次のチェーン倍率が3倍になる！' });
            break;
          case 'niankou':
            drawTriple = true;
            s.log.push({ side: 'system', text: '【二暗刻効果】補充に同牌セット（3枚組）が含まれる！' });
            break;
          case 'chanta':
            chantaGold = true;
            s.log.push({ side: 'system', text: '【チャンタ効果】手牌と補充牌の1・9・字牌がすべて金牌になる！' });
            break;
          case 'honiisou':
            s.buffs.honiisouTurns = 5;
            s.log.push({ side: 'system', text: '【混一色効果】5ターンの間、字牌は金牌として補充される！' });
            break;
          case 'pinfu':
            s.buffs.pinfuTurns = 5;
            s.log.push({ side: 'system', text: '【平和効果】5ターンの間、毎ターンHPが自動回復する！' });
            break;
          case 'sanankou':
            s.buffs.sanankouTurns = 5;
            s.log.push({ side: 'system', text: '【三暗刻効果】5ターンの間、ダメージが3倍になる！' });
            break;
          case 'chinroutou':
            s.buffs.chinroutouTurns = 5;
            s.log.push({
              side: 'system',
              text: '【清老頭効果】5ターンの間、補充がすべて2〜8の数牌になり30%で金牌化！',
            });
            break;
          case 'chiniisou':
            s.buffs.chiniisouTurns = 5;
            s.buffs.chiniisouSuit = y.suit ?? 'p';
            s.log.push({
              side: 'system',
              text: `【清一色効果】5ターンの間、残り牌外から${suitName(s.buffs.chiniisouSuit)}が補充される！`,
            });
            break;
          case 'daisangen': {
            const rewards = rollRandomEquipments(s, rng, 3, 'uncommon');
            for (const eqId of rewards) grantEquipment(s, eqId, rng);
            break;
          }
          case 'ryuuiisou': {
            const heal = s.player.maxHp - s.player.hp;
            s.player.hp = s.player.maxHp;
            if (heal > 0) s.events.push({ type: 'heal', target: 'player', amount: heal });
            s.log.push({ side: 'system', text: '【緑一色効果】自分のHPが全回復した！' });
            break;
          }
          case 'tsuuiisou': {
            applyLevelUpDirect(s, 3);
            break;
          }
          case 'sankantsu': {
            const [legId] = rollRandomEquipments(s, rng, 1, 'legend', true);
            if (legId) grantEquipment(s, legId, rng);
            s.log.push({ side: 'system', text: '【三槓子効果】このバトルの獲得経験値が30倍になった！' });
            break;
          }
        }
      }

      if (ev.isRiichiComplete) {
        s.riichi = false;
      }

      // 使用した手牌とカンを消費
      s.hand = s.hand.filter((t) => !tiles.includes(t));
      for (const t of tiles) delete s.sealedTiles[t];
      s.melds = s.melds.filter((_, i) => !meldIdx.includes(i));
      s.drawn = [];

      // 補充枚数（手牌消費枚数 ＋ 使用したカン×3）
      let needDraw = tiles.length + melds.length * 3;

      // 1枚のみで攻撃 ＆ レジェンド装備「共鳴する孤牌」所持時は手牌のどれかと同一種類を補充
      if (
        needDraw === 1 &&
        s.hand.length > 0 &&
        countActiveEquip(s, 'single_clone_draw') > 0
      ) {
        const cloneKind = kindOf(s.hand[rng.int(s.hand.length)]);
        drawOne(s, rng, { forceKind: cloneKind, forceGold: forceGoldDrawCount > 0 });
        needDraw = 0;
      }

      // 一盃口：ペア3組（最大6枚）を補充
      if (drawThreePairs && needDraw >= 2) {
        const pairsToDraw = Math.min(3, Math.floor(needDraw / 2));
        const availKinds = ACTIVE_KINDS.filter((k) => !isKindBanished(s, k));
        for (let p = 0; p < pairsToDraw; p++) {
          const pk = availKinds[rng.int(availKinds.length)];
          drawOne(s, rng, { forceKind: pk, forceGold: forceGoldDrawCount-- > 0 });
          drawOne(s, rng, { forceKind: pk, forceGold: forceGoldDrawCount-- > 0 });
          needDraw -= 2;
        }
      }

      // 二暗刻：同牌セット（3枚組）を補充
      if (drawTriple && needDraw >= 3) {
        const availKinds = ACTIVE_KINDS.filter((k) => !isKindBanished(s, k));
        const tk = availKinds[rng.int(availKinds.length)];
        for (let i = 0; i < 3; i++) {
          drawOne(s, rng, { forceKind: tk, forceGold: forceGoldDrawCount-- > 0 });
        }
        needDraw -= 3;
      }

      // 残りの通常補充
      while (needDraw > 0) {
        drawOne(s, rng, { forceGold: forceGoldDrawCount-- > 0 });
        needDraw--;
      }

      // チャンタ：手牌および補充牌の1・9・字牌をすべて金牌化
      if (chantaGold) {
        for (const t of s.hand) {
          if (isYaochu(kindOf(t)) && s.tileMods[t] !== 'rainbow' && s.tileMods[t] !== 'red') {
            s.tileMods[t] = 'gold';
          }
        }
      }

      // 猛毒デバフ中の攻撃後ダメージ（HP-10%）
      if (s.buffs.venomTurns > 0) {
        const poisonDmg = Math.max(1, Math.round(s.player.maxHp * 0.1));
        s.player.hp = Math.max(0, s.player.hp - poisonDmg);
        s.events.push({ type: 'damage', target: 'player', amount: poisonDmg });
        s.log.push({ side: 'system', text: `猛毒のダメージ！ HPが ${poisonDmg} 減少した！` });
        if (checkPlayerDefeatOrRevive(s)) {
          s.rng = rng.state;
          return { state: s, attack: ev };
        }
      }

      // 敵撃破チェック
      if (s.monster.hp <= 0) {
        handleMonsterDefeated(s, rng);
        s.rng = rng.state;
        return { state: s, attack: ev };
      }

      // チェーン判定（鈍化中は装備効果も含めチェーン保持数は常に0）
      if (s.buffs.slowTurns > 0) {
        s.extraChains = 0;
        s.chain = 0;
        endPlayerTurnAndAdvance(s, rng);
      } else {
        s.extraChains += ev.gainedChains;
        if (s.extraChains > 0) {
          s.extraChains--;
          s.chain++;
          s.nextChainMult = nextMult;
          s.log.push({
            side: 'system',
            text: `チェーン発生！（${s.chain} Chain${nextMult > 1 ? `・次倍率×${nextMult}` : ''} ／ 残り追加行動 ${s.extraChains}回）もう一度攻撃できます！`,
          });
        } else {
          endPlayerTurnAndAdvance(s, rng);
        }
      }

      s.rng = rng.state;
      return { state: s, attack: ev };
    }
  }
}

/** 種類ごとの残り牌の枚数 */
export function wallCounts(s: BattleState): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of s.wall) counts[kindOf(t)]++;
  return counts;
}
