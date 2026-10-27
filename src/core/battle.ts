import { MonsterDef, PLAYER_MAX_HP } from '../data/monsters';
import { Mentsu } from './mentsu';
import { chooseMonsterAction } from './monster';
import { Rng } from './rng';
import { AttackEval, damageRank, evaluateSelection } from './score';
import { Kind, TileId, allTileIds, kindName, kindOf } from './tile';

/** 手牌の基本枚数。自模ると +1 で計9枚 */
export const HAND_SIZE = 8;

export interface LogEntry {
  side: 'player' | 'monster' | 'system';
  text: string;
}

export interface BattleEvent {
  type: 'damage';
  target: 'player' | 'monster';
  amount: number;
}

export interface BattleState {
  rng: number;
  /** 残り牌 */
  wall: TileId[];
  /** 手牌（門前） */
  hand: TileId[];
  /** 副露した暗槓 */
  melds: Mentsu[];
  /** 直前の操作で引いた牌（表示用） */
  drawn: TileId[];
  player: { hp: number; maxHp: number };
  monster: { def: MonsterDef; hp: number };
  /** このターンに攻撃した回数（Chain数。ダメージに ×(chain+1) の補正） */
  chain: number;
  turn: number;
  /** 残り牌リセットの回数 */
  resets: number;
  status: 'playing' | 'won' | 'lost';
  log: LogEntry[];
  /** 直前の操作で起きたこと（演出用） */
  events: BattleEvent[];
}

export type Action =
  | { type: 'discard'; tile: TileId }
  | { type: 'kan'; kind: Kind }
  | { type: 'attack'; tiles: TileId[]; melds: number[] };

export interface StepResult {
  state: BattleState;
  error?: string;
  attack?: AttackEval;
}

// ---------------------------------------------------------------------------

function drawOne(s: BattleState, rng: Rng): void {
  if (s.wall.length === 0) {
    const used = new Set<TileId>([...s.hand, ...s.melds.flatMap((m) => m.tiles)]);
    s.wall = allTileIds().filter((t) => !used.has(t));
    s.resets++;
    s.log.push({ side: 'system', text: `残り牌がなくなったため、残り牌をリセットした（${s.wall.length}枚）` });
  }
  const i = rng.int(s.wall.length);
  const tile = s.wall[i];
  s.wall[i] = s.wall[s.wall.length - 1];
  s.wall.pop();
  s.hand.push(tile);
  s.drawn.push(tile);
}

function drawN(s: BattleState, rng: Rng, n: number): void {
  for (let i = 0; i < n; i++) drawOne(s, rng);
}

export function newBattle(def: MonsterDef, seed: number): BattleState {
  const s: BattleState = {
    rng: seed,
    wall: allTileIds(),
    hand: [],
    melds: [],
    drawn: [],
    player: { hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP },
    monster: { def, hp: def.hp },
    chain: 0,
    turn: 1,
    resets: 0,
    status: 'playing',
    log: [{ side: 'system', text: `${def.name}（${def.rank}）が現れた！` }],
    events: [],
  };
  const rng = new Rng(seed);
  drawN(s, rng, HAND_SIZE);
  s.drawn = [];
  drawOne(s, rng); // 1巡目の自模
  s.rng = rng.state;
  return s;
}

/** 状態を進める純粋関数（入力の state は変更しない） */
export function step(prev: BattleState, action: Action): StepResult {
  if (prev.status !== 'playing') return { state: prev, error: '戦闘は終了しています' };
  const s: BattleState = structuredClone(prev);
  s.events = [];
  const rng = new Rng(s.rng);
  const fail = (error: string): StepResult => ({ state: prev, error });

  switch (action.type) {
    case 'discard': {
      const idx = s.hand.indexOf(action.tile);
      if (idx < 0) return fail('その牌は手牌にありません');
      s.hand.splice(idx, 1);
      s.log.push({ side: 'player', text: `${kindName(kindOf(action.tile))} を捨てた` });

      // モンスターの行動
      const act = chooseMonsterAction(s.monster.def, rng);
      s.player.hp = Math.max(0, s.player.hp - act.damage);
      s.log.push({
        side: 'monster',
        text: `${s.monster.def.name}の「${act.skill.name}」！ ${act.skill.text}` +
          (act.damage > 0 ? ` → ${act.damage.toLocaleString()} ダメージ` : ''),
      });
      if (act.damage > 0) s.events.push({ type: 'damage', target: 'player', amount: act.damage });

      if (s.player.hp <= 0) {
        s.status = 'lost';
        s.log.push({ side: 'system', text: 'あなたは倒れた……' });
        break;
      }
      s.turn++;
      s.chain = 0;
      s.drawn = [];
      drawOne(s, rng);
      break;
    }

    case 'kan': {
      const tiles = s.hand.filter((t) => kindOf(t) === action.kind);
      if (tiles.length < 4) return fail('暗槓できる牌が4枚ありません');
      const kanTiles = tiles.slice(0, 4);
      s.hand = s.hand.filter((t) => !kanTiles.includes(t));
      s.melds.push({ type: 'kantsu', kind: action.kind, tiles: kanTiles, declared: true });
      s.log.push({ side: 'player', text: `${kindName(action.kind)} を暗槓した` });
      s.drawn = [];
      drawOne(s, rng);
      break;
    }

    case 'attack': {
      const tiles = [...new Set(action.tiles)];
      if (tiles.some((t) => !s.hand.includes(t))) return fail('手牌にない牌が含まれています');
      const meldIdx = [...new Set(action.melds)];
      if (meldIdx.some((i) => i < 0 || i >= s.melds.length)) return fail('副露の指定が不正です');
      const melds = meldIdx.map((i) => s.melds[i]);

      const ev = evaluateSelection(tiles, melds);
      if (!ev.valid) return fail(ev.reason ?? '攻撃できません');

      const mult = s.chain + 1;
      const damage = ev.damage * mult;

      s.monster.hp = Math.max(0, s.monster.hp - damage);
      s.events.push({ type: 'damage', target: 'monster', amount: damage });
      const yakuText = ev.yaku.length > 0 ? ev.yaku.map((y) => y.name).join('・') : '役なし';
      const rank = damageRank(ev.fu, ev.han);
      const rankText = rank ? `・${rank}` : '';
      const mentsuText = ev.multiplier > 1 ? `・×${ev.multiplier}倍` : '';
      const chainText = s.chain > 0 ? ` [${s.chain} Chain ×${mult}]` : '';
      s.log.push({
        side: 'player',
        text: `攻撃！${chainText} ${yakuText}（${ev.fu}符${ev.han}翻${rankText}${mentsuText}）→ ${damage.toLocaleString()} ダメージ`,
      });

      s.hand = s.hand.filter((t) => !tiles.includes(t));
      s.melds = s.melds.filter((_, i) => !meldIdx.includes(i));
      s.chain++;
      s.drawn = [];

      if (s.monster.hp <= 0) {
        s.status = 'won';
        s.log.push({ side: 'system', text: `${s.monster.def.name}を倒した！` });
      } else {
        // 捨てた枚数だけ補充（副露した暗槓は宣言時に1枚もらっているので3枚）
        drawN(s, rng, tiles.length + melds.length * 3);
      }
      s.rng = rng.state;
      return { state: s, attack: { ...ev, damage } };
    }
  }

  s.rng = rng.state;
  return { state: s };
}

/** 種類ごとの残り牌の枚数 */
export function wallCounts(s: BattleState): number[] {
  const counts = new Array<number>(34).fill(0);
  for (const t of s.wall) counts[kindOf(t)]++;
  return counts;
}
