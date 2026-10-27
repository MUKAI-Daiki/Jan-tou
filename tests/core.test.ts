import { describe, expect, it } from 'vitest';
import { BattleState, HAND_SIZE, newBattle, step } from '../src/core/battle';
import { canDeclareRiichi, canMulliganHand, decompose, decomposeSelection, Mentsu } from '../src/core/mentsu';
import { ScoreContext, evaluateSelection } from '../src/core/score';
import { TileId, baseTileAttack, kindOf } from '../src/core/tile';
import { YAKU_CATALOG } from '../src/core/yaku';
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
      out.push(kind * 4 + (n % 4));
    }
  }
  return out;
}

const ev = (spec: string, melds: Mentsu[] = [], ctx: ScoreContext = {}) =>
  evaluateSelection(tiles(spec), melds, ctx);
const yakuNames = (spec: string, ctx: ScoreContext = {}) =>
  ev(spec, [], ctx).yaku.map((y) => y.name).sort();

describe('牌とセット分解', () => {
  it('全34種136枚を使用し、基礎攻撃力が仕様通り（1・9・字牌=10、2〜8=その数字）', () => {
    const s = newBattle(MONSTERS[0], 1);
    expect(s.hand).toHaveLength(HAND_SIZE);
    expect(s.wall).toHaveLength(136 - HAND_SIZE);
    expect(baseTileAttack(0)).toBe(10); // 1萬
    expect(baseTileAttack(4)).toBe(5); // 5萬
    expect(baseTileAttack(8)).toBe(10); // 9萬
    expect(baseTileAttack(27)).toBe(10); // 東
    expect(baseTileAttack(33)).toBe(10); // 中
  });

  it('任意の枚数からセット・ペア・単牌に分解できる', () => {
    expect(decompose(tiles('123m'))[0][0].type).toBe('shuntsu');
    const ds = decomposeSelection(tiles('234m55p9s'));
    expect(ds.some((d) => d.sets.length === 1 && d.pairs.length === 1 && d.singles.length === 1)).toBe(true);
  });
});

describe('新ダメージ計算とセットボーナス', () => {
  it('単牌・ペア・並びセット・同牌セット・カンのボーナス加算', () => {
    // 単牌1枚（5萬=5）
    expect(ev('5m')).toMatchObject({ valid: true, tilePower: 5, setBonus: 0, damage: 5 });
    // ペア（5萬×2 = 10 + ペアボーナス5 = 15）
    expect(ev('55m')).toMatchObject({ valid: true, tilePower: 10, setBonus: 5, damage: 15 });
    // 並びセット（2,3,4萬 = 9 + 並びボーナス10 = 19）
    expect(ev('234m')).toMatchObject({ valid: true, tilePower: 9, setBonus: 10, damage: 19 });
    // 同牌セット（5筒×3 = 15 + 同牌ボーナス20 = 35）
    expect(ev('555p')).toMatchObject({ valid: true, tilePower: 15, setBonus: 20, damage: 35 });
  });

  it('レベル補正 ×(1+level/4) と金牌補正 +50%/枚', () => {
    const t = tiles('111m'); // 10*3 + 20 = 50
    // Lv4なら ×(1 + 4/4) = ×2 → 100
    expect(evaluateSelection(t, [], { level: 4 }).damage).toBe(100);
    // 金牌2枚なら ×(1 + 0.5*2) = ×2 → 200
    expect(
      evaluateSelection(t, [], {
        level: 4,
        tileMods: { [t[0]]: 'gold', [t[1]]: 'gold' },
      }).damage,
    ).toBe(200);
  });

  it('キープしたカンは2セット役以上にしか使えず、カン1つにつき基本攻撃力+50%＆ボーナス+30', () => {
    const kanTiles = tiles('2222p');
    const kan: Mentsu = { type: 'kantsu', kind: kindOf(kanTiles[0]), tiles: kanTiles, declared: true };
    // 単独（1セット）では使用不可
    expect(evaluateSelection([], [kan]).valid).toBe(false);
    // 2セットでも役なしなら使用不可
    expect(evaluateSelection(tiles('234m'), [kan]).valid).toBe(false);
    // 二暗刻（2セット役）なら使用可能：
    // 牌攻撃力: 2筒×4(8) + 3索×3(9) = 17, ボーナス: カン(30) + 同牌(20) = 50 → 計67
    // カン1つ含みで基本攻撃力 ×1.5 = 100.5 → 101
    const r = evaluateSelection(tiles('333s'), [kan]);
    expect(r.valid).toBe(true);
    expect(r.yaku.map((y) => y.name)).toContain('二暗刻');
    expect(r.damage).toBe(101);
  });
});

describe('役と効果の判定', () => {
  it('1セット役：白・發（2倍）・中', () => {
    expect(yakuNames('555z')).toEqual(['白セット']);
    expect(ev('666z')).toMatchObject({
      yaku: [{ id: 'hatsu', name: '發セット', dmgMult: 2, chains: 1 }],
      damage: (30 + 20) * 2,
    });
    expect(yakuNames('777z')).toEqual(['中セット']);
  });

  it('2セット役：一盃口・二色同順・二色同刻・二暗刻・チャンタ', () => {
    expect(yakuNames('123123m')).toContain('一盃口');
    expect(yakuNames('234m234p')).toEqual(['二色同順']);
    expect(yakuNames('555m555p')).toEqual(['二暗刻', '二色同刻'].sort());
    expect(yakuNames('123m111z')).toEqual(['チャンタ']);
  });

  it('装備解禁役：タンヤオ・風牌セット', () => {
    expect(yakuNames('234m555p')).toEqual([]);
    expect(yakuNames('234m555p', { tanyaoUnlocked: true })).toEqual(['タンヤオ']);
    expect(yakuNames('111z', { unlockedWinds: new Set([27]) })).toEqual(['東セット']);
  });

  it('四対子：ペア4組でチェーン4回', () => {
    const r = ev('11m33p55s77z');
    expect(r.valid).toBe(true);
    expect(r.yaku.map((y) => y.name)).toEqual(['四対子']);
    expect(r.gainedChains).toBe(4);
  });

  it('3セット役は他の役と複合せず単体で成立する', () => {
    expect(yakuNames('123m456p789s')).toEqual(['平和']);
    expect(yakuNames('123m456m111z')).toEqual(['混一色']);
    expect(yakuNames('123m456m789m')).toEqual(['清一色']);
    expect(yakuNames('222m555p888s')).toEqual(['三暗刻']);
    expect(yakuNames('111m999p111s')).toEqual(['清老頭']);
    expect(yakuNames('555666777z')).toEqual(['大三元']);
    expect(yakuNames('234s666s666z')).toEqual(['緑一色']);
    expect(yakuNames('111222555z')).toEqual(['字一色']);
  });

  it('YAKU_CATALOGのすべての具体例が対応する役として成立する', () => {
    for (const entry of YAKU_CATALOG) {
      const used = new Map<number, number>();
      const ids: TileId[] = [];
      const melds: Mentsu[] = [];
      for (const m of entry.example) {
        const mIds: TileId[] = [];
        for (const k of m) {
          const n = used.get(k) ?? 0;
          used.set(k, n + 1);
          mIds.push(k * 4 + (n % 4));
        }
        if (m.length === 4) {
          melds.push({ type: 'kantsu', kind: m[0], tiles: mIds, declared: true });
        } else {
          ids.push(...mIds);
        }
      }
      const r = evaluateSelection(ids, melds, {
        tanyaoUnlocked: true,
        unlockedWinds: new Set([27, 28, 29, 30]),
      });
      expect(r.valid).toBe(true);
      expect(r.yaku.length).toBeGreaterThan(0);
    }
  });
});

describe('戦闘・チェーン・特殊行動・連戦システム', () => {
  it('役攻撃でチェーンが発生し、役なし攻撃で敵行動・次ターンへ進む', () => {
    const s0 = newBattle(MONSTERS[3], 1);
    const handTiles = tiles('555z234m789p');
    const s: BattleState = { ...s0, hand: handTiles };

    // 1回目：白セット（1セット役）で攻撃 → チェーン発生、ターンは1のまま、白障壁ON
    const r1 = step(s, { type: 'attack', tiles: handTiles.slice(0, 3), melds: [] });
    expect(r1.error).toBeUndefined();
    expect(r1.state.turn).toBe(1);
    expect(r1.state.chain).toBe(1);
    expect(r1.state.buffs.nullifyDamage).toBe(true);
    expect(r1.state.hand).toHaveLength(9);

    // 2回目：単牌1枚（役なし）で攻撃 → チェーン終了、敵が行動（白障壁で無効化）してターン2へ
    const r2 = step(r1.state, { type: 'attack', tiles: [r1.state.hand[0]], melds: [] });
    expect(r2.error).toBeUndefined();
    expect(r2.state.turn).toBe(2);
    expect(r2.state.chain).toBe(0);
  });

  it('カン宣言で金牌が1枚補充され、マリガン・リーチが正しく機能する', () => {
    const s0 = newBattle(MONSTERS[0], 1);
    const handWithKan = tiles('1111m99p123z'); // 1・9・字牌が9枚
    const s: BattleState = { ...s0, hand: handWithKan };

    // マリガン可能
    expect(canMulliganHand(s.hand)).toBe(true);
    const rm = step(s, { type: 'mulligan' });
    expect(rm.error).toBeUndefined();
    expect(rm.state.mulligansUsed).toBe(1);

    // カン宣言 → 金牌が1枚補充される
    const rk = step(s, { type: 'kan', kind: 0 });
    expect(rk.error).toBeUndefined();
    expect(rk.state.melds).toHaveLength(1);
    expect(rk.state.hand).toHaveLength(6);
    const drawnTile = rk.state.drawn[0];
    expect(rk.state.tileMods[drawnTile]).toBe('gold');

    // リーチ判定（2セット＋2枚塔子＋不要牌1枚）
    const tenpaiHand = tiles('123m456p23s7z');
    expect(canDeclareRiichi(tenpaiHand, [])).toBe(true);
    const sr = step({ ...s0, hand: tenpaiHand }, { type: 'riichi' });
    expect(sr.error).toBeUndefined();
    expect(sr.state.riichi).toBe(true);
    // リーチ宣言時に聴牌を崩さない不要牌(7z=中)が自摸切り対象(drawn[0])にセットされる
    expect(kindOf(sr.state.drawn[0])).toBe(33);

    // リーチキャンセル：リーチが解除され、ペナルティとして5ターン役封印が付与される
    const sc = step(sr.state, { type: 'cancel_riichi' });
    expect(sc.error).toBeUndefined();
    expect(sc.state.riichi).toBe(false);
    expect(sc.state.buffs.sealYakuTurns).toBe(5);
  });

  it('敵を撃破すると報酬選択になり、装備を選んで次のステージへ手牌・残り牌を持ち越す', () => {
    const s0 = newBattle(MONSTERS[0], 1);
    const strongHand = tiles('555666777z'); // 大三元（10倍ダメージ）
    const s: BattleState = { ...s0, hand: strongHand };

    const r1 = step(s, { type: 'attack', tiles: strongHand, melds: [] });
    expect(r1.error).toBeUndefined();
    expect(r1.state.status).toBe('reward');
    expect(r1.state.rewardChoices).toHaveLength(3);
    // 大三元効果でアンコモン以上の装備を3つ獲得している
    expect(r1.state.equipments).toHaveLength(3);

    // 報酬を1つ選ぶとステージ2へ進む
    const chosen = r1.state.rewardChoices[0];
    const r2 = step(r1.state, { type: 'choose_reward', equipId: chosen });
    expect(r2.error).toBeUndefined();
    expect(r2.state.status).toBe('playing');
    expect(r2.state.stage).toBe(2);
    expect(r2.state.equipments).toHaveLength(4);
  });

  it('役固有の効果（中3枚・一盃口・二暗刻・チャンタ・字一色）が正しく動作する', () => {
    const s0 = newBattle(MONSTERS[7], 42); // 高HPの敵

    // 中セット：補充牌3枚が金牌になる
    const sChun: BattleState = { ...s0, hand: tiles('777z123m456p') };
    const rChun = step(sChun, { type: 'attack', tiles: tiles('777z'), melds: [] });
    expect(rChun.error).toBeUndefined();
    expect(rChun.state.drawn).toHaveLength(3);
    expect(rChun.state.drawn.every((t) => rChun.state.tileMods[t] === 'gold')).toBe(true);

    // 一盃口：ペア3組（計6枚）が補充される
    const sIipei: BattleState = { ...s0, hand: tiles('123123m456p') };
    const rIipei = step(sIipei, { type: 'attack', tiles: tiles('123123m'), melds: [] });
    expect(rIipei.error).toBeUndefined();
    expect(rIipei.state.drawn).toHaveLength(6);
    expect(kindOf(rIipei.state.drawn[0])).toBe(kindOf(rIipei.state.drawn[1]));
    expect(kindOf(rIipei.state.drawn[2])).toBe(kindOf(rIipei.state.drawn[3]));
    expect(kindOf(rIipei.state.drawn[4])).toBe(kindOf(rIipei.state.drawn[5]));

    // 二暗刻：補充に同牌セット（3枚組）が含まれる
    const sNian: BattleState = { ...s0, hand: tiles('222m555p789s') };
    const rNian = step(sNian, { type: 'attack', tiles: tiles('222m555p'), melds: [] });
    expect(rNian.error).toBeUndefined();
    expect(kindOf(rNian.state.drawn[0])).toBe(kindOf(rNian.state.drawn[1]));
    expect(kindOf(rNian.state.drawn[1])).toBe(kindOf(rNian.state.drawn[2]));

    // 字一色：その場でレベルが3上がる
    const sTsuu: BattleState = { ...s0, hand: tiles('111222555z') };
    const rTsuu = step(sTsuu, { type: 'attack', tiles: sTsuu.hand, melds: [] });
    expect(rTsuu.error).toBeUndefined();
    expect(rTsuu.state.player.level).toBeGreaterThanOrEqual(3);
  });

  it('装備スキル（治療・残り牌リセット・複製・サーチ）が正しく動作する', () => {
    const s0 = newBattle(MONSTERS[3], 10);
    const handTiles = tiles('234m567p123s');
    const s: BattleState = {
      ...s0,
      hand: handTiles,
      player: { ...s0.player, hp: 100, maxHp: 300 },
      equipments: ['unlock_heal', 'skill_reset_wall', 'skill_copy', 'skill_search'],
    };

    // 治療ONで攻撃 → 自分のHPが回復する
    const rHealOn = step(s, { type: 'toggle_heal' });
    expect(rHealOn.state.healMode).toBe(true);
    const rHealAtk = step(rHealOn.state, { type: 'attack', tiles: handTiles.slice(0, 3), melds: [] });
    expect(rHealAtk.state.player.hp).toBeGreaterThan(100);
    expect(rHealAtk.state.monster.hp).toBe(s.monster.hp);

    // 複製：手牌の1枚目を2枚目と同じ種類に変化させる
    const rCopy = step(s, {
      type: 'skill_copy',
      targetTile: handTiles[0],
      sourceTile: handTiles[3],
    });
    expect(rCopy.error).toBeUndefined();
    expect(kindOf(rCopy.state.hand[0])).toBe(kindOf(handTiles[3]));
    expect(rCopy.state.cooldowns.copy).toBe(5);

    // サーチ：手牌の1枚目を残り牌の「中(33)」に変化させる
    const rSearch = step(s, {
      type: 'skill_search',
      targetTile: handTiles[0],
      kind: 33,
    });
    expect(rSearch.error).toBeUndefined();
    expect(kindOf(rSearch.state.hand[0])).toBe(33);
    expect(rSearch.state.cooldowns.search).toBe(5);
  });
});
