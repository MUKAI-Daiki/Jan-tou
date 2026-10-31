import {
  EQUIPMENTS,
  JobId,
  RARITY_SCORE,
  Rarity,
  getEquipment,
  getEquipmentBuyPrice,
  getEquipmentSellPrice,
  getJobDef,
} from '../data/equipments';
import { ENEMY_SKILLS, MAX_STAGE, MONSTERS, MonsterDef, PLAYER_INITIAL_HP } from '../data/monsters';
import { Decomposition, Mentsu, canDeclareRiichi, findRiichiDiscards, hasThreeSets, isSet } from './mentsu';
import { chooseMonsterSkill, rollMonsterDamage } from './monster';
import { Rng } from './rng';
import { AttackEval, ScoreContext, effectiveTileMod, evaluateSelection } from './score';
import {
  ACTIVE_KINDS,
  KIND_COUNT,
  Kind,
  Suit,
  TILE_GROUP_LABEL,
  TileGroup,
  TileId,
  TileMod,
  allTileIds,
  isDragon,
  isFive,
  isHonor,
  isSimple,
  isWind,
  isYaochu,
  kindName,
  kindOf,
  makeTileId,
  numOf,
  suitName,
  suitOf,
} from './tile';
import { Yaku, calcYakuScore } from './yaku';

/** 基本手牌枚数（3セット＝9枚分。カン1つにつき手牌枠は-3枚） */
export const HAND_SIZE = 9;

/** 商店での永続ステータス強化の価格 */
export const SHOP_HP_UP_COST = 500;
export const SHOP_ATK_UP_COST = 500;

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
  /** ガード：次の被ダメージを軽減する値 */
  guardBarrier: number;
  /** 混一色：字牌が金牌として補充される残りターン */
  honiisouTurns: number;
  /** 平和：毎ターンHP自動回復の残りターン */
  pinfuTurns: number;
  /** 三暗刻：ダメージ3倍の残りターン */
  sanankouTurns: number;
  /** 清老頭：補充が2〜8の数牌のみ＆50%金牌化の残りターン */
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
  /** プレイヤーの職業 */
  job: JobId;
  /** 残り牌 */
  wall: TileId[];
  /** 手牌 */
  hand: TileId[];
  /** キープしたカン */
  melds: Mentsu[];
  /** 直前の操作で補充された牌 */
  drawn: TileId[];
  /** 牌ごとの特殊状態（normal / gold / red / rainbow） */
  tileMods: Record<TileId, TileMod>;
  /** 牌封印の残りターン数 */
  sealedTiles: Record<TileId, number>;
  /** 永続的に残り牌0になった牌種 */
  banishedKinds: Kind[];
  /** 役成立ボーナス・商店強化による牌種別の基礎攻撃力加算値 */
  bonusTileAtk: Record<TileGroup, number>;
  /** 所持している「銭」 */
  money: number;
  /** ゲーム終了時のスコアから獲得したボーナス銭 */
  scoreBonusMoney: number;
  /** このランで成立させた役の履歴（スコア計算用） */
  yakuHistory: Yaku[];
  player: {
    hp: number;
    maxHp: number;
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
  /** 二色同順(2.5)・二色同刻(3.5)による次チェーン倍率 */
  nextChainMult: number;
  /** リーチ宣言中かどうか */
  riichi: boolean;
  /** リーチ中にこのターン入れ替えた枚数（通常3枚、雀老師は4枚まで入れ替え可能） */
  riichiSwapsThisTurn: number;
  /** このバトルで発動した敗北回避回数 */
  revivedThisBattle: number;
  /** 特殊行動「回復変換」がONかどうか */
  healMode: boolean;
  cooldowns: SkillCooldowns;
  buffs: PlayerBuffs;
  enemyBuffs: EnemyBuffs;
  /** バトル勝利後の装備報酬3択 */
  rewardChoices: string[];
  /** 商店に並んでいる商品（装備ID一覧） */
  shopItems: string[];
  /** 今回の商店滞在中にHP回復を購入済みか */
  shopHealUsed: boolean;
  resets: number;
  status: 'playing' | 'reward' | 'shop' | 'won' | 'lost';
  log: LogEntry[];
  events: BattleEvent[];
}

export interface ScoreBreakdown {
  stagesCleared: number;
  stageScore: number;
  permAtkTotal: number;
  permScore: number;
  yakuCount: number;
  yakuScore: number;
  equipCount: number;
  equipScore: number;
  totalScore: number;
  bonusMoneyFromScore: number;
}

export function calculateScore(s: BattleState): ScoreBreakdown {
  const stagesCleared = s.status === 'won' ? MAX_STAGE : Math.max(0, s.stage - 1);
  const stageScore = stagesCleared * 1000 + (s.status === 'won' ? 3000 : 0);
  const groups: TileGroup[] = ['m', 'p', 's', 'wind', 'dragon'];
  const permAtkTotal = groups.reduce((sum, g) => sum + (s.bonusTileAtk?.[g] ?? 0), 0);
  const permScore = permAtkTotal * 50;
  const yakuHistory = s.yakuHistory ?? [];
  const yakuCount = yakuHistory.length;
  const yakuScore = yakuHistory.reduce((sum, y) => sum + calcYakuScore(y), 0);
  const equipCount = s.equipments.length;
  const equipScore = s.equipments.reduce((sum, id) => {
    const eq = getEquipment(id);
    return sum + (RARITY_SCORE[eq.rarity] ?? 200);
  }, 0);
  const totalScore = stageScore + permScore + yakuScore + equipScore;
  const bonusMoneyFromScore = Math.max(20, Math.floor(totalScore / 10));
  return {
    stagesCleared,
    stageScore,
    permAtkTotal,
    permScore,
    yakuCount,
    yakuScore,
    equipCount,
    equipScore,
    totalScore,
    bonusMoneyFromScore,
  };
}

function gainMoney(s: BattleState, amount: number, reason: string): void {
  if (amount <= 0) return;
  s.money = (s.money ?? 0) + amount;
  s.log.push({
    side: 'system',
    text: `💰【${reason}】+${amount.toLocaleString()} 銭を獲得！（所持銭: ${s.money.toLocaleString()} 銭）`,
  });
}

export type Action =
  | { type: 'attack'; tiles: TileId[]; melds: number[] }
  | { type: 'guard'; tiles: TileId[]; melds: number[] }
  | { type: 'cure_debuff' }
  | { type: 'kan'; kind: Kind }
  | { type: 'riichi'; discardTile?: TileId }
  | { type: 'cancel_riichi' }
  | { type: 'toggle_heal' }
  | { type: 'skill_reset_wall' }
  | { type: 'skill_copy'; targetTile: TileId; sourceTile: TileId }
  | { type: 'skill_search'; targetTile: TileId; kind: Kind }
  | { type: 'choose_reward'; equipId: string }
  | { type: 'buy_shop_item'; equipId: string }
  | { type: 'sell_equip'; equipIndex: number }
  | { type: 'buy_shop_heal' }
  | { type: 'buy_shop_hp' }
  | { type: 'buy_shop_atk'; group: TileGroup }
  | { type: 'leave_shop' };

export interface MonsterTurnStep {
  /** 敵行動の宣言テキスト（例：「牌スライムの「通常攻撃」！」） */
  declareText: string;
  /** 0.3秒ウェイト後に表示するダメージまたはデバフ結果テキスト */
  effectText: string;
  /** ダメージorデバフ適用直後の状態スナップショット */
  stateAfterEffect: BattleState;
  /** このステップで発生したポップアップイベント */
  events: BattleEvent[];
}

export interface StepResult {
  state: BattleState;
  error?: string;
  attack?: AttackEval;
  /** 敵ターンが発生した場合、敵が行動する直前（プレイヤー行動直後）の状態スナップショット */
  afterPlayerState?: BattleState;
  /** プレイヤー行動フェーズで発生したイベント（敵へのダメージポップアップ等） */
  playerEvents?: BattleEvent[];
  /** プレイヤー行動フェーズで追加されたログ */
  playerLogs?: LogEntry[];
  /** 敵ターンのステップごとの演出データ */
  monsterTurnSteps?: MonsterTurnStep[];
}

// ---------------------------------------------------------------------------
// ヘルパー関数
// ---------------------------------------------------------------------------

/** リーチ中に1ターンあたり入れ替えられる最大枚数（雀老師は4枚、それ以外は3枚） */
export function getRiichiMaxSwaps(s: BattleState): number {
  return s.job === 'master' ? 4 : 3;
}

export function getActiveEquips(s: BattleState): string[] {
  const sealed = new Set(s.sealedEquipIndices);
  return s.equipments.filter((_, idx) => !sealed.has(idx));
}

export function countActiveEquip(s: BattleState, id: string): number {
  return getActiveEquips(s).filter((e) => e === id).length;
}

export function hasAnyPlayerDebuff(s: BattleState): boolean {
  return (
    s.buffs.sealYakuTurns > 0 ||
    s.buffs.atkDownTurns > 0 ||
    s.buffs.slowTurns > 0 ||
    s.buffs.venomTurns > 0 ||
    Object.keys(s.sealedTiles).length > 0 ||
    s.sealedEquipIndices.length > 0
  );
}

export function buildScoreContext(s: BattleState): ScoreContext {
  return {
    job: s.job,
    chain: s.chain,
    nextChainMult: s.nextChainMult,
    tileMods: s.tileMods,
    sealedTiles: s.sealedTiles,
    activeEquips: getActiveEquips(s),
    bonusTileAtk: s.bonusTileAtk,
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

export function isKindBanished(s: BattleState, k: Kind): boolean {
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
    delete s.tileMods[t];
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
  opts: { forceGold?: boolean; riichiGold50?: boolean; ignoreEffects?: boolean } = {},
): void {
  delete s.tileMods[tile];
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
  if (!isGold && opts.riichiGold50 && rng.int(100) < 50) isGold = true;
  if (!isGold && s.buffs.honiisouTurns > 0 && isHonor(k)) isGold = true;
  if (!isGold && s.buffs.chinroutouTurns > 0 && rng.int(100) < 50) isGold = true;
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
  opts: { forceGold?: boolean; riichiGold50?: boolean; forceKind?: Kind; ignoreEffects?: boolean } = {},
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

function kindToGroup(k: Kind): TileGroup {
  const st = suitOf(k);
  if (st === 'm' || st === 'p' || st === 's') return st;
  return isWind(k) ? 'wind' : 'dragon';
}

function addPermanentMaxHp(s: BattleState, amount: number): void {
  if (amount <= 0) return;
  s.player.maxHp += amount;
  s.player.hp += amount;
  s.events.push({ type: 'heal', target: 'player', amount });
}

function addPermanentGroupAtk(s: BattleState, groups: readonly TileGroup[], amount: number): void {
  if (amount <= 0) return;
  for (const g of groups) {
    s.bonusTileAtk[g] = (s.bonusTileAtk[g] ?? 0) + amount;
  }
}

/**
 * 役成立時の「役に合う永続強化」を適用する
 */
function applyYakuPermanentBonus(s: BattleState, y: Yaku, d: Decomposition): void {
  switch (y.id) {
    case 'haku': {
      addPermanentMaxHp(s, 15);
      addPermanentGroupAtk(s, ['dragon'], 2);
      s.log.push({
        side: 'system',
        text: '🌟【白セット永続強化】最大HP+15 ＆ 三元牌の基礎攻撃力+2！',
      });
      break;
    }
    case 'hatsu': {
      addPermanentGroupAtk(s, ['s', 'dragon'], 2);
      s.log.push({
        side: 'system',
        text: '🌟【發セット永続強化】索子・三元牌の基礎攻撃力+2！',
      });
      break;
    }
    case 'chun': {
      addPermanentGroupAtk(s, ['dragon'], 4);
      s.log.push({
        side: 'system',
        text: '🌟【中セット永続強化】三元牌の基礎攻撃力+4！',
      });
      break;
    }
    case 'riichi': {
      addPermanentGroupAtk(s, ['m', 'p', 's'], 2);
      addPermanentMaxHp(s, 20);
      s.log.push({
        side: 'system',
        text: '🌟【リーチ永続強化】全数牌（萬・筒・索）の基礎攻撃力+2 ＆ 最大HP+20！',
      });
      break;
    }
    case 'wind_27':
    case 'wind_28':
    case 'wind_29':
    case 'wind_30': {
      addPermanentGroupAtk(s, ['wind'], 3);
      addPermanentMaxHp(s, 10);
      s.log.push({
        side: 'system',
        text: `🌟【${y.name}永続強化】風牌の基礎攻撃力+3 ＆ 最大HP+10！`,
      });
      break;
    }
    case 'tanyao': {
      const suits = [
        ...new Set(
          d.sets
            .map((m) => suitOf(m.kind))
            .filter((st): st is 'm' | 'p' | 's' => st === 'm' || st === 'p' || st === 's'),
        ),
      ];
      const targets: TileGroup[] = suits.length > 0 ? suits : ['m', 'p', 's'];
      addPermanentGroupAtk(s, targets, 2);
      s.log.push({
        side: 'system',
        text: `🌟【タンヤオ永続強化】${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+2！`,
      });
      break;
    }
    case 'iipeikou': {
      const shuntsu = d.sets.filter((m) => m.type === 'shuntsu');
      const suits = [
        ...new Set(
          shuntsu
            .filter((m, i) => shuntsu.some((o, j) => i !== j && o.kind === m.kind))
            .map((m) => suitOf(m.kind))
            .filter((st): st is 'm' | 'p' | 's' => st === 'm' || st === 'p' || st === 's'),
        ),
      ];
      const targets: TileGroup[] = suits.length > 0 ? suits : ['m'];
      addPermanentGroupAtk(s, targets, 4);
      s.log.push({
        side: 'system',
        text: `🌟【一盃口永続強化】${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+4！`,
      });
      break;
    }
    case 'nishoku_doujun': {
      const shuntsu = d.sets.filter((m) => m.type === 'shuntsu');
      const suits = [
        ...new Set(
          shuntsu
            .filter((a, i) =>
              shuntsu.some((b, j) => i !== j && numOf(a.kind) === numOf(b.kind) && suitOf(a.kind) !== suitOf(b.kind)),
            )
            .map((m) => suitOf(m.kind))
            .filter((st): st is 'm' | 'p' | 's' => st === 'm' || st === 'p' || st === 's'),
        ),
      ];
      const targets: TileGroup[] = suits.length > 0 ? suits : ['m', 'p'];
      addPermanentGroupAtk(s, targets, 3);
      s.log.push({
        side: 'system',
        text: `🌟【二色同順永続強化】${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+3！`,
      });
      break;
    }
    case 'nishoku_doukou': {
      const numSets = d.sets.filter((m) => isSet(m) && !isHonor(m.kind));
      const suits = [
        ...new Set(
          numSets
            .filter((a, i) =>
              numSets.some((b, j) => i !== j && numOf(a.kind) === numOf(b.kind) && suitOf(a.kind) !== suitOf(b.kind)),
            )
            .map((m) => suitOf(m.kind))
            .filter((st): st is 'm' | 'p' | 's' => st === 'm' || st === 'p' || st === 's'),
        ),
      ];
      const targets: TileGroup[] = suits.length > 0 ? suits : ['m', 'p'];
      addPermanentGroupAtk(s, targets, 4);
      s.log.push({
        side: 'system',
        text: `🌟【二色同刻永続強化】${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+4！`,
      });
      break;
    }
    case 'niankou': {
      const groups = [...new Set(d.sets.filter(isSet).map((m) => kindToGroup(m.kind)))];
      const targets: TileGroup[] = groups.length > 0 ? groups : ['m'];
      addPermanentGroupAtk(s, targets, 2);
      s.log.push({
        side: 'system',
        text: `🌟【二暗刻永続強化】${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+2！`,
      });
      break;
    }
    case 'chanta': {
      addPermanentGroupAtk(s, ['wind', 'dragon'], 3);
      addPermanentMaxHp(s, 25);
      s.log.push({
        side: 'system',
        text: '🌟【チャンタ永続強化】風牌・三元牌の基礎攻撃力+3 ＆ 最大HP+25！',
      });
      break;
    }
    case 'four_pairs': {
      addPermanentGroupAtk(s, ['m', 'p', 's', 'wind', 'dragon'], 2);
      addPermanentMaxHp(s, 30);
      s.log.push({
        side: 'system',
        text: '🌟【四対子永続強化】全牌種の基礎攻撃力+2 ＆ 最大HP+30！',
      });
      break;
    }
    case 'honiisou': {
      const numKind = d.sets
        .flatMap((m) => m.tiles)
        .map(kindOf)
        .find((k) => !isHonor(k));
      const numGrp: TileGroup = numKind !== undefined ? (suitOf(numKind) as TileGroup) : 'm';
      addPermanentGroupAtk(s, [numGrp, 'wind', 'dragon'], 4);
      s.log.push({
        side: 'system',
        text: `🌟【混一色永続強化】${TILE_GROUP_LABEL[numGrp]}・風牌・三元牌の基礎攻撃力+4！`,
      });
      break;
    }
    case 'pinfu': {
      addPermanentMaxHp(s, 50);
      const suits = [
        ...new Set(
          d.sets
            .map((m) => suitOf(m.kind))
            .filter((st): st is 'm' | 'p' | 's' => st === 'm' || st === 'p' || st === 's'),
        ),
      ];
      const targets: TileGroup[] = suits.length > 0 ? suits : ['m', 'p', 's'];
      addPermanentGroupAtk(s, targets, 3);
      s.log.push({
        side: 'system',
        text: `🌟【平和永続強化】最大HP+50 ＆ ${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+3！`,
      });
      break;
    }
    case 'sanankou': {
      addPermanentGroupAtk(s, ['m', 'p', 's', 'wind', 'dragon'], 3);
      s.log.push({
        side: 'system',
        text: '🌟【三暗刻永続強化】全牌種の基礎攻撃力+3！',
      });
      break;
    }
    case 'chinroutou': {
      addPermanentGroupAtk(s, ['m', 'p', 's'], 5);
      addPermanentMaxHp(s, 50);
      s.log.push({
        side: 'system',
        text: '🌟【清老頭永続強化】全数牌（萬・筒・索）の基礎攻撃力+5 ＆ 最大HP+50！',
      });
      break;
    }
    case 'chiniisou': {
      const st = (y.suit ?? 'p') as TileGroup;
      addPermanentGroupAtk(s, [st], 8);
      s.log.push({
        side: 'system',
        text: `🌟【清一色永続強化】${TILE_GROUP_LABEL[st]}の基礎攻撃力+8！`,
      });
      break;
    }
    case 'daisangen': {
      addPermanentGroupAtk(s, ['dragon'], 15);
      addPermanentMaxHp(s, 100);
      s.log.push({
        side: 'system',
        text: '🌟【大三元永続強化】三元牌の基礎攻撃力+15 ＆ 最大HP+100！',
      });
      break;
    }
    case 'ryuuiisou': {
      addPermanentGroupAtk(s, ['s', 'dragon'], 12);
      addPermanentMaxHp(s, 150);
      s.log.push({
        side: 'system',
        text: '🌟【緑一色永続強化】索子・三元牌の基礎攻撃力+12 ＆ 最大HP+150！',
      });
      break;
    }
    case 'tsuuiisou': {
      addPermanentGroupAtk(s, ['wind', 'dragon'], 15);
      addPermanentMaxHp(s, 150);
      s.log.push({
        side: 'system',
        text: '🌟【字一色永続強化】風牌・三元牌の基礎攻撃力+15 ＆ 最大HP+150！',
      });
      break;
    }
    case 'sankantsu': {
      addPermanentGroupAtk(s, ['m', 'p', 's', 'wind', 'dragon'], 10);
      addPermanentMaxHp(s, 150);
      s.log.push({
        side: 'system',
        text: '🌟【三槓子永続強化】全牌種の基礎攻撃力+10 ＆ 最大HP+150！',
      });
      break;
    }
    case 'neko_punch': {
      for (const p of d.pairs) {
        const grp = kindToGroup(p.kind);
        s.bonusTileAtk[grp] = (s.bonusTileAtk[grp] ?? 0) + 1;
      }
      s.log.push({
        side: 'system',
        text: `🌟【ねこぱんち永続強化】ペア牌種の基礎攻撃力+${d.pairs.length}！`,
      });
      break;
    }
    case 'tsuyotsuyo': {
      const groups = [...new Set(d.sets.map((m) => kindToGroup(m.kind)))];
      const targets: TileGroup[] = groups.length > 0 ? groups : ['m'];
      addPermanentGroupAtk(s, targets, 2);
      addPermanentMaxHp(s, 10);
      s.log.push({
        side: 'system',
        text: `🌟【つよつよこうげき永続強化】${targets.map((g) => TILE_GROUP_LABEL[g]).join('・')}の基礎攻撃力+2 ＆ 最大HP+10！`,
      });
      break;
    }
  }
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
  maxRarity?: Rarity,
): string[] {
  const order: Rarity[] = ['common', 'uncommon', 'rare', 'legend'];
  const minIdx = order.indexOf(minRarity);
  const maxIdx = maxRarity ? order.indexOf(maxRarity) : order.length - 1;
  const owned = new Set(s.equipments);
  const canLegend = forceAllowLegend || s.stage >= 5 || minRarity === 'legend';

  let pool = EQUIPMENTS.filter(
    (e) =>
      !owned.has(e.id) &&
      order.indexOf(e.rarity) >= minIdx &&
      order.indexOf(e.rarity) <= maxIdx &&
      (canLegend || e.rarity !== 'legend'),
  );

  // 未所持の該当レアリティ装備が足りない場合は未所持全体から補う
  if (pool.length < count) {
    pool = EQUIPMENTS.filter(
      (e) =>
        !owned.has(e.id) &&
        order.indexOf(e.rarity) <= maxIdx &&
        (canLegend || e.rarity !== 'legend'),
    );
  }
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
  const sc = calculateScore(s);
  s.scoreBonusMoney = sc.bonusMoneyFromScore;
  gainMoney(s, sc.bonusMoneyFromScore, `最終スコア報酬（Score: ${sc.totalScore.toLocaleString()}）`);
  return true;
}

function recordMonsterStep(
  s: BattleState,
  steps: MonsterTurnStep[],
  declareText: string,
  effectText: string,
): void {
  const fullText = effectText ? `${declareText} ${effectText}` : declareText;
  s.log.push({ side: 'monster', text: fullText });
  const snap = structuredClone(s);
  if (snap.status === 'lost') {
    snap.status = 'playing';
  }
  steps.push({
    declareText,
    effectText,
    stateAfterEffect: snap,
    events: [...s.events],
  });
  s.events = [];
}

function forceCancelRiichiNoPenalty(s: BattleState): string {
  if (!s.riichi) return '';
  s.riichi = false;
  s.riichiSwapsThisTurn = 0;
  return '（リーチがペナルティなしで強制解除された！）';
}

function executeSingleMonsterAction(
  s: BattleState,
  rng: Rng,
  allowMultiStrike: boolean,
  steps: MonsterTurnStep[],
): void {
  if (s.status !== 'playing' || s.monster.hp <= 0) return;
  const def = s.monster.def;
  // 「ためる」の後は、必ず「通常攻撃」を行う
  const skill = s.enemyBuffs.charged
    ? ENEMY_SKILLS.normal
    : chooseMonsterSkill(def, rng, allowMultiStrike);

  const chargeMult = s.enemyBuffs.charged ? 3 : 1;
  // ためる以外の行動をしたら溜め状態を消費
  if (skill.id !== 'charge') {
    s.enemyBuffs.charged = false;
  }

  const dmgCutCount = countActiveEquip(s, 'dmg_cut_10');
  const dmgCutMult = Math.pow(0.8, dmgCutCount);
  // リーチ時のダメージ半減は「雀老師（master）」のみ発動
  const riichiCutMult = s.riichi && s.job === 'master' ? 0.5 : 1;

  const applyMonsterDamage = (rawDmg: number): string => {
    if (s.buffs.nullifyDamage) {
      s.buffs.nullifyDamage = false;
      return '→ 白セットの障壁がダメージを無効化した！';
    }
    let dmg = Math.max(1, Math.round(rawDmg * chargeMult * dmgCutMult * riichiCutMult));
    let guardNote = '';
    if (s.buffs.guardBarrier > 0) {
      const blocked = Math.min(dmg, s.buffs.guardBarrier);
      dmg = Math.max(0, dmg - blocked);
      s.buffs.guardBarrier = 0;
      guardNote = `（ガードで -${blocked.toLocaleString()} 軽減！）`;
    }
    s.player.hp = Math.max(0, s.player.hp - dmg);
    if (dmg > 0) {
      s.events.push({ type: 'damage', target: 'player', amount: dmg });
    }
    const riichiNote = s.riichi && s.job === 'master' ? '（雀老師リーチ中半減）' : '';
    checkPlayerDefeatOrRevive(s);
    return `→ ${dmg.toLocaleString()} ダメージ${riichiNote}${guardNote}`;
  };

  const dealDamageToPlayer = (rawDmg: number, label: string) => {
    const declareText = `${def.name}の「${label}」！`;
    const effectText = applyMonsterDamage(rawDmg);
    recordMonsterStep(s, steps, declareText, effectText);
  };

  switch (skill.id) {
    case 'idle': {
      recordMonsterStep(
        s,
        steps,
        `${def.name}の「様子見」…`,
        '→ ぼーっとしていて何もしてこなかった！（0 ダメージ）',
      );
      break;
    }
    case 'normal': {
      dealDamageToPlayer(rollMonsterDamage(def.atk, rng), '通常攻撃');
      break;
    }
    case 'critical': {
      dealDamageToPlayer(rollMonsterDamage(def.atk, rng) * 2, 'クリティカル');
      break;
    }
    case 'seal_yaku': {
      s.buffs.sealYakuTurns += 1;
      recordMonsterStep(s, steps, `${def.name}の「封印」！`, '1ターンの間、役の効果発動が無効化された！');
      break;
    }
    case 'atk_down': {
      s.buffs.atkDownTurns += 3;
      recordMonsterStep(s, steps, `${def.name}の「攻撃力ダウン」！`, '3ターンの間、攻撃力合計に-10の補正！');
      dealDamageToPlayer(Math.round(rollMonsterDamage(def.atk, rng) * 0.6), '追撃');
      break;
    }
    case 'charge': {
      s.enemyBuffs.charged = true;
      recordMonsterStep(s, steps, `${def.name}の「ためる」！`, '次の通常攻撃のダメージが3倍になる！');
      break;
    }
    case 'defend': {
      s.enemyBuffs.defendTurns += 2;
      recordMonsterStep(s, steps, `${def.name}の「防御」！`, '2ターンの間、敵へのダメージが半減する！');
      break;
    }
    case 'slow': {
      s.buffs.slowTurns += 2;
      s.extraChains = 0;
      s.chain = 0;
      recordMonsterStep(s, steps, `${def.name}の「鈍化」！`, '装備効果を含めチェーンが完全に封じられた！');
      break;
    }
    case 'seal_tiles': {
      const count = Math.min(3, s.hand.length);
      const pool = [...s.hand];
      for (let i = 0; i < count; i++) {
        const idx = rng.int(pool.length);
        const t = pool[idx];
        pool.splice(idx, 1);
        s.sealedTiles[t] = (s.sealedTiles[t] ?? 0) + 2;
      }
      const riichiBreakNote = count > 0 ? forceCancelRiichiNoPenalty(s) : '';
      recordMonsterStep(
        s,
        steps,
        `${def.name}の「牌封印」！`,
        `手牌のうち${count}枚が2ターン攻撃に使えなくなった！${riichiBreakNote}`,
      );
      break;
    }
    case 'heal': {
      const amount = Math.round(s.monster.maxHp * 0.3);
      s.monster.hp = Math.min(s.monster.maxHp, s.monster.hp + amount);
      s.events.push({ type: 'heal', target: 'monster', amount });
      recordMonsterStep(s, steps, `${def.name}の「回復」！`, `HPが ${amount.toLocaleString()} 回復した！`);
      break;
    }
    case 'double_strike': {
      recordMonsterStep(s, steps, `${def.name}の「連撃」！`, '2回連続で行動する！');
      executeSingleMonsterAction(s, rng, false, steps);
      if (s.status === 'playing') executeSingleMonsterAction(s, rng, false, steps);
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
        recordMonsterStep(s, steps, `${def.name}の「装備封印」！`, `装備「${eq.name}」が無効化された！`);
      } else {
        dealDamageToPlayer(rollMonsterDamage(def.atk, rng), '通常攻撃');
      }
      break;
    }
    case 'reflect': {
      s.enemyBuffs.reflectTurns += 2;
      recordMonsterStep(s, steps, `${def.name}の「反射」！`, '2ターンの間、受けたダメージの半分を跳ね返す！');
      break;
    }
    case 'half_hp': {
      const declareText = `${def.name}の「割合ダメージ」！`;
      if (s.buffs.nullifyDamage) {
        s.buffs.nullifyDamage = false;
        recordMonsterStep(s, steps, declareText, '→ 白セットの障壁が無効化した！');
      } else {
        const baseDmg = Math.max(1, Math.floor(s.player.hp / 2));
        let dmg = Math.max(1, Math.round(baseDmg * riichiCutMult));
        let guardNote = '';
        if (s.buffs.guardBarrier > 0) {
          const blocked = Math.min(dmg, s.buffs.guardBarrier);
          dmg = Math.max(0, dmg - blocked);
          s.buffs.guardBarrier = 0;
          guardNote = `（ガードで -${blocked.toLocaleString()} 軽減！）`;
        }
        s.player.hp = Math.max(0, s.player.hp - dmg);
        if (dmg > 0) {
          s.events.push({ type: 'damage', target: 'player', amount: dmg });
        }
        const riichiNote = s.riichi && s.job === 'master' ? '（雀老師リーチ中半減）' : '';
        checkPlayerDefeatOrRevive(s);
        recordMonsterStep(s, steps, declareText, `→ ${dmg.toLocaleString()} ダメージ${riichiNote}${guardNote}`);
      }
      break;
    }
    case 'venom': {
      s.buffs.venomTurns += 5;
      recordMonsterStep(
        s,
        steps,
        `${def.name}の「猛毒」！`,
        '5ターンの間、攻撃力合計-20＋攻撃後にHP-10%！',
      );
      break;
    }
    case 'triple_strike': {
      recordMonsterStep(s, steps, `${def.name}の「神速」！`, '3回連続で行動する！');
      for (let i = 0; i < 3 && s.status === 'playing'; i++) {
        executeSingleMonsterAction(s, rng, false, steps);
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
      const riichiBreakNote = forceCancelRiichiNoPenalty(s);
      recordMonsterStep(
        s,
        steps,
        `${def.name}の「手牌破壊」！`,
        `手牌${n}枚が消去され、素の残り牌${n}枚と入れ替わった！${riichiBreakNote}`,
      );
      break;
    }
    case 'break_kan': {
      if (s.melds.length > 0) {
        s.melds.pop();
        s.drawn = [];
        drawN(s, rng, 3, { ignoreEffects: true });
        const riichiBreakNote = forceCancelRiichiNoPenalty(s);
        recordMonsterStep(
          s,
          steps,
          `${def.name}の「カン破壊」！`,
          `キープしていたカンが破壊され、素の残り牌3枚になった！${riichiBreakNote}`,
        );
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
      const riichiBreakNote = forceCancelRiichiNoPenalty(s);
      recordMonsterStep(
        s,
        steps,
        `${def.name}の「全破壊」！`,
        `手牌がすべて消去され、素の残り牌が補充された！${riichiBreakNote}`,
      );
      break;
    }
    // ---- 新設：ボス固有の特殊行動 ----
    case 'titan_slam': {
      // 巨体で突き飛ばす：2倍ダメージ + ランダムで手牌2つを強制交換
      const declareText = `${def.name}の「巨体で突き飛ばす」！`;
      const dmgText = applyMonsterDamage(rollMonsterDamage(def.atk, rng) * 2);
      const n = Math.min(2, s.hand.length);
      for (let i = 0; i < n; i++) {
        const idx = rng.int(s.hand.length);
        const [removed] = s.hand.splice(idx, 1);
        delete s.sealedTiles[removed];
      }
      s.drawn = [];
      drawN(s, rng, n, { ignoreEffects: true });
      const riichiBreakNote = n > 0 ? forceCancelRiichiNoPenalty(s) : '';
      recordMonsterStep(
        s,
        steps,
        declareText,
        `${dmgText} ＋ 手牌${n}枚が強制交換された！${riichiBreakNote}`,
      );
      break;
    }
    case 'blizzard_breath': {
      // 吹雪の息：1.5倍ダメージ + ランダムで手牌3つを使用不能（2ターン）
      const declareText = `${def.name}の「吹雪の息」！`;
      const dmgText = applyMonsterDamage(Math.round(rollMonsterDamage(def.atk, rng) * 1.5));
      const count = Math.min(3, s.hand.length);
      const pool = [...s.hand];
      for (let i = 0; i < count; i++) {
        const idx = rng.int(pool.length);
        const t = pool[idx];
        pool.splice(idx, 1);
        s.sealedTiles[t] = (s.sealedTiles[t] ?? 0) + 2;
      }
      const riichiBreakNote = count > 0 ? forceCancelRiichiNoPenalty(s) : '';
      recordMonsterStep(
        s,
        steps,
        declareText,
        `${dmgText} ＋ 手牌${count}枚が2ターン使用不能（凍結封印）になった！${riichiBreakNote}`,
      );
      break;
    }
    case 'hellfire_breath': {
      // 業火の息：1.5倍ダメージ + 金牌等の強化牌をすべて通常牌に
      const declareText = `${def.name}の「業火の息」！`;
      const dmgText = applyMonsterDamage(Math.round(rollMonsterDamage(def.atk, rng) * 1.5));
      for (const t of [...s.hand, ...s.melds.flatMap((m) => m.tiles)]) {
        s.tileMods[t] = 'normal';
      }
      recordMonsterStep(
        s,
        steps,
        declareText,
        `${dmgText} ＋ 手牌の強化牌（金・赤・虹）がすべて通常牌に戻された！`,
      );
      break;
    }
    case 'cataclysm': {
      // 天災：2.5倍ダメージ + 全牌強制交換
      const declareText = `${def.name}の「天災」！`;
      const dmgText = applyMonsterDamage(Math.round(rollMonsterDamage(def.atk, rng) * 2.5));
      const targetCount = Math.max(1, HAND_SIZE - s.melds.length * 3);
      s.hand = [];
      s.sealedTiles = {};
      s.drawn = [];
      drawN(s, rng, targetCount, { ignoreEffects: true });
      const riichiBreakNote = forceCancelRiichiNoPenalty(s);
      recordMonsterStep(
        s,
        steps,
        declareText,
        `${dmgText} ＋ 全手牌が強制交換された！${riichiBreakNote}`,
      );
      break;
    }
  }
}

function endPlayerTurnAndAdvance(s: BattleState, rng: Rng, steps: MonsterTurnStep[]): void {
  const dec = (v: number) => Math.max(0, v - 1);

  // プレイヤーターン終了時に役封印・牌封印の残りターンを1経過させる（敵が付与した2ターン牌封印が次の自分の2ターン持続するようにする）
  s.buffs.sealYakuTurns = dec(s.buffs.sealYakuTurns);
  for (const tStr of Object.keys(s.sealedTiles)) {
    const t = Number(tStr);
    s.sealedTiles[t]--;
    if (s.sealedTiles[t] <= 0) delete s.sealedTiles[t];
  }

  // 敵の行動
  executeSingleMonsterAction(s, rng, true, steps);
  if (s.status !== 'playing') return;

  // ターン終了時の持続ターン経過処理
  s.buffs.honiisouTurns = dec(s.buffs.honiisouTurns);
  s.buffs.pinfuTurns = dec(s.buffs.pinfuTurns);
  s.buffs.sanankouTurns = dec(s.buffs.sanankouTurns);
  s.buffs.chinroutouTurns = dec(s.buffs.chinroutouTurns);
  s.buffs.chiniisouTurns = dec(s.buffs.chiniisouTurns);
  if (s.buffs.chiniisouTurns === 0) s.buffs.chiniisouSuit = null;

  s.buffs.atkDownTurns = dec(s.buffs.atkDownTurns);
  s.buffs.slowTurns = dec(s.buffs.slowTurns);
  s.buffs.venomTurns = dec(s.buffs.venomTurns);

  s.enemyBuffs.defendTurns = dec(s.enemyBuffs.defendTurns);
  s.enemyBuffs.reflectTurns = dec(s.enemyBuffs.reflectTurns);

  s.cooldowns.resetWall = dec(s.cooldowns.resetWall);
  s.cooldowns.copy = dec(s.cooldowns.copy);
  s.cooldowns.search = dec(s.cooldowns.search);

  // 毎ターン回復（平和バフ15% ＋ 装備「再生の牌皿」5%×所持数）
  const regenEquipCount = countActiveEquip(s, 'regen_5');
  const pinfuRate = s.buffs.pinfuTurns > 0 ? 0.15 : 0;
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
  s.riichiSwapsThisTurn = 0;
  s.extraChains = s.buffs.slowTurns > 0 ? 0 : countActiveEquip(s, 'always_chain_1');
  s.nextChainMult = 1;
}

function handleMonsterDefeated(s: BattleState, rng: Rng): void {
  s.log.push({ side: 'system', text: `${s.monster.def.name}を倒した！` });
  const killMoney = s.stage * 100;
  gainMoney(s, killMoney, '敵撃破報酬');
  if (s.stage >= MAX_STAGE) {
    s.status = 'won';
    s.log.push({ side: 'system', text: `全${MAX_STAGE}連戦を制覇した！完全勝利！！` });
    const sc = calculateScore(s);
    s.scoreBonusMoney = sc.bonusMoneyFromScore;
    gainMoney(s, sc.bonusMoneyFromScore, `最終スコア報酬（Score: ${sc.totalScore.toLocaleString()}）`);
  } else {
    s.status = 'reward';
    const maxRarity: Rarity | undefined = s.monster.def.commonOnlyReward ? 'common' : undefined;
    s.rewardChoices = rollRandomEquipments(s, rng, 3, 'common', false, maxRarity);
    s.log.push({ side: 'system', text: '報酬の装備を3つの中から1つ選んでください' });
  }
}

function pickUniqueEquipIds(
  pool: readonly { id: string }[],
  count: number,
  rng: Rng,
): string[] {
  const arr = pool.map((e) => e.id);
  const picked: string[] = [];
  for (let i = 0; i < count && arr.length > 0; i++) {
    const idx = rng.int(arr.length);
    picked.push(arr[idx]);
    arr.splice(idx, 1);
  }
  return picked;
}

function openShop(s: BattleState, rng: Rng): void {
  const owned = new Set(s.equipments);
  const cuPool = EQUIPMENTS.filter(
    (e) => !owned.has(e.id) && (e.rarity === 'common' || e.rarity === 'uncommon'),
  );
  const rarePool = EQUIPMENTS.filter((e) => !owned.has(e.id) && e.rarity === 'rare');
  const legendPool = EQUIPMENTS.filter((e) => !owned.has(e.id) && e.rarity === 'legend');

  s.shopItems = [
    ...pickUniqueEquipIds(cuPool, 4, rng),
    ...pickUniqueEquipIds(rarePool, 2, rng),
    ...pickUniqueEquipIds(legendPool, 1, rng),
  ];
  s.shopHealUsed = false;
  s.rewardChoices = [];
  s.status = 'shop';
  s.log.push({
    side: 'system',
    text: '🏮 3試合終了！ 商店に到着しました（銭を使ってステータス永続強化・装備購入・売却・HP回復が可能）',
  });
}

function advanceToNextStage(s: BattleState, rng: Rng): void {
  // 次のステージへ進行（手牌・カン・持続バフ・デバフ・残り牌状況を持ち越す）
  const nextStage = Math.min(MAX_STAGE, s.stage + 1);
  const nextDef = MONSTERS[nextStage - 1];
  s.stage = nextStage;
  s.monster = { def: nextDef, hp: nextDef.hp, maxHp: nextDef.hp };
  s.turn = 1;
  s.chain = 0;
  // デバフ（sealedEquipIndices / buffs.* / sealedTiles）は次の敵へそのまま持ち越す
  s.extraChains = s.buffs.slowTurns > 0 ? 0 : countActiveEquip(s, 'always_chain_1');
  s.nextChainMult = 1;
  s.riichi = false;
  s.riichiSwapsThisTurn = 0;
  s.revivedThisBattle = 0;
  s.healMode = false;
  s.buffs.guardBarrier = 0;
  s.enemyBuffs = { charged: false, defendTurns: 0, reflectTurns: 0 };
  s.rewardChoices = [];
  s.shopItems = [];
  s.shopHealUsed = false;
  s.status = 'playing';

  ensureStartDragonSet(s, rng);
  s.log.push({
    side: 'system',
    text: `【${nextDef.rank}】${nextDef.name}（HP ${nextDef.hp}）が現れた！`,
  });
}

// ---------------------------------------------------------------------------
// 公開API
// ---------------------------------------------------------------------------

export function newBattle(
  defOrSeed?: MonsterDef | number,
  maybeSeed?: number,
  job: JobId = 'sword',
): BattleState {
  const firstDef = typeof defOrSeed === 'object' && defOrSeed !== null ? defOrSeed : MONSTERS[0];
  const seed = typeof defOrSeed === 'number' ? defOrSeed : (maybeSeed ?? 1);
  const jobDef = getJobDef(job);

  const s: BattleState = {
    rng: seed,
    uid: 1,
    stage: firstDef.stage ?? 1,
    job,
    wall: allTileIds(),
    hand: [],
    melds: [],
    drawn: [],
    tileMods: {},
    sealedTiles: {},
    banishedKinds: [],
    bonusTileAtk: { m: 0, p: 0, s: 0, wind: 0, dragon: 0 },
    money: 0,
    scoreBonusMoney: 0,
    yakuHistory: [],
    player: {
      hp: PLAYER_INITIAL_HP,
      maxHp: PLAYER_INITIAL_HP,
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
    riichiSwapsThisTurn: 0,
    revivedThisBattle: 0,
    healMode: false,
    cooldowns: { resetWall: 0, copy: 0, search: 0 },
    buffs: {
      nullifyDamage: false,
      guardBarrier: 0,
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
    shopItems: [],
    shopHealUsed: false,
    resets: 0,
    status: 'playing',
    log: [
      {
        side: 'system',
        text: `職業「${jobDef.icon}${jobDef.name}」で出陣！【${firstDef.rank}】${firstDef.name}（HP ${firstDef.hp}）が現れた！`,
      },
    ],
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

    // 3試合終了ごと（第3戦・第6戦・第9戦クリア後）に商店へ入る
    if (s.stage % 3 === 0 && s.stage < MAX_STAGE) {
      openShop(s, rng);
    } else {
      advanceToNextStage(s, rng);
    }
    s.rng = rng.state;
    return { state: s };
  }

  // 商店での処理
  if (action.type === 'buy_shop_item') {
    if (s.status !== 'shop') return fail('現在は商店にいません');
    if (!s.shopItems.includes(action.equipId)) return fail('その商品は在庫にありません');
    if (s.equipments.includes(action.equipId)) return fail('すでに所持している装備です');
    const eq = getEquipment(action.equipId);
    const price = getEquipmentBuyPrice(eq.rarity);
    if (s.money < price) return fail(`銭が足りません（必要: ${price.toLocaleString()}銭）`);

    s.money -= price;
    s.shopItems = s.shopItems.filter((id) => id !== action.equipId);
    s.log.push({
      side: 'system',
      text: `🛒【商店】${price.toLocaleString()}銭を支払い、「${eq.name}」を購入した！（残り ${s.money.toLocaleString()}銭）`,
    });
    grantEquipment(s, action.equipId, rng);
    s.rng = rng.state;
    return { state: s };
  }

  if (action.type === 'buy_shop_hp') {
    if (s.status !== 'shop') return fail('現在は商店にいません');
    if (s.money < SHOP_HP_UP_COST) {
      return fail(`銭が足りません（必要: ${SHOP_HP_UP_COST.toLocaleString()}銭）`);
    }
    s.money -= SHOP_HP_UP_COST;
    addPermanentMaxHp(s, 100);
    s.log.push({
      side: 'system',
      text: `💪【商店強化】${SHOP_HP_UP_COST.toLocaleString()}銭を支払い、最大HP＋100（現在HPも+100）に強化した！（残り ${s.money.toLocaleString()}銭）`,
    });
    s.rng = rng.state;
    return { state: s };
  }

  if (action.type === 'buy_shop_atk') {
    if (s.status !== 'shop') return fail('現在は商店にいません');
    if (s.money < SHOP_ATK_UP_COST) {
      return fail(`銭が足りません（必要: ${SHOP_ATK_UP_COST.toLocaleString()}銭）`);
    }
    const g = action.group;
    s.money -= SHOP_ATK_UP_COST;
    s.bonusTileAtk[g] = (s.bonusTileAtk[g] ?? 0) + 2;
    s.log.push({
      side: 'system',
      text: `⚔️【商店強化】${SHOP_ATK_UP_COST.toLocaleString()}銭を支払い、${TILE_GROUP_LABEL[g]}の基礎攻撃力＋2（合計+${s.bonusTileAtk[g]}）に強化した！（残り ${s.money.toLocaleString()}銭）`,
    });
    s.rng = rng.state;
    return { state: s };
  }

  if (action.type === 'buy_shop_heal') {
    if (s.status !== 'shop') return fail('現在は商店にいません');
    if (s.shopHealUsed) return fail('HP回復はこの商店で1回のみ利用できます');
    if (s.player.hp >= s.player.maxHp) return fail('HPはすでに満タンです');
    const price = 1000;
    if (s.money < price) return fail('銭が足りません（必要: 1,000銭）');

    s.money -= price;
    s.shopHealUsed = true;
    const heal = Math.max(1, Math.round(s.player.maxHp * 0.3));
    s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
    s.events.push({ type: 'heal', target: 'player', amount: heal });
    s.log.push({
      side: 'system',
      text: `🍵【商店】1,000銭を支払い、HPを ${heal.toLocaleString()}（30%）回復した！（残り ${s.money.toLocaleString()}銭）`,
    });
    s.rng = rng.state;
    return { state: s };
  }

  if (action.type === 'sell_equip') {
    if (s.status !== 'shop') return fail('現在は商店にいません');
    const idx = action.equipIndex;
    if (idx < 0 || idx >= s.equipments.length) return fail('売却する装備の指定が不正です');

    const [removedId] = s.equipments.splice(idx, 1);
    s.sealedEquipIndices = s.sealedEquipIndices
      .filter((i) => i !== idx)
      .map((i) => (i > idx ? i - 1 : i));

    if (removedId === 'hp_up_10') {
      s.player.maxHp = Math.max(1, Math.round(s.player.maxHp / 1.1));
      s.player.hp = Math.min(s.player.hp, s.player.maxHp);
    } else if (removedId === 'hp_up_30') {
      s.player.maxHp = Math.max(1, Math.round(s.player.maxHp / 1.3));
      s.player.hp = Math.min(s.player.hp, s.player.maxHp);
    } else if (removedId === 'hp_double') {
      s.player.maxHp = Math.max(1, Math.round(s.player.maxHp / 2));
      s.player.hp = Math.min(s.player.hp, s.player.maxHp);
    }

    const eq = getEquipment(removedId);
    const sellPrice = getEquipmentSellPrice(eq.rarity);
    gainMoney(s, sellPrice, `装備「${eq.name}」売却`);
    s.rng = rng.state;
    return { state: s };
  }

  if (action.type === 'leave_shop') {
    if (s.status !== 'shop') return fail('現在は商店にいません');
    advanceToNextStage(s, rng);
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
      const maxSwaps = getRiichiMaxSwaps(s);
      const masterNote = s.job === 'master' ? '被ダメ半減 ／ ' : '';
      const need = 3 - s.melds.length;
      if (s.hand.length >= need * 3) {
        const discards = findRiichiDiscards(s.hand, s.melds);
        if (action.discardTile === undefined || !discards.includes(action.discardTile)) {
          return fail('リーチ宣言で捨てる牌（聴牌になる牌）を1枚選んでください');
        }
        // 選んだ捨て牌1枚を切ってリーチ宣言（1ターン最大maxSwaps枚入れ替えの1枚目として処理）
        s.riichi = true;
        s.riichiSwapsThisTurn = 1;
        const discardName = kindName(kindOf(action.discardTile));
        const dIdx = s.hand.indexOf(action.discardTile);
        if (dIdx >= 0) s.hand.splice(dIdx, 1);
        delete s.sealedTiles[action.discardTile];
        s.drawn = [];
        drawOne(s, rng);
        const completedNow = hasThreeSets(s.hand, s.melds);
        s.log.push({
          side: 'player',
          text: completedNow
            ? `${discardName} を切ってリーチ宣言！（1/${maxSwaps}枚目） いきなり3セットが揃いました！`
            : `${discardName} を切ってリーチ宣言！（${masterNote}1/${maxSwaps}枚目入れ替え） 1ターン最大${maxSwaps}枚まで自動で自摸切りを進めます！`,
        });
        s.rng = rng.state;
        return { state: s };
      }

      s.riichi = true;
      s.riichiSwapsThisTurn = 0;
      s.log.push({
        side: 'player',
        text: `リーチ宣言！（${masterNote}1ターン最大${maxSwaps}枚まで自動で自摸切りを進めます！）`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'cancel_riichi': {
      if (!s.riichi) return fail('現在はリーチ中ではありません');
      s.riichi = false;
      s.riichiSwapsThisTurn = 0;
      s.buffs.sealYakuTurns += 5;
      s.log.push({
        side: 'player',
        text: 'リーチをキャンセルした！（ペナルティ：5ターンの間、役の効果が発動しなくなる）',
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
        text: `特殊行動「残り牌リセット」！ 永続的に0になった牌を除き、全種の残り牌が補充された（${s.wall.length}枚）`,
      });
      s.rng = rng.state;
      return { state: s };
    }

    case 'guard': {
      if (s.riichi) return fail('リーチ中はガードできません');
      const tiles = [...new Set(action.tiles)];
      if (tiles.some((t) => !s.hand.includes(t))) return fail('手牌にない牌が含まれています');
      if (tiles.some((t) => (s.sealedTiles[t] ?? 0) > 0)) return fail('封印されている牌は使えません');
      const meldIdx = [...new Set(action.melds)];
      if (meldIdx.some((i) => i < 0 || i >= s.melds.length)) return fail('カンの指定が不正です');
      if (tiles.length === 0 && meldIdx.length === 0) return fail('ガードに使う牌を選んでください');
      const melds = meldIdx.map((i) => s.melds[i]);
      const ctx = buildScoreContext(s);
      const ev = evaluateSelection(tiles, melds, ctx);
      if (!ev.valid) return fail(ev.reason ?? 'ガードできません');
      const guardAmount = Math.max(1, Math.round(ev.baseAttack));

      const prevLogLen = s.log.length;
      s.buffs.guardBarrier += guardAmount;
      s.log.push({
        side: 'player',
        text: `ガード！ 基礎攻撃力 ${guardAmount.toLocaleString()} 分の障壁を展開！（次の被ダメージ -${s.buffs.guardBarrier.toLocaleString()}）`,
      });

      // 使用した手牌とカンを消費し補充（役は発動しない）
      s.hand = s.hand.filter((t) => !tiles.includes(t));
      for (const t of tiles) delete s.sealedTiles[t];
      s.melds = s.melds.filter((_, i) => !meldIdx.includes(i));
      s.drawn = [];
      let needDraw = tiles.length + melds.length * 3;
      while (needDraw > 0) {
        drawOne(s, rng);
        needDraw--;
      }

      const afterPlayerState = structuredClone(s);
      const playerEvents = [...s.events];
      const playerLogs = s.log.slice(prevLogLen);
      s.events = [];
      const monsterTurnSteps: MonsterTurnStep[] = [];
      endPlayerTurnAndAdvance(s, rng, monsterTurnSteps);
      s.rng = rng.state;
      return {
        state: s,
        afterPlayerState,
        playerEvents,
        playerLogs,
        monsterTurnSteps,
      };
    }

    case 'cure_debuff': {
      if (s.riichi) return fail('リーチ中は治療できません');
      const activeDebuffs: Array<'seal_yaku' | 'atk_down' | 'slow' | 'venom' | 'seal_tiles' | 'seal_equip'> = [];
      if (s.buffs.sealYakuTurns > 0) activeDebuffs.push('seal_yaku');
      if (s.buffs.atkDownTurns > 0) activeDebuffs.push('atk_down');
      if (s.buffs.slowTurns > 0) activeDebuffs.push('slow');
      if (s.buffs.venomTurns > 0) activeDebuffs.push('venom');
      if (Object.keys(s.sealedTiles).length > 0) activeDebuffs.push('seal_tiles');
      if (s.sealedEquipIndices.length > 0) activeDebuffs.push('seal_equip');

      if (activeDebuffs.length === 0) return fail('現在受けているデバフがありません');

      const prevLogLen = s.log.length;
      const picked = activeDebuffs[rng.int(activeDebuffs.length)];
      let curedName = '';
      switch (picked) {
        case 'seal_yaku':
          s.buffs.sealYakuTurns = 0;
          curedName = '役封印';
          break;
        case 'atk_down':
          s.buffs.atkDownTurns = 0;
          curedName = '攻撃力ダウン';
          break;
        case 'slow':
          s.buffs.slowTurns = 0;
          curedName = '鈍化';
          break;
        case 'venom':
          s.buffs.venomTurns = 0;
          curedName = '猛毒';
          break;
        case 'seal_tiles':
          s.sealedTiles = {};
          curedName = '牌封印';
          break;
        case 'seal_equip':
          s.sealedEquipIndices = [];
          curedName = '装備封印';
          break;
      }

      s.drawn = [];
      s.log.push({
        side: 'player',
        text: `治療！ 攻撃を放棄し、デバフ「${curedName}」を解除した！`,
      });

      const afterPlayerState = structuredClone(s);
      const playerEvents = [...s.events];
      const playerLogs = s.log.slice(prevLogLen);
      s.events = [];
      const monsterTurnSteps: MonsterTurnStep[] = [];
      endPlayerTurnAndAdvance(s, rng, monsterTurnSteps);
      s.rng = rng.state;
      return {
        state: s,
        afterPlayerState,
        playerEvents,
        playerLogs,
        monsterTurnSteps,
      };
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

      const prevLogLen = s.log.length;

      // リーチ中の1枚ツモ切りかどうか
      const isRiichiTsumogiri = s.riichi && !ev.isRiichiComplete;

      // 成立した役をスコア履歴に記録
      if (ev.yaku.length > 0) {
        s.yakuHistory.push(...ev.yaku);
      }

      const yakuText = ev.yaku.length > 0 ? ev.yaku.map((y) => y.name).join('・') : '役なし';
      const chainLabel = s.chain > 0 ? ` [${s.chain} Chain]` : '';
      const setMultLabel = ev.setCountMult > 1 ? ` [${ev.decomp.sets.length}セット×${ev.setCountMult}]` : '';

      // 回復変換モード判定
      if (s.healMode) {
        s.healMode = false;
        const healAmount = ev.damage;
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + healAmount);
        s.events.push({ type: 'heal', target: 'player', amount: healAmount });
        s.log.push({
          side: 'player',
          text: `回復変換！${chainLabel}${setMultLabel} ${yakuText} → HPを ${healAmount.toLocaleString()} 回復した！`,
        });
      } else {
        s.monster.hp = Math.max(0, s.monster.hp - ev.damage);
        s.events.push({ type: 'damage', target: 'monster', amount: ev.damage });
        s.log.push({
          side: 'player',
          text: `攻撃！${chainLabel}${setMultLabel} ${yakuText} → ${ev.damage.toLocaleString()} ダメージ`,
        });

        // レア装備「吸血の雀卓」：役なしおよび1セット役の攻撃時、与えたダメージ分自分を回復
        const isBasicOrTier1 = ev.yaku.length === 0 || ev.yaku.every((y) => y.tier === 1);
        if (isBasicOrTier1 && countActiveEquip(s, 'vamp_basic') > 0) {
          s.player.hp = Math.min(s.player.maxHp, s.player.hp + ev.damage);
          s.events.push({ type: 'heal', target: 'player', amount: ev.damage });
          s.log.push({ side: 'system', text: `吸収効果によりHPが ${ev.damage.toLocaleString()} 回復した！` });
        }

        // 敵の「反射」判定
        if (s.enemyBuffs.reflectTurns > 0 && s.monster.hp > 0) {
          const rawReflect = Math.max(1, Math.floor(ev.damage / 2));
          const reflectDmg =
            s.riichi && s.job === 'master' ? Math.max(1, Math.round(rawReflect * 0.5)) : rawReflect;
          s.player.hp = Math.max(0, s.player.hp - reflectDmg);
          s.events.push({ type: 'damage', target: 'player', amount: reflectDmg });
          s.log.push({
            side: 'monster',
            text: `反射ダメージ！ あなたは ${reflectDmg.toLocaleString()} ダメージを受けた！`,
          });
          if (checkPlayerDefeatOrRevive(s)) {
            s.rng = rng.state;
            return { state: s, attack: ev };
          }
        }
      }

      // 職業固有のセット効果（雀剣士・麻雀医・忍びの雀士）
      if (ev.basicDrawPairs > 0) {
        s.log.push({
          side: 'system',
          text: `【雀剣士効果】役なし同牌セットによりダメージ2倍 ＆ 補充でペア（2枚組）を引き込む！`,
        });
      }
      if (ev.basicShuntsuHealRate > 0) {
        const shuntsuHeal = Math.max(1, Math.round(s.player.maxHp * ev.basicShuntsuHealRate));
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + shuntsuHeal);
        s.events.push({ type: 'heal', target: 'player', amount: shuntsuHeal });
        s.log.push({
          side: 'system',
          text: `【麻雀医効果】役なし並びセットによりHPが ${shuntsuHeal.toLocaleString()} 回復し、補充で2枚並びを引き込む！`,
        });
      }
      if (ev.jobBonusChains > 0) {
        s.log.push({
          side: 'system',
          text: `【忍びの雀士効果】字牌1セット攻撃によりダメージ2.5倍 ＆ チェーン+1！`,
        });
      }

      // セット内に組み込まれた金牌・赤牌・虹牌の銭獲得（従来の2倍：金30・赤50・虹100銭）
      const pureGoldCount = Math.max(0, ev.goldCount - ev.redCount);
      const specialTileMoney =
        pureGoldCount * 30 + ev.redCount * 50 + ev.usedRainbowCount * 100;
      if (specialTileMoney > 0) {
        gainMoney(s, specialTileMoney, 'セット内の金/赤/虹牌使用');
      }

      // 役成立ボーナス銭（従来の2倍強化）
      if (ev.yakuMoney > 0) {
        gainMoney(s, ev.yakuMoney, `${yakuText}成立報酬`);
      }

      // 装備「招財の算盤（unlock_tanyao）」：役成立のたび1役につき+60銭（従来の2倍）
      const abacusCount = countActiveEquip(s, 'unlock_tanyao');
      if (abacusCount > 0 && ev.yaku.length > 0) {
        gainMoney(s, 60 * ev.yaku.length * abacusCount, '招財の算盤');
      }

      // 装備「癒しの戦旗（banner_heal_20）」：役成立時、HPを20%回復
      const bannerCount = countActiveEquip(s, 'banner_heal_20');
      if (bannerCount > 0 && ev.yaku.length > 0) {
        const heal = Math.max(1, Math.round(s.player.maxHp * 0.2 * bannerCount));
        s.player.hp = Math.min(s.player.maxHp, s.player.hp + heal);
        s.events.push({ type: 'heal', target: 'player', amount: heal });
        s.log.push({ side: 'system', text: `【癒しの戦旗】役成立によりHPが ${heal.toLocaleString()} 回復した！` });
      }

      // 赤牌をセット内に組み込んで攻撃に使用した場合、同じ種類の牌の基礎攻撃力+5（永続）
      if (ev.redCount > 0) {
        const activeEquipsNow = getActiveEquips(s);
        const setTiles: TileId[] = ev.decomp.sets.flatMap((m) => m.tiles);
        for (const t of setTiles) {
          if (effectiveTileMod(t, s.tileMods, activeEquipsNow) === 'red') {
            const grp = kindToGroup(kindOf(t));
            s.bonusTileAtk[grp] = (s.bonusTileAtk[grp] ?? 0) + 5;
            s.log.push({
              side: 'system',
              text: `【赤牌効果】${TILE_GROUP_LABEL[grp]}の基礎攻撃力+5（永続）！`,
            });
          }
        }
      }

      // 役の効果＆役に合う永続強化の適用（継続バフが重複した場合は残り継続ターン数を加算）
      let nextMult = 1;
      let forceGoldDrawCount = 0;
      let drawThreePairs = false;
      let drawTriple = false;
      let chantaGold = false;
      let sankantsuRainbowHand = false;

      for (const y of ev.yaku) {
        applyYakuPermanentBonus(s, y, ev.decomp);

        switch (y.id) {
          case 'haku': {
            s.buffs.nullifyDamage = true;
            const hakuHeal = Math.max(1, Math.round(s.player.maxHp * 0.15));
            s.player.hp = Math.min(s.player.maxHp, s.player.hp + hakuHeal);
            s.events.push({ type: 'heal', target: 'player', amount: hakuHeal });
            s.log.push({
              side: 'system',
              text: `【白セット効果】次の被ダメージ無効障壁を展開 ＆ HPが ${hakuHeal.toLocaleString()} 回復！`,
            });
            break;
          }
          case 'chun':
            forceGoldDrawCount += 3;
            s.log.push({ side: 'system', text: '【中セット効果】補充牌のうち3枚が金牌になる！' });
            gainMoney(s, 100, '中セット追加祝儀');
            break;
          case 'iipeikou':
            drawThreePairs = true;
            forceGoldDrawCount += 2;
            s.log.push({ side: 'system', text: '【一盃口効果】ペア（2枚組）を3セット補充し、うち2枚を金牌化！' });
            break;
          case 'nishoku_doujun':
            nextMult = Math.max(nextMult, 2.5);
            s.log.push({ side: 'system', text: '【二色同順効果】次のチェーン倍率が2.5倍になる！' });
            break;
          case 'nishoku_doukou':
            nextMult = Math.max(nextMult, 3.5);
            s.log.push({ side: 'system', text: '【二色同刻効果】次のチェーン倍率が3.5倍になる！' });
            break;
          case 'niankou':
            drawTriple = true;
            s.log.push({ side: 'system', text: '【二暗刻効果】補充に同牌セット（3枚組）が含まれる！' });
            break;
          case 'chanta':
            chantaGold = true;
            s.log.push({ side: 'system', text: '【チャンタ効果】手牌と補充牌の1・9・字牌がすべて金牌になる！' });
            gainMoney(s, 150, 'チャンタ追加祝儀');
            break;
          case 'honiisou':
            s.buffs.honiisouTurns += 5;
            s.log.push({ side: 'system', text: '【混一色効果】字牌が金牌として補充される効果+5ターン！' });
            break;
          case 'pinfu': {
            const pinfuHeal = Math.max(1, Math.round(s.player.maxHp * 0.2));
            s.player.hp = Math.min(s.player.maxHp, s.player.hp + pinfuHeal);
            s.events.push({ type: 'heal', target: 'player', amount: pinfuHeal });
            s.buffs.pinfuTurns += 5;
            s.log.push({
              side: 'system',
              text: `【平和効果】HPを ${pinfuHeal.toLocaleString()} 即時回復 ＆ 毎ターンHP15%自動回復+5ターン！`,
            });
            break;
          }
          case 'sanankou':
            s.buffs.sanankouTurns += 5;
            s.log.push({ side: 'system', text: '【三暗刻効果】ダメージ3倍の効果+5ターン！' });
            break;
          case 'chinroutou':
            s.buffs.chinroutouTurns += 5;
            s.log.push({
              side: 'system',
              text: '【清老頭効果】補充がすべて2〜8の数牌になり50%で金牌化する効果+5ターン！',
            });
            gainMoney(s, 400, '清老頭追加祝儀');
            break;
          case 'chiniisou':
            s.buffs.chiniisouTurns += 5;
            s.buffs.chiniisouSuit = y.suit ?? 'p';
            s.log.push({
              side: 'system',
              text: `【清一色効果】残り牌外から${suitName(s.buffs.chiniisouSuit)}が補充される効果+5ターン！`,
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
            s.buffs.sealYakuTurns = 0;
            s.buffs.atkDownTurns = 0;
            s.buffs.slowTurns = 0;
            s.buffs.venomTurns = 0;
            s.sealedTiles = {};
            s.sealedEquipIndices = [];
            s.log.push({ side: 'system', text: '【字一色効果】すべてのデバフ・封印が完全に浄化された！' });
            break;
          }
          case 'sankantsu': {
            const [legId] = rollRandomEquipments(s, rng, 1, 'legend', true);
            if (legId) grantEquipment(s, legId, rng);
            gainMoney(s, 500, '三槓子特別祝儀');
            sankantsuRainbowHand = true;
            s.log.push({ side: 'system', text: '【三槓子効果】補充後の手牌がすべて虹牌に輝く！' });
            break;
          }
        }
      }

      const riichiGold50 = ev.isRiichiComplete;
      if (ev.isRiichiComplete) {
        s.riichi = false;
        s.riichiSwapsThisTurn = 0;
        s.log.push({ side: 'system', text: '【リーチ完成効果】今回の補充牌が50%の確率で金牌になる！' });
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
        drawOne(s, rng, { forceKind: cloneKind, forceGold: forceGoldDrawCount > 0, riichiGold50 });
        needDraw = 0;
      }

      // 一盃口：ペア3組（最大6枚）を補充
      if (drawThreePairs && needDraw >= 2) {
        const pairsToDraw = Math.min(3, Math.floor(needDraw / 2));
        const availKinds = ACTIVE_KINDS.filter((k) => !isKindBanished(s, k));
        for (let p = 0; p < pairsToDraw; p++) {
          const pk = availKinds[rng.int(availKinds.length)];
          drawOne(s, rng, { forceKind: pk, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
          drawOne(s, rng, { forceKind: pk, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
          needDraw -= 2;
        }
      }

      // 二暗刻：同牌セット（3枚組）を補充
      if (drawTriple && needDraw >= 3) {
        const availKinds = ACTIVE_KINDS.filter((k) => !isKindBanished(s, k));
        const tk = availKinds[rng.int(availKinds.length)];
        for (let i = 0; i < 3; i++) {
          drawOne(s, rng, { forceKind: tk, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
        }
        needDraw -= 3;
      }

      // 雀剣士の同牌セット効果：補充でペアを引き込む
      if (ev.basicDrawPairs > 0 && needDraw >= 2) {
        const pairsToDraw = Math.min(ev.basicDrawPairs, Math.floor(needDraw / 2));
        const availKinds = ACTIVE_KINDS.filter((k) => !isKindBanished(s, k));
        for (let p = 0; p < pairsToDraw && availKinds.length > 0; p++) {
          const pk = availKinds[rng.int(availKinds.length)];
          drawOne(s, rng, { forceKind: pk, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
          drawOne(s, rng, { forceKind: pk, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
          needDraw -= 2;
        }
      }

      // 麻雀医の並びセット効果：補充で2枚並びを引き込む
      if (ev.basicDrawSeq2 > 0 && needDraw >= 2) {
        const seqsToDraw = Math.min(ev.basicDrawSeq2, Math.floor(needDraw / 2));
        const seqStartKinds = ACTIVE_KINDS.filter(
          (k) => !isHonor(k) && numOf(k) <= 8 && !isKindBanished(s, k) && !isKindBanished(s, k + 1),
        );
        for (let q = 0; q < seqsToDraw && seqStartKinds.length > 0; q++) {
          const sk = seqStartKinds[rng.int(seqStartKinds.length)];
          drawOne(s, rng, { forceKind: sk, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
          drawOne(s, rng, { forceKind: sk + 1, forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
          needDraw -= 2;
        }
      }

      // 残りの通常補充
      while (needDraw > 0) {
        drawOne(s, rng, { forceGold: forceGoldDrawCount-- > 0, riichiGold50 });
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

      // 三槓子：手牌すべてを虹牌化
      if (sankantsuRainbowHand) {
        for (const t of s.hand) {
          s.tileMods[t] = 'rainbow';
        }
      }

      // 猛毒デバフ中の攻撃後ダメージ（HP-10%）
      if (s.buffs.venomTurns > 0) {
        const rawPoison = Math.max(1, Math.round(s.player.maxHp * 0.1));
        const poisonDmg =
          s.riichi && s.job === 'master' ? Math.max(1, Math.round(rawPoison * 0.5)) : rawPoison;
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

      // リーチ中の1ターン最大maxSwaps枚入れ替え処理
      if (isRiichiTsumogiri) {
        const maxSwaps = getRiichiMaxSwaps(s);
        s.riichiSwapsThisTurn = (s.riichiSwapsThisTurn ?? 0) + 1;
        if (hasThreeSets(s.hand, s.melds)) {
          s.log.push({
            side: 'system',
            text: `🎉 リーチツモ！（${s.riichiSwapsThisTurn}/${maxSwaps}枚目） 3セットが揃いました！そのまま攻撃できます！`,
          });
          s.rng = rng.state;
          return { state: s, attack: ev };
        }
        if (s.riichiSwapsThisTurn < maxSwaps) {
          s.log.push({
            side: 'system',
            text: `🔄 リーチ自摸切り（${s.riichiSwapsThisTurn}/${maxSwaps}枚目）：このターンあと${maxSwaps - s.riichiSwapsThisTurn}枚入れ替えます…`,
          });
          s.rng = rng.state;
          return { state: s, attack: ev };
        }
        s.riichiSwapsThisTurn = 0;
      }

      // チェーン判定（鈍化中は装備効果も含めチェーン保持数は常に0）
      if (s.buffs.slowTurns > 0) {
        s.extraChains = 0;
        s.chain = 0;
        const afterPlayerState = structuredClone(s);
        const playerEvents = [...s.events];
        const playerLogs = s.log.slice(prevLogLen);
        s.events = [];
        const monsterTurnSteps: MonsterTurnStep[] = [];
        endPlayerTurnAndAdvance(s, rng, monsterTurnSteps);
        s.rng = rng.state;
        return {
          state: s,
          attack: ev,
          afterPlayerState,
          playerEvents,
          playerLogs,
          monsterTurnSteps,
        };
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
          s.rng = rng.state;
          return { state: s, attack: ev };
        } else {
          const afterPlayerState = structuredClone(s);
          const playerEvents = [...s.events];
          const playerLogs = s.log.slice(prevLogLen);
          s.events = [];
          const monsterTurnSteps: MonsterTurnStep[] = [];
          endPlayerTurnAndAdvance(s, rng, monsterTurnSteps);
          s.rng = rng.state;
          return {
            state: s,
            attack: ev,
            afterPlayerState,
            playerEvents,
            playerLogs,
            monsterTurnSteps,
          };
        }
      }
    }
  }
}

/** 種類ごとの残り牌の枚数 */
export function wallCounts(s: BattleState): number[] {
  const counts = new Array<number>(KIND_COUNT).fill(0);
  for (const t of s.wall) counts[kindOf(t)]++;
  return counts;
}
