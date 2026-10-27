import { describe, expect, it } from 'vitest';
import { decompose, Mentsu } from '../src/core/mentsu';
import { calcDamage, evaluateMentsu, evaluateSelection } from '../src/core/score';
import { TileId } from '../src/core/tile';
import { YAKU_CATALOG } from '../src/core/yaku';
import { newBattle, step, HAND_SIZE, BattleState } from '../src/core/battle';
import { MONSTERS } from '../src/data/monsters';

/** "123m456p777z" のような記法から牌IDを作る（字牌 1-7 = 東南西北白發中） */
function tiles(spec: string): TileId[] {
  const used = new Map<number, number>();
  const out: TileId[] = [];
  for (const [, nums, suit] of spec.matchAll(/(\d+)([mpsz])/g)) {
    const base = { m: 0, p: 9, s: 18, z: 27 }[suit as 'm' | 'p' | 's' | 'z'];
    for (const ch of nums) {
      const kind = base + Number(ch) - 1;
      const n = used.get(kind) ?? 0;
      used.set(kind, n + 1);
      out.push(kind * 4 + n);
    }
  }
  return out;
}

const ev = (spec: string, melds: Mentsu[] = []) => evaluateSelection(tiles(spec), melds);
const yakuNames = (spec: string) => ev(spec).yaku.map((y) => y.name).sort();

describe('decompose', () => {
  it('順子1つ', () => {
    const d = decompose(tiles('123m'));
    expect(d).toHaveLength(1);
    expect(d[0][0].type).toBe('shuntsu');
  });
  it('面子にならない', () => {
    expect(decompose(tiles('124m'))).toHaveLength(0);
    expect(decompose(tiles('11m'))).toHaveLength(0);
  });
  it('111222333m は順子3つと刻子3つの2通り', () => {
    expect(decompose(tiles('111222333m'))).toHaveLength(2);
  });
  it('字牌は順子にならない', () => {
    expect(decompose(tiles('123z'))).toHaveLength(0);
  });
  it('4枚は槓子', () => {
    const d = decompose(tiles('5555p'));
    expect(d).toHaveLength(1);
    expect(d[0][0].type).toBe('kantsu');
  });
});

describe('ダメージ計算', () => {
  it('満貫未満と満貫以上の式', () => {
    expect(calcDamage(20, 0)).toBe(400); // 320 → 400
    expect(calcDamage(30, 0)).toBe(500); // 480 → 500
    expect(calcDamage(30, 4)).toBe(7700); // 7680 → 7700
    expect(calcDamage(40, 4)).toBe(8000); // 満貫
    expect(calcDamage(30, 5)).toBe(8000); // 満貫
    expect(calcDamage(30, 6)).toBe(12000); // 跳満
    expect(calcDamage(30, 8)).toBe(16000); // 倍満
    expect(calcDamage(30, 11)).toBe(24000); // 三倍満
    expect(calcDamage(30, 13)).toBe(32000); // 役満
    expect(calcDamage(30, 26)).toBe(64000); // ダブル役満
    expect(calcDamage(20, 1, 2)).toBe(1400); // 2面子倍率 ×2
    expect(calcDamage(20, 1, 3)).toBe(2100); // 3面子倍率 ×3
  });
  it('基本攻撃（0翻）', () => {
    expect(ev('234m')).toMatchObject({ valid: true, fu: 20, han: 0, damage: 400 });
    expect(ev('555p')).toMatchObject({ valid: true, fu: 30, han: 0, damage: 500 });
    expect(ev('999s')).toMatchObject({ fu: 30, damage: 500 }); // 28 → 30
    expect(ev('1111m')).toMatchObject({ fu: 60, damage: 1000 }); // 52 → 60
    expect(ev('5555m')).toMatchObject({ fu: 40, damage: 700 }); // 36 → 40, 640 → 700
  });
  it('三元牌の刻子は1面子でも役牌', () => {
    expect(ev('777z')).toMatchObject({ valid: true, han: 1, damage: 1000 });
  });
});

describe('役判定', () => {
  it('2面子で役なしは攻撃できない', () => {
    expect(ev('234p567s').valid).toBe(false);
  });
  it('一盃口（2面子・×2倍）', () => {
    expect(ev('234234m')).toMatchObject({ valid: true, han: 1, multiplier: 2, damage: 1400 });
  });
  it('二色同順（2面子・2翻・×2倍）', () => {
    expect(yakuNames('234p234s')).toEqual(['二色同順']);
    expect(ev('234p234s')).toMatchObject({ valid: true, fu: 20, han: 2, multiplier: 2, damage: 2600 });
  });
  it('二色同刻＋二暗刻（2面子・4翻・×2倍）', () => {
    expect(yakuNames('555p555s')).toEqual(['二暗刻', '二色同刻'].sort());
    expect(ev('555p555s')).toMatchObject({ valid: true, fu: 30, han: 4, multiplier: 2, damage: 15400 });
  });
  it('二暗刻（2面子・2翻・×2倍）', () => {
    expect(yakuNames('222p555s')).toEqual(['二暗刻']);
    expect(ev('222p555s')).toMatchObject({ valid: true, fu: 30, han: 2, multiplier: 2, damage: 4000 });
  });
  it('小三元＋二暗刻＋混老頭（2面子・×2倍）', () => {
    expect(yakuNames('555666z')).toEqual(['二暗刻', '小三元', '役牌 白', '役牌 發', '混老頭'].sort());
    expect(ev('555666z')).toMatchObject({ han: 8, multiplier: 2, damage: 32000 });
  });
  it('2面子では断么九を見ない', () => {
    expect(ev('234m555p').valid).toBe(false);
  });
  it('平和のみ（3面子・20符1翻・×3倍＝2,100）', () => {
    expect(yakuNames('123p234s789s')).toEqual(['平和']);
    expect(ev('123p234s789s')).toMatchObject({ fu: 20, han: 1, multiplier: 3, damage: 2100 });
  });
  it('二色同順＋断么九＋平和（3面子・×3倍）', () => {
    expect(yakuNames('234p234s567p')).toEqual(['二色同順', '断么九', '平和'].sort());
    expect(ev('234p234s567p')).toMatchObject({ fu: 20, han: 4, multiplier: 3, damage: 15600 });
  });
  it('二色同刻＋三暗刻＋断么九（3面子・6翻＝跳満×3倍）', () => {
    expect(yakuNames('555p555s222p')).toEqual(['三暗刻', '二色同刻', '断么九'].sort());
    expect(ev('555p555s222p')).toMatchObject({ fu: 40, han: 6, multiplier: 3, damage: 36000 });
  });
  it('清一色(3)＋一気通貫(3)＋平和(1)＝7翻（跳満12,000×3倍＝36,000）', () => {
    expect(ev('123456789p')).toMatchObject({ han: 7, multiplier: 3, damage: 36000 });
  });
  it('三槓子(4)＋三暗刻(3)＋断么九(1)＝8翻（倍満16,000×3倍＝48,000）', () => {
    expect(yakuNames('2222p5555p8888s')).toEqual(['三暗刻', '三槓子', '断么九'].sort());
    expect(ev('2222p5555p8888s')).toMatchObject({ han: 8, multiplier: 3, damage: 48000 });
  });
  it('混全帯么九（2面子・3面子）', () => {
    expect(yakuNames('123p555z')).toEqual(['役牌 白', '混全帯么九'].sort());
    expect(yakuNames('123m789p111z')).toEqual(['混全帯么九']);
  });
  it('純全帯么九（2面子・3面子）', () => {
    expect(yakuNames('123p789s')).toEqual(['純全帯么九']);
    expect(yakuNames('123p789p999s')).toEqual(['純全帯么九']);
    expect(yakuNames('123p789p789s')).toEqual(['二色同順', '平和', '純全帯么九'].sort());
  });
  it('混老頭（2面子・3面子、チャンタ・対々和と複合しない）', () => {
    expect(yakuNames('111p555z')).toEqual(['二暗刻', '役牌 白', '混老頭'].sort());
    expect(yakuNames('111m999p222z')).toEqual(['三暗刻', '混老頭'].sort());
  });
  it('混一色（1翻）', () => {
    const r = ev('123m456m111z');
    expect(r.yaku).toContainEqual({ name: '混一色', han: 1 });
  });
  it('風牌の刻子は役牌にならない（2面子なら二暗刻＋混老頭）', () => {
    expect(ev('111z').han).toBe(0);
    expect(yakuNames('111z222z')).toEqual(['二暗刻', '混老頭'].sort());
  });
  it('大三元＋字一色はダブル役満（26翻・64,000×3倍＝192,000）', () => {
    const r = ev('555666777z');
    expect(r.yaku.map((y) => y.name).sort()).toEqual(['大三元', '字一色'].sort());
    expect(r.han).toBe(26);
    expect(r.damage).toBe(192000);
  });
  it('役満は通常役を消す', () => {
    expect(yakuNames('111999m111p')).toEqual(['清老頭']);
  });
  it('緑一色', () => {
    expect(yakuNames('234s666s666z')).toEqual(['緑一色']);
  });
  it('七対子（対子4組・25符2翻・×3倍）', () => {
    expect(ev('1133p2299s')).toMatchObject({
      valid: true,
      fu: 25,
      han: 2,
      multiplier: 3,
      damage: 4800,
    });
    expect(yakuNames('1133p2299s')).toEqual(['七対子']);
  });
  it('七対子＋一盃口＋断么九（染め手は3面子攻撃時のみのため非複合・×3倍）', () => {
    expect(yakuNames('22334466p')).toEqual(['一盃口', '七対子', '断么九'].sort());
    expect(ev('22334466p')).toMatchObject({
      valid: true,
      fu: 25,
      han: 4,
      multiplier: 3,
      damage: 19200,
    });
  });
  it('2面子攻撃では染め手は複合しない', () => {
    expect(yakuNames('234234p')).toEqual(['一盃口']);
  });
  it('4面子以上は不可（対子4組以外）', () => {
    expect(ev('123m456m789m123p').valid).toBe(false);
  });
  it('YAKU_CATALOGのすべての具体例が対応する役として成立する', () => {
    for (const entry of YAKU_CATALOG) {
      const used = new Map<number, number>();
      const ids: TileId[] = [];
      for (const m of entry.example) {
        for (const k of m) {
          const n = used.get(k) ?? 0;
          used.set(k, n + 1);
          ids.push(k * 4 + (n % 4));
        }
      }
      const r = evaluateSelection(ids, []);
      expect(r.valid).toBe(true);
      const expectedName = entry.name.startsWith('役牌') ? '役牌 中' : entry.name;
      expect(r.yaku.map((y) => y.name)).toContain(expectedName);
    }
  });
});

describe('副露した暗槓', () => {
  const kan = (spec: string): Mentsu => {
    const t = tiles(spec);
    return { type: 'kantsu', kind: t[0] >> 2, tiles: t, declared: true };
  };
  it('役牌以外は単独で攻撃できない', () => {
    expect(evaluateMentsu([kan('5555m')]).valid).toBe(false);
  });
  it('三元牌なら単独で攻撃できる', () => {
    expect(evaluateMentsu([kan('7777z')]).valid).toBe(true);
  });
  it('役攻撃には使える', () => {
    const r = evaluateSelection(tiles('555p'), [kan('5555s')]);
    expect(r.yaku.map((y) => y.name)).toContain('二色同刻');
    expect(r.yaku.map((y) => y.name)).toContain('二暗刻');
  });
});

describe('戦闘の進行', () => {
  const total = (s: BattleState) => s.hand.length + s.melds.length * 3;

  it('開始時は自模後の9枚（全84枚のうち残り75枚、萬子・風牌なし）', () => {
    const s = newBattle(MONSTERS[0], 1);
    expect(s.hand).toHaveLength(HAND_SIZE + 1);
    expect(s.wall).toHaveLength(84 - 9);
    const all = [...s.hand, ...s.wall];
    // 萬子(0..8)と風牌(27..30)が含まれないことを確認
    expect(all.every((t) => {
      const k = t >> 2;
      return (k >= 9 && k <= 26) || (k >= 31 && k <= 33);
    })).toBe(true);
  });

  it('打牌でモンスターが行動し、次の自模が来る', () => {
    const s = newBattle(MONSTERS[0], 1);
    const r = step(s, { type: 'discard', tile: s.hand[0] });
    expect(r.error).toBeUndefined();
    expect(r.state.turn).toBe(2);
    expect(r.state.hand).toHaveLength(9);
    expect(s.hand).toHaveLength(9); // 元の state は変更されない
  });

  it('ランダムに打ち続けても枚数が保存され、残り牌がリセットされる', () => {
    let s = newBattle({ ...MONSTERS[0], skills: MONSTERS[0].skills.map((k) => ({ ...k, min: 0, max: 0 })) as typeof MONSTERS[0]['skills'] }, 42);
    for (let i = 0; i < 300; i++) {
      // 攻撃できる面子があれば先頭から試す（簡易）
      const r = step(s, { type: 'discard', tile: s.hand[i % s.hand.length] });
      expect(r.error).toBeUndefined();
      s = r.state;
      expect(total(s)).toBe(9);
      const all = [...s.wall, ...s.hand, ...s.melds.flatMap((m) => m.tiles)];
      expect(new Set(all).size).toBe(all.length);
    }
    expect(s.resets).toBeGreaterThan(0);
  });

  it('連続攻撃（Chain）でダメージに×(Chain数+1)の補正がかかり、打牌でリセットされる', () => {
    const s0 = newBattle(MONSTERS[2], 1);
    const handTiles = tiles('123p456p789p');
    const s: BattleState = { ...s0, hand: handTiles };

    // 1回目の攻撃（Chain 0 → ×1 = 400）
    const r1 = step(s, { type: 'attack', tiles: handTiles.slice(0, 3), melds: [] });
    expect(r1.error).toBeUndefined();
    expect(r1.state.chain).toBe(1);
    expect(r1.state.hand).toHaveLength(9);
    expect(r1.attack!.damage).toBe(400);
    expect(r1.state.monster.hp).toBe(s.monster.hp - 400);

    // 2回目の攻撃（Chain 1 → ×2 = 800）
    const r2 = step(r1.state, { type: 'attack', tiles: handTiles.slice(3, 6), melds: [] });
    expect(r2.error).toBeUndefined();
    expect(r2.state.chain).toBe(2);
    expect(r2.state.hand).toHaveLength(9);
    expect(r2.attack!.damage).toBe(800);
    expect(r2.state.monster.hp).toBe(r1.state.monster.hp - 800);

    // 3回目の攻撃（Chain 2 → ×3 = 1200）
    const r3 = step(r2.state, { type: 'attack', tiles: handTiles.slice(6, 9), melds: [] });
    expect(r3.error).toBeUndefined();
    expect(r3.state.chain).toBe(3);
    expect(r3.attack!.damage).toBe(1200);

    // 打牌すると次ターンになりChainが0にリセットされる
    const r4 = step(r3.state, { type: 'discard', tile: r3.state.hand[0] });
    expect(r4.error).toBeUndefined();
    expect(r4.state.turn).toBe(2);
    expect(r4.state.chain).toBe(0);
  });
});
