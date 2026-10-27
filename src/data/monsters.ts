export interface MonsterSkill {
  name: string;
  min: number;
  max: number;
  weight: number;
  /** ログに出す台詞 */
  text: string;
}

export interface MonsterDef {
  id: string;
  name: string;
  rank: string;
  hp: number;
  /** 技は5種 */
  skills: [MonsterSkill, MonsterSkill, MonsterSkill, MonsterSkill, MonsterSkill];
}

export const PLAYER_MAX_HP = 25000;

export const MONSTERS: MonsterDef[] = [
  {
    id: 'slime',
    name: '牌スライム',
    rank: '雑魚',
    hp: 8000,
    skills: [
      { name: 'たいあたり', min: 200, max: 400, weight: 40, text: 'ぷにっと体当たりしてきた' },
      { name: 'のしかかり', min: 400, max: 700, weight: 25, text: 'のしかかってきた' },
      { name: 'ぷるぷる', min: 0, max: 0, weight: 15, text: 'ぷるぷる震えている' },
      { name: '酸の雫', min: 300, max: 600, weight: 15, text: '酸の雫を飛ばしてきた' },
      { name: '大ぷるぷる', min: 900, max: 1300, weight: 5, text: '全身で弾けた！' },
    ],
  },
  {
    id: 'golem',
    name: '点棒ゴーレム',
    rank: '中ボス',
    hp: 50000,
    skills: [
      { name: '千点棒パンチ', min: 800, max: 1200, weight: 35, text: '千点棒で殴りかかってきた' },
      { name: '百点棒の雨', min: 300, max: 900, weight: 25, text: '百点棒を降らせてきた' },
      { name: '供託', min: 1000, max: 1000, weight: 15, text: 'リーチ棒を奪っていった' },
      { name: '岩石落とし', min: 1500, max: 2200, weight: 15, text: '岩を落としてきた' },
      { name: '万点棒スマッシュ', min: 2800, max: 3600, weight: 10, text: '万点棒を振り下ろした！' },
    ],
  },
  {
    id: 'dragon',
    name: '三元龍',
    rank: 'ボス',
    hp: 300000,
    skills: [
      { name: '白の息吹', min: 1000, max: 1600, weight: 30, text: '真っ白な息を吐いた' },
      { name: '發の爪', min: 1400, max: 2000, weight: 25, text: '緑の爪で切り裂いた' },
      { name: '中の炎', min: 1800, max: 2600, weight: 20, text: '紅蓮の炎を吐いた' },
      { name: '睨みつけ', min: 0, max: 300, weight: 15, text: 'こちらを睨みつけている' },
      { name: '大三元', min: 4000, max: 6000, weight: 10, text: '三元の力を解き放った！' },
    ],
  },
];

