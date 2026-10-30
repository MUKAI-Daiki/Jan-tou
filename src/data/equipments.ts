import { Kind, Suit } from '../core/tile';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend';

export interface EquipmentDef {
  id: string;
  name: string;
  rarity: Rarity;
  desc: string;
  suit?: Suit;
  windKind?: Kind;
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'コモン',
  uncommon: 'アンコモン',
  rare: 'レア',
  legend: 'レジェンド',
};

/** スコア計算用の装備レア度別ポイント（レア度が高いほど高得点） */
export const RARITY_SCORE: Record<Rarity, number> = {
  common: 200,
  uncommon: 450,
  rare: 900,
  legend: 2000,
};

export const EQUIPMENTS: readonly EquipmentDef[] = [
  // ---- コモン ----
  { id: 'hp_up_10', name: '点棒の護符', rarity: 'common', desc: '最大HP+10%' },
  { id: 'atk_man_2', name: '萬子の砥石', rarity: 'common', desc: '萬子の基礎攻撃+5', suit: 'm' },
  { id: 'atk_pin_2', name: '筒子の砥石', rarity: 'common', desc: '筒子の基礎攻撃+5', suit: 'p' },
  { id: 'atk_sou_2', name: '索子の砥石', rarity: 'common', desc: '索子の基礎攻撃+5', suit: 's' },
  { id: 'atk_honor_2', name: '字牌の刻印', rarity: 'common', desc: '字牌の基礎攻撃+5' },
  { id: 'atk_term_2', name: '老頭の刻印', rarity: 'common', desc: '1・9牌の基礎攻撃+5' },
  { id: 'dmg_cut_10', name: '卓布の盾', rarity: 'common', desc: '被ダメージ-20%' },

  // ---- アンコモン ----
  {
    id: 'red_five_1',
    name: '赤五の宝珠',
    rarity: 'uncommon',
    desc: '5の牌が各1枚赤牌化（金効果＋同種攻撃+5［永続］＋25銭）',
  },
  { id: 'wind_east', name: '東風の紋章', rarity: 'uncommon', desc: '「東」3枚が役になりチェーン+2', windKind: 27 },
  { id: 'wind_south', name: '南風の紋章', rarity: 'uncommon', desc: '「南」3枚が役になりチェーン+2', windKind: 28 },
  { id: 'wind_west', name: '西風の紋章', rarity: 'uncommon', desc: '「西」3枚が役になりチェーン+2', windKind: 29 },
  { id: 'wind_north', name: '北風の紋章', rarity: 'uncommon', desc: '「北」3枚が役になりチェーン+2', windKind: 30 },
  {
    id: 'unlock_tanyao',
    name: '招財の算盤',
    rarity: 'uncommon',
    desc: '役成立ごとに1役につき+30銭',
  },
  {
    id: 'unlock_heal',
    name: '治癒の点棒',
    rarity: 'uncommon',
    desc: 'スキル「回復変換（攻撃ダメージをHP回復に変換）」解禁',
  },
  { id: 'regen_5', name: '再生の牌皿', rarity: 'uncommon', desc: '毎ターンHP5%回復' },
  { id: 'draw_gold_10', name: '金箔のサイコロ', rarity: 'uncommon', desc: '補充牌が10%で金牌化' },
  {
    id: 'skill_reset_wall',
    name: '山積み直し機',
    rarity: 'uncommon',
    desc: 'スキル「山リセット（全種の残り牌を4枚に戻す／CT8T）」解禁',
  },

  // ---- レア ----
  { id: 'hp_up_30', name: '黄金の点箱', rarity: 'rare', desc: '最大HP+30%' },
  { id: 'flat_atk_10', name: '剛力の指輪', rarity: 'rare', desc: '攻撃時、基礎攻撃+10' },
  { id: 'always_chain_1', name: '連撃の双牌', rarity: 'rare', desc: '毎ターン追加攻撃+1回' },
  {
    id: 'vamp_basic',
    name: '吸血の雀卓',
    rarity: 'rare',
    desc: '役なし・1セット役攻撃時、与ダメージ分HP回復',
  },
  { id: 'dragon_gold', name: '三元の金印', rarity: 'rare', desc: '白・發・中が常に金牌化' },
  {
    id: 'gold_to_rainbow_30',
    name: '虹光のプリズム',
    rarity: 'rare',
    desc: '金牌が30%で虹牌化（セット使用で威力2倍・チェーン+2）',
  },
  {
    id: 'revive_20',
    name: '不屈のリーチ棒',
    rarity: 'rare',
    desc: 'HP0時にHP20%で復活（1戦1回）',
  },
  {
    id: 'skill_copy',
    name: '鏡の牌（複製）',
    rarity: 'rare',
    desc: 'スキル「複製（手牌1枚を別手牌と同種に変化／CT5T）」解禁',
  },
  {
    id: 'skill_search',
    name: '千里眼（サーチ）',
    rarity: 'rare',
    desc: 'スキル「サーチ（手牌1枚を任意の残り牌に変化／CT5T）」解禁',
  },
  {
    id: 'banish_one_honor',
    name: '字牌封じの札',
    rarity: 'rare',
    desc: '獲得時、ランダムな字牌1種の残り牌を永続0にする',
  },

  // ---- レジェンド ----
  { id: 'hp_double', name: '不滅の王牌', rarity: 'legend', desc: '最大HP2倍' },
  {
    id: 'single_clone_draw',
    name: '共鳴する孤牌',
    rarity: 'legend',
    desc: '1枚攻撃時、手牌と同種の牌を補充',
  },
  {
    id: 'start_dragon_set',
    name: '三元神の加護',
    rarity: 'legend',
    desc: '初期手牌に白・發・中のいずれか1セットが確定出現',
  },
  { id: 'no_honor_wall', name: '数牌の結界', rarity: 'legend', desc: '字牌の残り牌が常に0' },
  { id: 'no_man_wall', name: '萬子封印の書', rarity: 'legend', desc: '萬子の残り牌が常に0', suit: 'm' },
  { id: 'no_pin_wall', name: '筒子封印の書', rarity: 'legend', desc: '筒子の残り牌が常に0', suit: 'p' },
  { id: 'no_sou_wall', name: '索子封印の書', rarity: 'legend', desc: '索子の残り牌が常に0', suit: 's' },
  { id: 'all_honor_gold', name: '黄金の字牌宮', rarity: 'legend', desc: '字牌がすべて金牌化' },
  {
    id: 'all_five_red',
    name: '真紅の五宝',
    rarity: 'legend',
    desc: '5の牌がすべて赤牌化（金効果＋同種攻撃+5［永続］＋25銭）',
  },
  { id: 'draw_rainbow_10', name: '極彩色の天牌', rarity: 'legend', desc: '補充牌が10%で虹牌化' },
];

export const getEquipment = (id: string): EquipmentDef =>
  EQUIPMENTS.find((e) => e.id === id) ?? EQUIPMENTS[0];

