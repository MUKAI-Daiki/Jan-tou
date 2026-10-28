export type EnemySkillCategory = 'normal' | 'basic' | 'strong' | 'boss';

export type EnemySkillId =
  | 'normal'
  // 基本技
  | 'critical'
  | 'seal_yaku'
  | 'atk_down'
  | 'charge'
  | 'defend'
  // 強力な技
  | 'slow'
  | 'seal_tiles'
  | 'heal'
  | 'double_strike'
  | 'seal_equip'
  | 'reflect'
  // ボス技
  | 'half_hp'
  | 'venom'
  | 'triple_strike'
  | 'break_hand_5'
  | 'break_kan'
  | 'break_all';

export interface EnemySkillDef {
  id: EnemySkillId;
  name: string;
  category: EnemySkillCategory;
  desc: string;
}

export const ENEMY_SKILLS: Record<EnemySkillId, EnemySkillDef> = {
  normal: { id: 'normal', name: '通常攻撃', category: 'normal', desc: '標準的な攻撃を行う' },
  // 基本技
  critical: { id: 'critical', name: 'クリティカル', category: 'basic', desc: 'ダメージ2倍の痛恨の一撃！' },
  seal_yaku: { id: 'seal_yaku', name: '封印', category: 'basic', desc: '1ターンの間、役の効果発動を無効化！' },
  atk_down: { id: 'atk_down', name: '攻撃力ダウン', category: 'basic', desc: '3ターンの間、プレイヤーの攻撃力合計-10！' },
  charge: { id: 'charge', name: 'ためる', category: 'basic', desc: '力を溜めた！次のターンのダメージが3倍に！' },
  defend: { id: 'defend', name: '防御', category: 'basic', desc: '2ターンの間、敵へのダメージが半減！' },
  // 強力な技
  slow: { id: 'slow', name: '鈍化', category: 'strong', desc: '2ターンの間、チェーンができなくなる！' },
  seal_tiles: { id: 'seal_tiles', name: '牌封印', category: 'strong', desc: '手牌のうち3枚が3ターンの間、攻撃に使えなくなる！' },
  heal: { id: 'heal', name: '回復', category: 'strong', desc: '最大HPの30%を回復した！' },
  double_strike: { id: 'double_strike', name: '連撃', category: 'strong', desc: '素早い動きで2回連続行動！' },
  seal_equip: { id: 'seal_equip', name: '装備封印', category: 'strong', desc: 'プレイヤーの装備を1つランダムに無効化！' },
  reflect: { id: 'reflect', name: '反射', category: 'strong', desc: '2ターンの間、受けたダメージの半分を跳ね返す！' },
  // ボス技
  half_hp: { id: 'half_hp', name: '割合ダメージ', category: 'boss', desc: 'プレイヤーの現在HPを半分に削り取った！' },
  venom: { id: 'venom', name: '猛毒', category: 'boss', desc: '5ターンの間、攻撃力合計-20＋攻撃後にHP-10%！' },
  triple_strike: { id: 'triple_strike', name: '神速', category: 'boss', desc: '目にもとまらぬ速さで3回連続行動！' },
  break_hand_5: { id: 'break_hand_5', name: '手牌破壊', category: 'boss', desc: '手牌をランダムに5枚破壊し、素の残り牌5枚と入れ替えた！' },
  break_kan: { id: 'break_kan', name: 'カン破壊', category: 'boss', desc: 'キープされたカンを破壊し、素の残り牌3枚に分解した！' },
  break_all: { id: 'break_all', name: '全破壊', category: 'boss', desc: '手牌すべてを破壊し、素の残り牌8枚を補充させた！' },
};

export interface MonsterDef {
  stage: number;
  id: string;
  name: string;
  rank: string;
  hp: number;
  atk: number;
  /** カテゴリ別の重み [normal, basic, strong, boss] */
  weights: [number, number, number, number];
}

export const PLAYER_INITIAL_HP = 300;
export const EXP_PER_LEVEL = 500;
export const MAX_STAGE = 8;

/** 8連戦のモンスター定義（後半ほどHP・攻撃力・特殊行動の比率が上昇） */
export const MONSTERS: readonly MonsterDef[] = [
  { stage: 1, id: 'slime', name: '牌スライム', rank: '第1戦', hp: 220, atk: 24, weights: [70, 30, 0, 0] },
  { stage: 2, id: 'bat', name: 'ピンズバット', rank: '第2戦', hp: 380, atk: 32, weights: [55, 40, 5, 0] },
  { stage: 3, id: 'goblin', name: '雀ゴブリン', rank: '第3戦', hp: 600, atk: 42, weights: [45, 40, 15, 0] },
  { stage: 4, id: 'golem', name: '点棒ゴーレム', rank: '第4戦（中ボス）', hp: 950, atk: 54, weights: [35, 35, 25, 5] },
  { stage: 5, id: 'knight', name: '風牌の騎士', rank: '第5戦', hp: 1400, atk: 68, weights: [30, 35, 30, 5] },
  { stage: 6, id: 'chimera', name: '三色キマイラ', rank: '第6戦', hp: 2000, atk: 84, weights: [25, 30, 35, 10] },
  { stage: 7, id: 'demon', name: '暗槓デーモン', rank: '第7戦（準ボス）', hp: 2900, atk: 105, weights: [20, 25, 35, 20] },
  { stage: 8, id: 'dragon', name: '覇王・三元龍', rank: '最終戦（大ボス）', hp: 4500, atk: 130, weights: [15, 25, 35, 25] },
];
