import { Kind, Suit } from '../core/tile';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'legend';

export interface EquipmentDef {
  id: string;
  name: string;
  icon: string;
  kanji: string;
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
export const RARITY_SCORE: Record<Rarity, string extends never ? never : number> = {
  common: 200,
  uncommon: 450,
  rare: 900,
  legend: 2000,
};

/** 商店での装備購入価格 */
export function getEquipmentBuyPrice(rarity: Rarity): number {
  switch (rarity) {
    case 'common':
    case 'uncommon':
      return 500;
    case 'rare':
      return 2000;
    case 'legend':
      return 5000;
  }
}

/** 商店での装備売却価格（買値の半分） */
export function getEquipmentSellPrice(rarity: Rarity): number {
  return Math.floor(getEquipmentBuyPrice(rarity) / 2);
}

export type JobId = 'sword' | 'doctor' | 'ninja' | 'master' | 'nekomanto' | 'yukako';

export interface JobSection {
  heading: string;
  items: readonly string[];
}

export interface JobDef {
  id: JobId;
  name: string;
  icon: string;
  catchphrase: string;
  shortDesc: string;
  detailDesc: string;
  sections: readonly JobSection[];
}

export const JOBS: readonly JobDef[] = [
  {
    id: 'sword',
    name: '雀剣士',
    icon: '⚔️',
    catchphrase: '同じ牌を3枚揃えて斬り伏せる、明快・豪快な剣士',
    shortDesc: '同牌30%引き寄せ＆全同牌系役で威力UP・金/赤牌補充',
    detailDesc:
      '補充時30%で手牌と同種の牌を優先補充。役なし同牌セットで威力2倍＆ペア補充、同牌・カン系役でも威力1.5〜2.5倍＆ペア＋金/赤牌を補充',
    sections: [
      {
        heading: '🧲 パッシブ：同牌引き寄せ（30%）',
        items: [
          '牌を補充するたび 30% の確率で、現在手牌にある牌と同じ種類の牌を山から優先して引き寄せる',
          'まだ1〜2枚しかない牌を優先するため、ペアや同牌セット（3枚組）が自然に揃いやすい',
        ],
      },
      {
        heading: '⚔️ 役なし同牌セット効果',
        items: [
          '⚔️ ダメージ ×2.0',
          '🀄 補充時にペア（2枚組）を1組引き込む',
        ],
      },
      {
        heading: '🔥 同牌・カン系役の独自効果「剛剣演武」',
        items: [
          '同牌セット（刻子・槓子）を含むすべての役で、同牌セット数に応じた倍率ボーナス（1組: ×1.5 ／ 2組: ×2.0 ／ 3組: ×2.5）',
          '🀄 補充時にペア（2枚組）を1組引き込む',
          '🟨🟥 同牌セット数に応じて補充牌を金・赤牌へ昇格（1組: 金1 ／ 2組: 赤1+金1 ／ 3組: 赤1+金2）',
        ],
      },
    ],
  },
  {
    id: 'doctor',
    name: '麻雀医',
    icon: '🩺',
    catchphrase: '順子（並び）と三色属性魔術・数牌調合を操る魔道医',
    shortDesc: '並び属性魔術（炎・氷・翠）＆専用スキル「数牌調合」',
    detailDesc:
      '役なし並びセットでHP10%回復＆2連補充。並び系役で色別の属性魔術（萬=炎の追撃＆赤牌、筒=敵バフ解除＆弱体、索=浄化＆障壁）が発動。スキル「数牌調合（数字±1変化）」を初期所持',
    sections: [
      {
        heading: '💊 役なし並びセット効果',
        items: [
          '❤️ 最大HPの 10% を即時回復（並びセット数に応じて増加）',
          '🀄 補充時に 2枚並び（連番ペア）を引き込む',
        ],
      },
      {
        heading: '✨ 並び系役の独自効果「三色属性魔術」',
        items: [
          '🔥 萬子順子（炎の魔術）：ダメージ ×1.25 ＆ 補充牌1枚を「赤牌」に昇格',
          '❄️ 筒子順子（氷の魔術）：敵の防御・反射・溜めを即時解除 ＆ 2ターン「弱体（敵攻撃力-30%）」付与',
          '🌿 索子順子（翠の魔術）：全デバフ・牌封印を 2ターン浄化 ＆ 最大HP 15% 分の「ガード障壁」を展開',
          '※ 二色同順や平和などで複数色の順子を含めば、対応する属性魔術がすべて同時発動！',
        ],
      },
      {
        heading: '🧪 固有スキル「数牌調合」（CT: 3ターン）',
        items: [
          '装備なしで最初から使用可能',
          '手牌の数牌1枚を、順子や2枚並びが成立しやすい隣の数字（±1）に変化させ、さらに「金牌」にする',
        ],
      },
    ],
  },
  {
    id: 'ninja',
    name: '忍びの雀士',
    icon: '🥷',
    catchphrase: '字牌の一撃必殺と毒・足止めで敵を翻弄する暗殺者',
    shortDesc: '字牌30%引き寄せ・全風牌解禁・字牌一撃4倍＆毒・足止め',
    detailDesc:
      '補充時30%で字牌を優先補充し、全風牌役が初期解禁。字牌の基礎攻撃力2倍＆字牌セット攻撃は一撃威力4倍！字牌役で敵に「毒」、風牌役で「足止め（行動封じ）」を付与',
    sections: [
      {
        heading: '🧲 パッシブ：字牌引き寄せ（30%）＆ 風牌初期解禁',
        items: [
          '牌を補充するたび 30% の確率で山から字牌（手牌にある字牌を優先）を引き寄せる',
          '装備なしで最初から「東・南・西・北セット」の4風牌役がすべて解禁済み',
        ],
      },
      {
        heading: '💥 一撃必殺の字牌パワー',
        items: [
          '⚔️ 字牌の基礎攻撃力が 2倍（10 → 20）',
          '💥 字牌セット（3枚組・カン）を含むすべての攻撃は最終ダメージ ×4.0（チェーン追加なしの一撃必殺型）',
        ],
      },
      {
        heading: '☠️ 字牌絡み役のからめ手「毒霧・影縫い」',
        items: [
          '☠️ 毒（字牌を含む役すべて）：敵に3ターン「毒」を付与し、毎ターン敵行動前に敵最大HPの 10% ダメージ',
          '⚡ 足止め（風牌セットを含む役）：敵の次ターンの行動を 1ターン完全にスキップ（連続付与時は耐性により弱体2ターンを付与）',
        ],
      },
    ],
  },
  {
    id: 'master',
    name: '雀老師',
    icon: '🧙',
    catchphrase: 'リーチ麻雀の爆発力と安定感を極めた達人',
    shortDesc: 'リーチ待ち牌30%引き寄せ・リーチ威力3倍＆裏ドラ・30%妨害無効',
    detailDesc:
      'リーチ中は入替4回・被ダメ半減・30%で当たり牌引き寄せ・30%で強制交換＆封印を無効化。リーチ役成立時はリーチ威力3倍＆手牌3枚が金/赤/虹化する「裏ドラ」が発動',
    sections: [
      {
        heading: '🛡️ リーチ中の圧倒的な安定感',
        items: [
          '🔄 リーチ中の自動ツモ切り回数が毎ターン最大 4枚 に増加（通常3枚）',
          '🛡️ リーチ中は敵から受けるすべてのダメージが 半減（-50%）',
          '✨ リーチ中は敵の「牌封印」や「手牌強制交換（巨体・吹雪・天災など）」を 30% の確率で完全無効化',
        ],
      },
      {
        heading: '🧲 リーチ待ち牌引き寄せ（30%）',
        items: [
          'リーチ中の自摸で 30% の確率で、山に残っている「当たり牌（3セット完成牌）」を直接引き寄せる',
        ],
      },
      {
        heading: '🀄 リーチ完成時の爆発力「裏ドラ開眼」',
        items: [
          '💥 「リーチ」役のダメージ倍率が ×3.0 に強化（通常 ×2.5）',
          '🌈 リーチ3セット完成時、手牌のうち最大3枚が「虹・赤・金牌（裏ドラ）」に自動昇格し、平和などの複合役と合わせて超火力を叩き出す',
        ],
      },
    ],
  },
  {
    id: 'nekomanto',
    name: 'ねこまんと',
    icon: '🐾',
    catchphrase: 'ペアを束ねて高速連撃を叩き込む拳士',
    shortDesc: '独自役「ねこぱんち」＆四対子強化',
    detailDesc: 'ペアを含むと役「ねこぱんち（ペア数×1.5倍威力＆ペア数チェーン）」成立。四対子の効果も強化',
    sections: [
      {
        heading: '🐾 固有役「ねこぱんち」',
        items: [
          '攻撃牌にペア（2枚組）が1組以上含まれると、独自役「ねこぱんち」が成立',
          '⚔️ ペア数 ×1.5倍 のダメージ倍率 ＆ ⛓️ ペア数分のチェーンを獲得',
          '🌟 成立するたび、使用したペアの牌種の基礎攻撃力 +1（永続）',
        ],
      },
      {
        heading: '⚡ 四対子との超シナジー',
        items: [
          'ペア4組（8枚）を揃えると「四対子」と「ねこぱんち（4ペア）」が複合し、合計8チェーンもの超連続攻撃が可能',
        ],
      },
    ],
  },
  {
    id: 'yukako',
    name: 'ゆかこ',
    icon: '🎀',
    catchphrase: 'セットさえ作れば毎回高火力を放つ天才少女',
    shortDesc: '独自役「つよつよこうげき（威力3.5倍）」',
    detailDesc: 'セットが1つ以上あり他の役がないとき、独自役「つよつよこうげき（最終ダメージ3.5倍）」が成立',
    sections: [
      {
        heading: '🎀 固有役「つよつよこうげき」',
        items: [
          '並びセット（順子）や同牌セット（刻子）が1つ以上あり、他の役が成立していないときに必ず発動',
          '💥 ダメージ ×3.5 ＆ ⛓️ チェーン +1 ＆ 💰 +100銭',
          '🌟 成立するたび、使用した牌種の基礎攻撃力 +2 ＆ 最大HP +10（永続）',
        ],
      },
      {
        heading: '💡 立ち回りの特徴',
        items: [
          '難しい役を狙わなくても、適当な3枚セットを作るだけで常に「3.5倍＋チェーン1＋永続強化」が保証される圧倒的な手軽さ',
        ],
      },
    ],
  },
];

export const getJobDef = (id: JobId): JobDef =>
  JOBS.find((j) => j.id === id) ?? JOBS[0];

export const EQUIPMENTS: readonly EquipmentDef[] = [
  // ---- コモン ----
  { id: 'hp_up_10', name: '点棒の護符', icon: '❤️', kanji: '護', rarity: 'common', desc: '最大HP+10%' },
  { id: 'atk_man_2', name: '萬子の砥石', icon: '🗡️', kanji: '萬', rarity: 'common', desc: '萬子の基礎攻撃+5', suit: 'm' },
  { id: 'atk_pin_2', name: '筒子の砥石', icon: '🗡️', kanji: '筒', rarity: 'common', desc: '筒子の基礎攻撃+5', suit: 'p' },
  { id: 'atk_sou_2', name: '索子の砥石', icon: '🗡️', kanji: '索', rarity: 'common', desc: '索子の基礎攻撃+5', suit: 's' },
  { id: 'atk_honor_2', name: '字牌の刻印', icon: '🗡️', kanji: '字', rarity: 'common', desc: '字牌の基礎攻撃+5' },
  { id: 'atk_term_2', name: '老頭の刻印', icon: '🗡️', kanji: '老', rarity: 'common', desc: '1・9牌の基礎攻撃+5' },
  { id: 'dmg_cut_10', name: '卓布の盾', icon: '🛡️', kanji: '盾', rarity: 'common', desc: '被ダメージ-20%' },
  { id: 'wind_east', name: '東風の紋章', icon: '🌪️', kanji: '東', rarity: 'common', desc: '「東」3枚が役になり威力2倍・チェーン+2', windKind: 27 },
  { id: 'wind_south', name: '南風の紋章', icon: '🌪️', kanji: '南', rarity: 'common', desc: '「南」3枚が役になり威力2倍・チェーン+2', windKind: 28 },
  { id: 'wind_west', name: '西風の紋章', icon: '🌪️', kanji: '西', rarity: 'common', desc: '「西」3枚が役になり威力2倍・チェーン+2', windKind: 29 },
  { id: 'wind_north', name: '北風の紋章', icon: '🌪️', kanji: '北', rarity: 'common', desc: '「北」3枚が役になり威力2倍・チェーン+2', windKind: 30 },

  // ---- アンコモン ----
  {
    id: 'red_five_1',
    name: '赤五の宝珠',
    icon: '🟥',
    kanji: '五',
    rarity: 'uncommon',
    desc: '5の牌が各1枚赤牌化（セット使用で威力+50%・同種攻撃+5［永続］・+50銭）',
  },
  {
    id: 'unlock_tanyao',
    name: '招財の算盤',
    icon: '🧮',
    kanji: '算',
    rarity: 'uncommon',
    desc: '役成立ごとに1役につき+60銭',
  },
  {
    id: 'unlock_heal',
    name: '治癒の点棒',
    icon: '💚',
    kanji: '癒',
    rarity: 'uncommon',
    desc: 'スキル「回復変換（攻撃ダメージをHP回復に変換）」解禁',
  },
  { id: 'regen_5', name: '再生の牌皿', icon: '🌿', kanji: '皿', rarity: 'uncommon', desc: '毎ターンHP5%回復' },
  { id: 'draw_gold_10', name: '金箔のサイコロ', icon: '🎲', kanji: '金', rarity: 'uncommon', desc: '補充牌が10%で金牌化' },
  {
    id: 'skill_reset_wall',
    name: '山積み直し機',
    icon: '🔄',
    kanji: '山',
    rarity: 'uncommon',
    desc: 'スキル「山リセット（全種の残り牌を4枚に戻す／CT8T）」解禁',
  },

  // ---- レア ----
  { id: 'hp_up_30', name: '黄金の点箱', icon: '❤️', kanji: '箱', rarity: 'rare', desc: '最大HP+30%' },
  { id: 'banner_heal_20', name: '癒しの戦旗', icon: '🚩', kanji: '旗', rarity: 'rare', desc: '役成立時、HPを20%回復' },
  { id: 'flat_atk_10', name: '剛力の指輪', icon: '💍', kanji: '剛', rarity: 'rare', desc: '攻撃時、基礎攻撃+10' },
  { id: 'always_chain_1', name: '連撃の双牌', icon: '⛓️', kanji: '連', rarity: 'rare', desc: '毎ターン追加攻撃+1回' },
  {
    id: 'vamp_basic',
    name: '吸血の雀卓',
    icon: '🦇',
    kanji: '吸',
    rarity: 'rare',
    desc: '役なし・1セット役攻撃時、与ダメージ分HP回復',
  },
  { id: 'dragon_gold', name: '三元の金印', icon: '🟨', kanji: '三', rarity: 'rare', desc: '白・發・中が常に金牌化' },
  {
    id: 'gold_to_rainbow_30',
    name: '虹光のプリズム',
    icon: '🌈',
    kanji: '虹',
    rarity: 'rare',
    desc: '金牌が30%で虹牌化（セット使用で威力2倍・チェーン+2）',
  },
  {
    id: 'revive_20',
    name: '不屈のリーチ棒',
    icon: '🔥',
    kanji: '蘇',
    rarity: 'rare',
    desc: 'HP0時にHP20%で復活（1戦1回）',
  },
  {
    id: 'skill_copy',
    name: '鏡の牌（複製）',
    icon: '🪞',
    kanji: '鏡',
    rarity: 'rare',
    desc: 'スキル「複製（手牌1枚を別手牌と同種に変化／CT5T）」解禁',
  },
  {
    id: 'skill_search',
    name: '千里眼（サーチ）',
    icon: '👁️',
    kanji: '眼',
    rarity: 'rare',
    desc: 'スキル「サーチ（手牌1枚を任意の残り牌に変化／CT5T）」解禁',
  },
  {
    id: 'banish_one_honor',
    name: '字牌封じの札',
    icon: '🚫',
    kanji: '封',
    rarity: 'rare',
    desc: '獲得時、ランダムな字牌1種の残り牌を永続0にする',
  },

  // ---- レジェンド ----
  { id: 'hp_double', name: '不滅の王牌', icon: '👑', kanji: '王', rarity: 'legend', desc: '最大HP2倍' },
  {
    id: 'single_clone_draw',
    name: '共鳴する孤牌',
    icon: '🔔',
    kanji: '共',
    rarity: 'legend',
    desc: '1枚攻撃時、手牌と同種の牌を補充',
  },
  {
    id: 'start_dragon_set',
    name: '三元神の加護',
    icon: '🐉',
    kanji: '神',
    rarity: 'legend',
    desc: '初期手牌に白・發・中のいずれか1セットが確定出現',
  },
  { id: 'no_honor_wall', name: '数牌の結界', icon: '⛩️', kanji: '数', rarity: 'legend', desc: '字牌の残り牌が常に0' },
  { id: 'no_man_wall', name: '萬子封印の書', icon: '📕', kanji: '絶', rarity: 'legend', desc: '萬子の残り牌が常に0', suit: 'm' },
  { id: 'no_pin_wall', name: '筒子封印の書', icon: '📘', kanji: '絶', rarity: 'legend', desc: '筒子の残り牌が常に0', suit: 'p' },
  { id: 'no_sou_wall', name: '索子封印の書', icon: '📗', kanji: '絶', rarity: 'legend', desc: '索子の残り牌が常に0', suit: 's' },
  { id: 'all_honor_gold', name: '黄金の字牌宮', icon: '🏯', kanji: '宮', rarity: 'legend', desc: '字牌がすべて金牌化' },
  {
    id: 'all_five_red',
    name: '真紅の五宝',
    icon: '💎',
    kanji: '紅',
    rarity: 'legend',
    desc: '5の牌がすべて赤牌化（セット使用で威力+50%・同種攻撃+5［永続］・+50銭）',
  },
  { id: 'draw_rainbow_10', name: '極彩色の天牌', icon: '🌌', kanji: '天', rarity: 'legend', desc: '補充牌が10%で虹牌化' },
];

export const getEquipment = (id: string): EquipmentDef =>
  EQUIPMENTS.find((e) => e.id === id) ?? EQUIPMENTS[0];
