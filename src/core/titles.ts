import { BattleState, ScoreBreakdown, calculateScore } from './battle';
import { TileGroup } from './tile';
import { YAKUMAN_IDS, YakuId } from './yaku';
import { JobId, getEquipment } from '../data/equipments';
import { DifficultyId } from '../data/monsters';

export interface TitleEvalResult {
  titleName: string;
  reason: string;
  tier: 'S' | 'A' | 'B' | 'C';
}

const JOB_SUFFIX: Record<JobId, string> = {
  sword: '剣聖',
  doctor: '仙医',
  ninja: '影頭領',
  master: '大老師',
  nekomanto: '大怪盗',
  yukako: '女帝',
};

/**
 * ゲームクリア時（または終了時）の BattleState から「強者共」に付与する称号を判定する
 */
export function evaluateVeteranTitle(
  state: BattleState,
  breakdown?: ScoreBreakdown,
): TitleEvalResult {
  const sc = breakdown ?? calculateScore(state);
  const suffix = JOB_SUFFIX[state.job] ?? '雀士';
  const yakuHistory = state.yakuHistory ?? [];

  // 成立した役のカウント集計
  const yakuCounts: Partial<Record<YakuId, number>> = {};
  let yakumanCount = 0;
  for (const y of yakuHistory) {
    yakuCounts[y.id] = (yakuCounts[y.id] ?? 0) + 1;
    if (YAKUMAN_IDS.has(y.id)) {
      yakumanCount++;
    }
  }

  // 1. Sランク：役満達成
  if (yakumanCount >= 2) {
    return {
      titleName: `天衣無縫の${suffix}`,
      reason: `役満を計${yakumanCount}回達成して制覇`,
      tier: 'S',
    };
  }
  if ((yakuCounts.daisangen ?? 0) >= 1) {
    return {
      titleName: `三元天覇の${suffix}`,
      reason: '役満「大三元」を達成して制覇',
      tier: 'S',
    };
  }
  if ((yakuCounts.tsuuiisou ?? 0) >= 1) {
    return {
      titleName: `字牌統べし${suffix}`,
      reason: '役満「字一色」を達成して制覇',
      tier: 'S',
    };
  }
  if ((yakuCounts.ryuuiisou ?? 0) >= 1) {
    return {
      titleName: `翠緑神域の${suffix}`,
      reason: '役満「緑一色」を達成して制覇',
      tier: 'S',
    };
  }
  if ((yakuCounts.sankantsu ?? 0) >= 1) {
    return {
      titleName: `三槓覇道の${suffix}`,
      reason: '役満「三槓子」を達成して制覇',
      tier: 'S',
    };
  }

  // 装備レア度集計
  let legendCount = 0;
  for (const eqId of state.equipments) {
    const eq = getEquipment(eqId);
    if (eq.rarity === 'legend') legendCount++;
  }

  // 2. Aランク：鉄壁・極限火力・伝説武装
  const hpRatio = state.player.hp / Math.max(1, state.player.maxHp);
  if (state.difficulty === 'advanced' && hpRatio >= 0.9 && state.revivedThisBattle === 0) {
    return {
      titleName: `無傷無敗の${suffix}`,
      reason: '上級編を残りHP90%以上で制覇',
      tier: 'A',
    };
  }
  if (state.player.maxHp >= 800) {
    return {
      titleName: `金剛不壊の${suffix}`,
      reason: `最大HP ${state.player.maxHp} の圧倒的耐久力で制覇`,
      tier: 'A',
    };
  }
  if (sc.permAtkTotal >= 45) {
    return {
      titleName: `一騎当千の${suffix}`,
      reason: `永続攻撃強化 合計+${sc.permAtkTotal} で制覇`,
      tier: 'A',
    };
  }
  if (legendCount >= 3) {
    return {
      titleName: `神具を纏いし${suffix}`,
      reason: `レジェンド装備を${legendCount}個所持して制覇`,
      tier: 'A',
    };
  }

  // 特定牌種の特化強化判定 (+20以上)
  const groups: TileGroup[] = ['m', 'p', 's', 'wind', 'dragon'];
  let bestGroup: TileGroup = 'm';
  let bestGroupVal = 0;
  for (const g of groups) {
    const v = state.bonusTileAtk?.[g] ?? 0;
    if (v > bestGroupVal) {
      bestGroupVal = v;
      bestGroup = g;
    }
  }
  if (bestGroupVal >= 20) {
    const groupPrefix: Record<TileGroup, string> = {
      m: '紅蓮萬子の',
      p: '氷華筒子の',
      s: '疾風索子の',
      wind: '四風掌握の',
      dragon: '三元覚醒の',
    };
    return {
      titleName: `${groupPrefix[bestGroup]}${suffix}`,
      reason: `特定牌種の攻撃力を+${bestGroupVal}まで鍛え上げて制覇`,
      tier: 'A',
    };
  }

  if (sc.permAtkTotal >= 30) {
    return {
      titleName: `剛腕無双の${suffix}`,
      reason: `永続攻撃強化 合計+${sc.permAtkTotal} で制覇`,
      tier: 'A',
    };
  }
  if (state.equipments.length >= 8) {
    return {
      titleName: `百武装の${suffix}`,
      reason: `装備を${state.equipments.length}個揃え上げて制覇`,
      tier: 'A',
    };
  }

  // 3. Bランク：大富豪・連撃・特定戦術
  if (state.money >= 5000) {
    return {
      titleName: `黄金に愛されし${suffix}`,
      reason: `所持金 ${state.money.toLocaleString()} 銭を蓄えて制覇`,
      tier: 'B',
    };
  }
  if ((yakuCounts.chiniisou ?? 0) >= 3) {
    return {
      titleName: `一色極めし${suffix}`,
      reason: `「清一色」を${yakuCounts.chiniisou}回成立させて制覇`,
      tier: 'B',
    };
  }
  if (sc.yakuCount >= 20) {
    return {
      titleName: `千変万化の${suffix}`,
      reason: `計${sc.yakuCount}回の役を成立させて制覇`,
      tier: 'B',
    };
  }
  if ((yakuCounts.riichi ?? 0) >= 4) {
    return {
      titleName: `一撃必中の${suffix}`,
      reason: `リーチ役を${yakuCounts.riichi}回決めて制覇`,
      tier: 'B',
    };
  }

  // 4. Cランク：標準制覇
  if (state.difficulty === 'advanced') {
    return {
      titleName: `修羅を抜けし${suffix}`,
      reason: '高難度「上級編」の全10連戦を制覇',
      tier: 'B',
    };
  }
  if (hpRatio >= 0.95) {
    return {
      titleName: `完全勝利の${suffix}`,
      reason: 'ほぼ無傷のまま全10連戦を制覇',
      tier: 'C',
    };
  }
  return {
    titleName: `試練を越えし${suffix}`,
    reason: '全10連戦を見事に勝ち抜き制覇',
    tier: 'C',
  };
}

/** 強者共（保存キャラクター）の型定義 */
export interface VeteranCharacter {
  id: string;
  userId: string;
  slotIndex: number; // 0〜9
  jobId: JobId;
  difficulty: DifficultyId;
  titleName: string;
  maxHp: number;
  bonusTileAtk: Record<TileGroup, number>;
  equipments: string[];
  yakuSummary: Record<string, number>;
  totalScore: number;
  isMarked: boolean;
  comment: string;
  createdAt: number;
  updatedAt: number;
  // 対人戦・他者表示用オプション
  ownerNickname?: string;
  ownerAvatar?: string;
  ownerComment?: string;
}

