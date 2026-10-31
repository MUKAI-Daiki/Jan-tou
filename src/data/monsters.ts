export type EnemySkillCategory = 'idle' | 'normal' | 'basic' | 'strong' | 'boss';

export type EnemySkillId =
  | 'idle'
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
  | 'break_all'
  // ボス固有の新特殊行動
  | 'titan_slam'
  | 'blizzard_breath'
  | 'hellfire_breath'
  | 'cataclysm';

export interface EnemySkillDef {
  id: EnemySkillId;
  name: string;
  category: EnemySkillCategory;
  desc: string;
}

export const ENEMY_SKILLS: Record<EnemySkillId, EnemySkillDef> = {
  idle: { id: 'idle', name: '様子見', category: 'idle', desc: '様子を見ている（ダメージなし）' },
  normal: { id: 'normal', name: '通常攻撃', category: 'normal', desc: '標準的な攻撃を行う' },
  // 基本技
  critical: { id: 'critical', name: 'クリティカル', category: 'basic', desc: 'ダメージ2倍の痛恨の一撃！' },
  seal_yaku: { id: 'seal_yaku', name: '封印', category: 'basic', desc: '1ターンの間、役の効果発動を無効化！' },
  atk_down: { id: 'atk_down', name: '攻撃力ダウン', category: 'basic', desc: '3ターンの間、プレイヤーの攻撃力合計-10！' },
  charge: { id: 'charge', name: 'ためる', category: 'basic', desc: '力を溜めた！次のターンのダメージが3倍に！' },
  defend: { id: 'defend', name: '防御', category: 'basic', desc: '2ターンの間、敵へのダメージが半減！' },
  // 強力な技
  slow: { id: 'slow', name: '鈍化', category: 'strong', desc: '2ターンの間、チェーンができなくなる！' },
  seal_tiles: { id: 'seal_tiles', name: '牌封印', category: 'strong', desc: '手牌のうち3枚が2ターンの間、攻撃に使えなくなる！' },
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
  // ボス固有の新特殊行動
  titan_slam: {
    id: 'titan_slam',
    name: '巨体で突き飛ばす',
    category: 'boss',
    desc: '2倍ダメージ＋ランダムで手牌2枚を強制交換！',
  },
  blizzard_breath: {
    id: 'blizzard_breath',
    name: '吹雪の息',
    category: 'boss',
    desc: '1.5倍ダメージ＋ランダムで手牌3枚を2ターン使用不能に！',
  },
  hellfire_breath: {
    id: 'hellfire_breath',
    name: '業火の息',
    category: 'boss',
    desc: '1.5倍ダメージ＋金牌等の強化牌をすべて通常牌に戻す！',
  },
  cataclysm: {
    id: 'cataclysm',
    name: '天災',
    category: 'boss',
    desc: '2.5倍ダメージ＋全手牌を強制交換！',
  },
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
  /** ボス技カテゴリ抽選時に優先使用する固有ボス技リスト */
  bossSkills?: readonly EnemySkillId[];
  /** 無駄行動（ダメージなし）を行う確率（%） */
  idleChance?: number;
  /** 撃破時の装備報酬をコモンのみに限定するか */
  commonOnlyReward?: boolean;
}

export const PLAYER_INITIAL_HP = 300;
export const MAX_STAGE = 10;

/** 10連戦のモンスター定義（敵攻撃力・HPを増強し、ボス級モンスターに固有の特殊行動を設定） */
export const MONSTERS: readonly MonsterDef[] = [
  {
    stage: 1,
    id: 'pawn',
    name: '見習い点棒くん',
    rank: '第1戦（入門）',
    hp: 90,
    atk: 18,
    weights: [100, 0, 0, 0],
    idleChance: 15,
    commonOnlyReward: true,
  },
  {
    stage: 2,
    id: 'dice',
    name: 'まどろみサイコロ',
    rank: '第2戦（入門）',
    hp: 160,
    atk: 26,
    weights: [100, 0, 0, 0],
    idleChance: 15,
    commonOnlyReward: true,
  },
  { stage: 3, id: 'slime', name: '牌スライム', rank: '第3戦', hp: 280, atk: 38, weights: [70, 30, 0, 0] },
  { stage: 4, id: 'bat', name: 'ピンズバット', rank: '第4戦', hp: 460, atk: 50, weights: [60, 32, 8, 0] },
  { stage: 5, id: 'goblin', name: '雀ゴブリン', rank: '第5戦', hp: 750, atk: 65, weights: [50, 35, 15, 0] },
  {
    stage: 6,
    id: 'golem',
    name: '点棒ゴーレム',
    rank: '第6戦（中ボス）',
    hp: 1250,
    atk: 85,
    weights: [35, 30, 15, 20],
    bossSkills: ['titan_slam'],
  },
  {
    stage: 7,
    id: 'knight',
    name: '風牌の騎士',
    rank: '第7戦',
    hp: 1850,
    atk: 105,
    weights: [35, 28, 25, 12],
    bossSkills: ['titan_slam', 'blizzard_breath'],
  },
  {
    stage: 8,
    id: 'chimera',
    name: '三色キマイラ',
    rank: '第8戦（強敵）',
    hp: 2700,
    atk: 130,
    weights: [28, 25, 25, 22],
    bossSkills: ['blizzard_breath', 'hellfire_breath'],
  },
  {
    stage: 9,
    id: 'demon',
    name: '暗槓デーモン',
    rank: '第9戦（準ボス）',
    hp: 3900,
    atk: 160,
    weights: [24, 22, 26, 28],
    bossSkills: ['titan_slam', 'blizzard_breath', 'hellfire_breath', 'venom', 'break_kan'],
  },
  {
    stage: 10,
    id: 'dragon',
    name: '覇王・三元龍',
    rank: '最終戦（大ボス）',
    hp: 6000,
    atk: 200,
    weights: [18, 20, 27, 35],
    bossSkills: ['cataclysm', 'blizzard_breath', 'hellfire_breath', 'titan_slam', 'triple_strike'],
  },
];
