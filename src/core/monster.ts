import { MonsterDef, MonsterSkill } from '../data/monsters';
import { Rng } from './rng';

export interface MonsterAction {
  skill: MonsterSkill;
  damage: number;
}

/** 5つの技から重み付きランダムで1つ選び、ダメージを決める */
export function chooseMonsterAction(def: MonsterDef, rng: Rng): MonsterAction {
  const i = rng.weighted(def.skills.map((s) => s.weight));
  const skill = def.skills[i];
  return { skill, damage: rng.range(skill.min, skill.max) };
}

