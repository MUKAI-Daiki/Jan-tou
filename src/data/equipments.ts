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
  { id: 'atk_man_2', name: '萬子の砥石', rarity: 'common', desc: '萬子すべての基礎攻撃力+5', suit: 'm' },
  { id: 'atk_pin_2', name: '筒子の砥石', rarity: 'common', desc: '筒子すべての基礎攻撃力+5', suit: 'p' },
  { id: 'atk_sou_2', name: '索子の砥石', rarity: 'common', desc: '索子すべての基礎攻撃力+5', suit: 's' },
  { id: 'atk_honor_2', name: '字牌の刻印', rarity: 'common', desc: '字牌の基礎攻撃力+5' },
  { id: 'atk_term_2', name: '老頭の刻印', rarity: 'common', desc: '1・9牌の基礎攻撃力+5' },
  { id: 'dmg_cut_10', name: '卓布の盾', rarity: 'common', desc: '相手のダメージを-20%' },

  // ---- アンコモン ----
  {
    id: 'red_five_1',
    name: '赤五の宝珠',
    rarity: 'uncommon',
    desc: '5の牌が各1つずつ赤牌になる（金牌効果＋攻撃使用で同種牌の基礎攻撃力+5［永続］＆25銭獲得）',
  },
  { id: 'wind_east', name: '東風の紋章', rarity: 'uncommon', desc: '「東」の同牌セットが役になり、チェーン+2', windKind: 27 },
  { id: 'wind_south', name: '南風の紋章', rarity: 'uncommon', desc: '「南」の同牌セットが役になり、チェーン+2', windKind: 28 },
  { id: 'wind_west', name: '西風の紋章', rarity: 'uncommon', desc: '「西」の同牌セットが役になり、チェーン+2', windKind: 29 },
  { id: 'wind_north', name: '北風の紋章', rarity: 'uncommon', desc: '「北」の同牌セットが役になり、チェーン+2', windKind: 30 },
  {
    id: 'unlock_tanyao',
    name: '招財の算盤',
    rarity: 'uncommon',
    desc: '攻撃で役が成立するたび、1役につき +30 銭を獲得する',
  },
  {
    id: 'unlock_heal',
    name: '治癒の点棒',
    rarity: 'uncommon',
    desc: '特殊行動「回復変換（次の攻撃ダメージを自分のHP回復に変換）」を解禁',
  },
  { id: 'regen_5', name: '再生の牌皿', rarity: 'uncommon', desc: '毎ターン、HPを5%回復する' },
  { id: 'draw_gold_10', name: '金箔のサイコロ', rarity: 'uncommon', desc: '補充牌が10%の確率で金牌になる' },
  {
    id: 'skill_reset_wall',
    name: '山積み直し機',
    rarity: 'uncommon',
    desc: '特殊行動「残り牌リセット（永続的に残り牌0の牌を除き、全種の残り牌を4枚にする、CT:8ターン）」を解禁',
  },

  // ---- レア ----
  { id: 'hp_up_30', name: '黄金の点箱', rarity: 'rare', desc: '最大HP+30%' },
  { id: 'flat_atk_10', name: '剛力の指輪', rarity: 'rare', desc: 'すべての攻撃時、基礎攻撃力に+10する' },
  { id: 'always_chain_1', name: '連撃の双牌', rarity: 'rare', desc: '常にチェーン+1（毎ターン追加攻撃+1回）' },
  {
    id: 'vamp_basic',
    name: '吸血の雀卓',
    rarity: 'rare',
    desc: '役なしおよび1セット役の攻撃時、与えたダメージと同じ量だけ自分を回復する',
  },
  { id: 'dragon_gold', name: '三元の金印', rarity: 'rare', desc: '三元牌（白・發・中）が常に金牌となる' },
  {
    id: 'gold_to_rainbow_30',
    name: '虹光のプリズム',
    rarity: 'rare',
    desc: '金牌が手牌に入る際、30%の確率で「虹牌（セットに含めると最終ダメージ2倍・チェーン+2）」になる',
  },
  {
    id: 'revive_20',
    name: '不屈のリーチ棒',
    rarity: 'rare',
    desc: '自分のHPが0になったとき、HPを20%回復して敗北を免れる（1バトル1回）',
  },
  {
    id: 'skill_copy',
    name: '鏡の牌（複製）',
    rarity: 'rare',
    desc: '特殊行動「複製（手牌の1つを別の手牌と同じ牌に変化させる、CT:5ターン）」を解禁',
  },
  {
    id: 'skill_search',
    name: '千里眼（サーチ）',
    rarity: 'rare',
    desc: '特殊行動「サーチ（手牌の1つを任意の残り牌に変化させる、CT:5ターン）」を解禁',
  },
  {
    id: 'banish_one_honor',
    name: '字牌封じの札',
    rarity: 'rare',
    desc: '獲得した瞬間、ランダムな字牌1種の残り牌数を永続的に0にする',
  },

  // ---- レジェンド ----
  { id: 'hp_double', name: '不滅の王牌', rarity: 'legend', desc: '最大HP2倍' },
  {
    id: 'single_clone_draw',
    name: '共鳴する孤牌',
    rarity: 'legend',
    desc: '1枚のみで攻撃した際、補充が手牌のどれかと同一になる',
  },
  {
    id: 'start_dragon_set',
    name: '三元神の加護',
    rarity: 'legend',
    desc: 'バトル開始時の初期手牌に、三元牌（白・發・中）のどれかのセットが必ず含まれる',
  },
  { id: 'no_honor_wall', name: '数牌の結界', rarity: 'legend', desc: '字牌の残り牌が常に0になる' },
  { id: 'no_man_wall', name: '萬子封印の書', rarity: 'legend', desc: '萬子の残り牌が常に0になる', suit: 'm' },
  { id: 'no_pin_wall', name: '筒子封印の書', rarity: 'legend', desc: '筒子の残り牌が常に0になる', suit: 'p' },
  { id: 'no_sou_wall', name: '索子封印の書', rarity: 'legend', desc: '索子の残り牌が常に0になる', suit: 's' },
  { id: 'all_honor_gold', name: '黄金の字牌宮', rarity: 'legend', desc: '字牌がすべて金牌になる' },
  {
    id: 'all_five_red',
    name: '真紅の五宝',
    rarity: 'legend',
    desc: '5の牌がすべて赤牌になる（金牌効果＋攻撃使用で同じ種類の牌の基礎攻撃力+5［永続］）',
  },
  { id: 'draw_rainbow_10', name: '極彩色の天牌', rarity: 'legend', desc: '補充牌が10%の確率で虹牌になる' },
];

export const getEquipment = (id: string): EquipmentDef =>
  EQUIPMENTS.find((e) => e.id === id) ?? EQUIPMENTS[0];

