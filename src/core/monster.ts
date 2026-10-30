import { ENEMY_SKILLS, EnemySkillCategory, EnemySkillDef, EnemySkillId, MonsterDef } from '../data/monsters';
import { Rng } from './rng';

const BASIC_IDS: EnemySkillId[] = ['critical', 'seal_yaku', 'atk_down', 'charge', 'defend'];
const STRONG_IDS: EnemySkillId[] = ['slow', 'seal_tiles', 'heal', 'double_strike', 'seal_equip', 'reflect'];
const BOSS_IDS: EnemySkillId[] = ['half_hp', 'venom', 'triple_strike', 'break_hand_5', 'break_kan', 'break_all'];

/** 状態異常系スキルの発生頻度を抑えるための重み付け（非状態異常=2、状態異常=1） */
const STATUS_AILMENT_IDS: ReadonlySet<EnemySkillId> = new Set([
  'seal_yaku',
  'atk_down',
  'slow',
  'seal_tiles',
  'seal_equip',
  'venom',
]);

function pickWeightedSkill(pool: EnemySkillId[], rng: Rng): EnemySkillDef {
  const weights = pool.map((id) => (STATUS_AILMENT_IDS.has(id) ? 1 : 2));
  const idx = rng.weighted(weights);
  return ENEMY_SKILLS[pool[idx]];
}

/** モンスターの重み設定に従って行動スキルを1つ選ぶ（再帰的な連撃・神速の中で再び連撃・神速は選ばない） */
export function chooseMonsterSkill(def: MonsterDef, rng: Rng, allowMultiStrike = true): EnemySkillDef {
  if (def.idleChance && def.idleChance > 0 && rng.int(100) < def.idleChance) {
    return ENEMY_SKILLS.idle;
  }
  const catIdx = rng.weighted(def.weights);
  const categories: EnemySkillCategory[] = ['normal', 'basic', 'strong', 'boss'];
  const cat = categories[catIdx];

  if (cat === 'normal') return ENEMY_SKILLS.normal;
  if (cat === 'basic') {
    return pickWeightedSkill(BASIC_IDS, rng);
  }
  if (cat === 'strong') {
    const pool = allowMultiStrike ? STRONG_IDS : STRONG_IDS.filter((k) => k !== 'double_strike');
    return pickWeightedSkill(pool, rng);
  }
  const pool = allowMultiStrike ? BOSS_IDS : BOSS_IDS.filter((k) => k !== 'triple_strike');
  return pickWeightedSkill(pool, rng);
}

/** 基礎攻撃力から通常攻撃のダメージを算出（90%〜110%の乱数幅） */
export function rollMonsterDamage(atk: number, rng: Rng): number {
  const min = Math.max(1, Math.floor(atk * 0.9));
  const max = Math.max(min, Math.ceil(atk * 1.1));
  return rng.range(min, max);
}
