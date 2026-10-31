import { describe, expect, it } from 'vitest';
import { BattleState, HAND_SIZE, calculateScore, newBattle, step } from '../src/core/battle';
import {
  canDeclareRiichi,
  decompose,
  decomposeSelection,
  findRiichiDiscards,
  getRiichiWaits,
  Mentsu,
} from '../src/core/mentsu';
import {
  ScoreContext,
  evaluateSelection,
  findBestYakuCombo,
  getYakuGuideHighlights,
} from '../src/core/score';
import { TileId, baseTileAttack, kindOf, numOf, suitOf } from '../src/core/tile';
import { YAKU_CATALOG, calcYakuMoneyBonus, calcYakuScore } from '../src/core/yaku';
import { EQUIPMENTS, getEquipment } from '../src/data/equipments';
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

describe('新ダメージ計算とセットボーナス・職業効果', () => {
  it('単牌・ペア・並びセット・同牌セット・セット数倍率（1.5x/2x/3x）と職業別セット効果', () => {
    // 単牌1枚（5萬=5）
    expect(ev('5m')).toMatchObject({ valid: true, tilePower: 5, setBonus: 0, setCountMult: 1, damage: 5 });
    // ペア（5萬×2 = 10 + ペアボーナス5 = 15）
    expect(ev('55m')).toMatchObject({ valid: true, tilePower: 10, setBonus: 5, setCountMult: 1, damage: 15 });
    // デフォルト（役なし時の固有効果なし）：並びセットのみ（2,3,4萬 = 9 + 10 = 19, 1セット×1.5 → 29）
    expect(ev('234m')).toMatchObject({
      valid: true,
      tilePower: 9,
      setBonus: 10,
      setCountMult: 1.5,
      basicShuntsuHealRate: 0,
      basicDrawSeq2: 0,
      damage: 29,
    });
    // 麻雀医（doctor）：役なし並びセットでHP10%回復＆2枚並び補充
    expect(ev('234m', [], { job: 'doctor' })).toMatchObject({
      valid: true,
      basicShuntsuHealRate: 0.1,
      basicDrawSeq2: 1,
      damage: 29,
    });
    // デフォルト（役なし時の固有効果なし）：同牌セットのみ（5筒×3 = 15 + 20 = 35, 1セット×1.5 → 53）
    expect(ev('555p')).toMatchObject({
      valid: true,
      tilePower: 15,
      setBonus: 20,
      setCountMult: 1.5,
      basicDrawPairs: 0,
      damage: 53,
    });
    // 雀剣士（sword）：役なし同牌セットで最終ダメージ2倍＆ペア補充（35 * 1.5 * 2 = 105）
    expect(ev('555p', [], { job: 'sword' })).toMatchObject({
      valid: true,
      tilePower: 15,
      setBonus: 20,
      setCountMult: 1.5,
      jobDmgMult: 2,
      basicDrawPairs: 1,
      damage: 105,
    });
  });

  it('永続攻撃力ボーナス（bonusTileAtk）とセット内の色牌（金・赤・虹）発動条件', () => {
    const t = tiles('111m'); // (10)*3 + 20 = 50, 1セット×1.5 = 75
    expect(evaluateSelection(t, []).damage).toBe(75);
    // 萬子+4の永続ボーナスがあれば (14*3 + 20) * 1.5 = 93
    expect(
      evaluateSelection(t, [], { bonusTileAtk: { m: 4, p: 0, s: 0, wind: 0, dragon: 0 } }).damage,
    ).toBe(93);
    // セット内に金牌2枚なら ×(1 + 0.5*2) = ×2 → 75 * 2 = 150
    expect(
      evaluateSelection(t, [], {
        tileMods: { [t[0]]: 'gold', [t[1]]: 'gold' },
      }).damage,
    ).toBe(150);

    // セット外の単牌・ペアに金・赤・虹が含まれていても色牌効果は発動しない
    const singleGold = tiles('5m');
    const rSingle = evaluateSelection(singleGold, [], {
      tileMods: { [singleGold[0]]: 'rainbow' },
    });
    expect(rSingle.goldCount).toBe(0);
    expect(rSingle.rainbowCount).toBe(0);
    expect(rSingle.usedRainbowCount).toBe(0);
    expect(rSingle.gainedChains).toBe(0);
    expect(rSingle.damage).toBe(5);
  });

  it('キープしたカンは2セット役以上にしか使えず、カン1つにつき基本攻撃力+50%＆ボーナス+30', () => {
    const kanTiles = tiles('2222p');
    const kan: Mentsu = { type: 'kantsu', kind: kindOf(kanTiles[0]), tiles: kanTiles, declared: true };
    // 単独（1セット）では使用不可
    expect(evaluateSelection([], [kan]).valid).toBe(false);
    // 2セットでも役なし（123m + 2222p）なら使用不可
    expect(evaluateSelection(tiles('123m'), [kan]).valid).toBe(false);
    // 二暗刻＋タンヤオ（2セット役）なら使用可能：
    // 牌攻撃力: 2筒×4(8) + 3索×3(9) = 17, ボーナス: カン(30) + 同牌(20) = 50 → 計67
    // カン1つ含みで基本攻撃力 ×1.5 = 100.5, 二暗刻 ×1.5 × タンヤオ ×2 = ×3, 2セット倍率 ×2 → 603
    const r = evaluateSelection(tiles('333s'), [kan]);
    expect(r.valid).toBe(true);
    expect(r.yaku.map((y) => y.name)).toEqual(expect.arrayContaining(['二暗刻', 'タンヤオ']));
    expect(r.damage).toBe(603);
  });

  it('役なし攻撃は3枚まで、役攻撃時は役に絡まない牌・セットは選択不可、役選択ガイドが機能する', () => {
    // 役なしで3枚までは有効（単牌3枚、ペア＋単牌、1セット）
    expect(ev('2m5p8s').valid).toBe(true);
    expect(ev('55m8s').valid).toBe(true);
    expect(ev('234m').valid).toBe(true);
    // 役なしで4枚以上は無効
    expect(ev('2m5p8s1z').valid).toBe(false);
    expect(ev('234m5p').valid).toBe(false);
    expect(ev('234m123p').valid).toBe(false); // 役なし2セットも不可

    // 役攻撃時でも、役に絡まない単牌・ペア・セットが含まれている場合は無効
    expect(ev('555z2m').valid).toBe(false); // 白セット＋無関係単牌
    expect(ev('555z22m').valid).toBe(false); // 白セット＋無関係ペア
    expect(ev('555z234m').valid).toBe(false); // 白セット＋無関係セット
    // 双方のセットが役に絡む場合（白セット＋發セット、混一色など）は有効
    expect(ev('555z666z').valid).toBe(true);
    expect(ev('123m456m555z').valid).toBe(true); // 混一色

    // 役選択ガイド：手牌から成立可能な役の構成牌がハイライトされ、クリック時に自動選択される
    const hand = tiles('555z234m55p8s'); // 白セット(555z)のみが成立可能な手牌
    const guide = getYakuGuideHighlights(hand, [], {});
    expect(guide.guideTiles.has(hand[0])).toBe(true);
    expect(guide.guideTiles.has(hand[1])).toBe(true);
    expect(guide.guideTiles.has(hand[2])).toBe(true);
    expect(guide.guideTiles.has(hand[3])).toBe(false);

    const best = findBestYakuCombo(hand, [], {}, new Set([hand[0]]), new Set());
    expect(best).not.toBeNull();
    expect(best!.tiles).toEqual(hand.slice(0, 3));
  });
});

describe('役と効果の判定', () => {
  it('1セット役：白・發（2.5倍×1セット1.5倍）・中', () => {
    expect(yakuNames('555z')).toEqual(['白セット']);
    expect(ev('666z')).toMatchObject({
      yaku: [{ id: 'hatsu', name: '發セット', dmgMult: 2.5, chains: 1 }],
      setCountMult: 1.5,
      damage: Math.round((30 + 20) * 2.5 * 1.5),
    });
    expect(yakuNames('777z')).toEqual(['中セット']);
  });

  it('2セット役：一盃口・二色同順・二色同刻・二暗刻・チャンタ・タンヤオ（常時解禁）', () => {
    expect(yakuNames('123123m')).toContain('一盃口');
    expect(yakuNames('234m234p')).toEqual(['タンヤオ', '二色同順'].sort());
    expect(yakuNames('555m555p')).toEqual(['タンヤオ', '二暗刻', '二色同刻'].sort());
    expect(yakuNames('123m111z')).toEqual(['チャンタ']);
    // タンヤオは装備なしでも成立する
    expect(yakuNames('234m555p')).toEqual(['タンヤオ']);
  });

  it('装備解禁役：風牌セット', () => {
    expect(yakuNames('111z', { unlockedWinds: new Set([27]) })).toEqual(['東セット']);
  });

  it('四対子：ペア4組でチェーン4回', () => {
    const r = ev('11m33p55s77z');
    expect(r.valid).toBe(true);
    expect(r.yaku.map((y) => y.name)).toEqual(['四対子']);
    expect(r.gainedChains).toBe(4);
  });

  it('役満相当以外の3セット役は他の役とすべて複合し、役満相当のみ単独成立する', () => {
    expect(yakuNames('123m456p789s')).toEqual(['平和']);
    expect(yakuNames('123m456m111z')).toEqual(['混一色']);
    expect(yakuNames('123m456m789m')).toEqual(['平和', '清一色'].sort());
    expect(yakuNames('222m555p888s')).toEqual(['三暗刻', 'タンヤオ', '二暗刻'].sort());
    expect(yakuNames('111m999p111s')).toEqual(
      ['チャンタ', '三暗刻', '二暗刻', '二色同刻', '清老頭'].sort(),
    );
    // 役満相当は他の役と複合しない
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
      const job = entry.name.includes('ねこぱんち')
        ? 'nekomanto'
        : entry.name.includes('つよつよ')
          ? 'yukako'
          : 'sword';
      const r = evaluateSelection(ids, melds, {
        tanyaoUnlocked: true,
        unlockedWinds: new Set([27, 28, 29, 30]),
        riichi: entry.name === 'リーチ',
        job,
      });
      expect(r.valid).toBe(true);
      expect(r.yaku.length).toBeGreaterThan(0);
    }
  });

  it('職業固有効果（忍びの雀士・ねこまんと・ゆかこ）が仕様通り動作する', () => {
    // 忍びの雀士(ninja)：字牌1セット攻撃でダメージ2.5倍＋チェーン追加1（三元牌セットならチェーン2）
    const rNinjaDragon = ev('555z', [], { job: 'ninja' }); // 白セット
    expect(rNinjaDragon.jobDmgMult).toBe(2.5);
    expect(rNinjaDragon.gainedChains).toBe(2); // 白セット(1) + 忍び(1) = 2

    const rNinjaWind = ev('111z', [], { job: 'ninja' }); // 東3枚（装備なしでも字牌1セットなのでチェーン1）
    expect(rNinjaWind.jobDmgMult).toBe(2.5);
    expect(rNinjaWind.gainedChains).toBe(1);

    // ねこまんと(nekomanto)：ねこぱんち（含むペア数×1.5倍の威力＆ペア数分のチェーン）＋四対子強化
    const rNeko2Pairs = ev('55m77p', [], { job: 'nekomanto' });
    expect(rNeko2Pairs.yaku.map((y) => y.id)).toContain('neko_punch');
    expect(rNeko2Pairs.gainedChains).toBe(2);
    // 5m×2(10)+7p×2(14) + ペアボーナス5×2(10) = 34、ねこぱんち2ペアで威力3倍 → 102
    expect(rNeko2Pairs.damage).toBe(102);

    const rNekoFourPairs = ev('11m33p55s77z', [], { job: 'nekomanto' });
    expect(rNekoFourPairs.yaku.map((y) => y.id)).toEqual(
      expect.arrayContaining(['four_pairs', 'neko_punch']),
    );
    expect(rNekoFourPairs.gainedChains).toBe(8); // 四対子(4) + ねこぱんち4ペア(4)

    // ゆかこ(yukako)：セット1つ以上かつ他の役がないとき「つよつよこうげき（威力3.5倍・チェーン1）」成立
    const rYukakoNoOtherYaku = ev('234m', [], { job: 'yukako' });
    expect(rYukakoNoOtherYaku.yaku.map((y) => y.id)).toEqual(['tsuyotsuyo']);
    expect(rYukakoNoOtherYaku.gainedChains).toBe(1);
    // 234m(9 + 10 = 19) × 1セット(1.5) × つよつよ(3.5) = 99.75 → 100
    expect(rYukakoNoOtherYaku.damage).toBe(100);

    // 他の役（白セットなど）がある場合は「つよつよこうげき」は発生しない
    const rYukakoWithYaku = ev('555z', [], { job: 'yukako' });
    expect(rYukakoWithYaku.yaku.map((y) => y.id)).toEqual(['haku']);
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

  it('カン宣言で金牌が1枚補充され、リーチが正しく機能する', () => {
    const s0 = newBattle(MONSTERS[0], 1);
    const handWithKan = tiles('1111m99p123z');
    const s: BattleState = { ...s0, hand: handWithKan };

    // カン宣言 → 金牌が1枚補充される
    const rk = step(s, { type: 'kan', kind: 0 });
    expect(rk.error).toBeUndefined();
    expect(rk.state.melds).toHaveLength(1);
    expect(rk.state.hand).toHaveLength(6);
    const drawnTile = rk.state.drawn[0];
    expect(rk.state.tileMods[drawnTile]).toBe('gold');

    // リーチ判定（複数の待ちが選べる手牌：123m 456p 235s → 2s切りなら4s待ち、5s切りなら1s・4s待ち）
    const multiWaitHand = tiles('123m456p235s');
    expect(canDeclareRiichi(multiWaitHand, [])).toBe(true);
    const cands = findRiichiDiscards(multiWaitHand, []);
    expect(cands.map(kindOf)).toEqual(expect.arrayContaining([19, 22])); // 2索(19) または 5索(22)
    // 5索(multiWaitHand[8])を切った場合は1索(18)・4索(21)待ちになる
    expect(getRiichiWaits(multiWaitHand, multiWaitHand[8], [])).toEqual([18, 21]);

    // 捨て牌を指定せずにリーチ宣言するとエラーになる（手動選択必須）
    const srErr = step({ ...s0, hand: multiWaitHand }, { type: 'riichi' });
    expect(srErr.error).toBeDefined();

    // 手動で5索を指定してリーチ宣言すると、5索が捨てられて新しい自摸牌がdrawn[0]に入りターンが進む
    const sr = step({ ...s0, hand: multiWaitHand }, { type: 'riichi', discardTile: multiWaitHand[8] });
    expect(sr.error).toBeUndefined();
    expect(sr.state.riichi).toBe(true);
    expect(sr.state.hand).not.toContain(multiWaitHand[8]);
    expect(sr.state.drawn).toHaveLength(1);
    expect(sr.state.hand).toContain(sr.state.drawn[0]);

    // リーチキャンセル：リーチが解除され、ペナルティとして5ターン役封印が加算される
    const sc = step(sr.state, { type: 'cancel_riichi' });
    expect(sc.error).toBeUndefined();
    expect(sc.state.riichi).toBe(false);
    expect(sc.state.buffs.sealYakuTurns).toBe(5);
  });

  it('風牌装備はコモンであり、装備の重複取得はなく、レジェンド装備は5戦目以降のみ出現する', () => {
    expect(getEquipment('wind_east').rarity).toBe('common');
    expect(getEquipment('wind_south').rarity).toBe('common');
    expect(getEquipment('wind_west').rarity).toBe('common');
    expect(getEquipment('wind_north').rarity).toBe('common');
    expect(getEquipment('banner_heal_20').rarity).toBe('rare');

    const nonLegendIds = EQUIPMENTS.filter((e) => e.rarity !== 'legend').map((e) => e.id);
    // ほぼすべての非レジェンド装備を所持した状態（残り2個のみ未所持）でステージ1の敵を撃破
    const owned = nonLegendIds.slice(0, nonLegendIds.length - 2);
    const remainingNonLegend = nonLegendIds.slice(nonLegendIds.length - 2);

    const s0 = newBattle(MONSTERS[0], 777);
    const attackTiles = tiles('123m456p789s');
    const s: BattleState = {
      ...s0,
      stage: 1,
      equipments: [...owned],
      hand: attackTiles,
      monster: { ...s0.monster, hp: 1 },
    };

    const r = step(s, { type: 'attack', tiles: attackTiles, melds: [] });
    expect(r.error).toBeUndefined();
    expect(r.state.status).toBe('reward');
    expect(r.state.rewardChoices).toHaveLength(2);
    for (const id of r.state.rewardChoices) {
      expect(owned).not.toContain(id);
      expect(getEquipment(id)?.rarity).not.toBe('legend');
      expect(remainingNonLegend).toContain(id);
    }

    // ステージ5以降ならレジェンド装備も出現可能になる
    const sStage5: BattleState = {
      ...s0,
      stage: 5,
      equipments: [...nonLegendIds], // 非レジェンドをすべて所持済み
      hand: attackTiles,
      monster: { ...s0.monster, hp: 1 },
    };
    const r5 = step(sStage5, { type: 'attack', tiles: attackTiles, melds: [] });
    expect(r5.state.status).toBe('reward');
    expect(r5.state.rewardChoices).toHaveLength(3);
    for (const id of r5.state.rewardChoices) {
      expect(getEquipment(id)?.rarity).toBe('legend');
    }
  });

  it('「鈍化」デバフ中は装備の「常にチェーン+1」も封じられ、チェーン保持数が常に0になる', () => {
    const s0 = newBattle(MONSTERS[3], 12);
    const handTiles = tiles('555z234m789p');
    const s: BattleState = {
      ...s0,
      hand: handTiles,
      equipments: ['always_chain_1'],
      extraChains: 0,
      buffs: { ...s0.buffs, slowTurns: 2 },
    };

    const r = step(s, { type: 'attack', tiles: handTiles.slice(0, 3), melds: [] });
    expect(r.error).toBeUndefined();
    expect(r.state.chain).toBe(0);
    expect(r.state.extraChains).toBe(0);
    expect(r.state.turn).toBe(2);
  });

  it('敵を撃破すると報酬選択になり、デバフは次の敵へ持ち越され、3戦ごとに商店へ入る', () => {
    const s0 = newBattle(MONSTERS[0], 1);
    const strongHand = tiles('555666777z'); // 大三元（10倍ダメージ）
    const s: BattleState = {
      ...s0,
      hand: strongHand,
      equipments: ['hp_up_10'],
      sealedEquipIndices: [0],
      buffs: { ...s0.buffs, atkDownTurns: 2 },
    };

    const r1 = step(s, { type: 'attack', tiles: strongHand, melds: [] });
    expect(r1.error).toBeUndefined();
    expect(r1.state.status).toBe('reward');
    expect(r1.state.rewardChoices).toHaveLength(3);

    // ステージ1クリア時はそのままステージ2へ進み、デバフ（装備封印・攻撃力ダウン）は持ち越される
    const chosen = r1.state.rewardChoices[0];
    const r2 = step(r1.state, { type: 'choose_reward', equipId: chosen });
    expect(r2.error).toBeUndefined();
    expect(r2.state.status).toBe('playing');
    expect(r2.state.stage).toBe(2);
    expect(r2.state.sealedEquipIndices).toEqual([0]);
    expect(r2.state.buffs.atkDownTurns).toBe(2);

    // ステージ3クリア後の報酬選択では「商店（shop）」へ移行する
    const sStage3Reward: BattleState = {
      ...r2.state,
      stage: 3,
      status: 'reward',
      rewardChoices: ['atk_man_2'],
      money: 6000,
      player: { ...r2.state.player, hp: 100, maxHp: 300 },
    };
    const rShop = step(sStage3Reward, { type: 'choose_reward', equipId: 'atk_man_2' });
    expect(rShop.error).toBeUndefined();
    expect(rShop.state.status).toBe('shop');
    // コモン・アンコモン4個、レア2個、レジェンド1個の計7個が並ぶ
    expect(rShop.state.shopItems).toHaveLength(7);
    const rarities = rShop.state.shopItems.map((id) => getEquipment(id).rarity);
    expect(rarities.filter((r) => r === 'common' || r === 'uncommon')).toHaveLength(4);
    expect(rarities.filter((r) => r === 'rare')).toHaveLength(2);
    expect(rarities.filter((r) => r === 'legend')).toHaveLength(1);

    // 商店でHP30%回復（1000銭、1回のみ）
    const rHeal = step(rShop.state, { type: 'buy_shop_heal' });
    expect(rHeal.error).toBeUndefined();
    expect(rHeal.state.money).toBe(5000);
    expect(rHeal.state.player.hp).toBe(190); // 100 + 300*0.3 = 190
    expect(rHeal.state.shopHealUsed).toBe(true);
    // 2回目の回復はエラー
    expect(step(rHeal.state, { type: 'buy_shop_heal' }).error).toBeDefined();

    // 商店で装備を購入（コモン/アンコモン＝500銭）
    const itemToBuy = rHeal.state.shopItems[0];
    const rBuy = step(rHeal.state, { type: 'buy_shop_item', equipId: itemToBuy });
    expect(rBuy.error).toBeUndefined();
    expect(rBuy.state.money).toBe(4500);
    expect(rBuy.state.equipments).toContain(itemToBuy);

    // 商店で所持装備を売却（コモン/アンコモンは買値500の半額＝250銭）
    const manIdx = rBuy.state.equipments.indexOf('atk_man_2');
    const rSell = step(rBuy.state, { type: 'sell_equip', equipIndex: manIdx });
    expect(rSell.error).toBeUndefined();
    expect(rSell.state.money).toBe(4750);
    expect(rSell.state.equipments).not.toContain('atk_man_2');

    // 商店で永続ステータス強化（最大HP+100、牌攻撃力+2：各500銭で何度でも購入可）
    const rUpHp = step(rSell.state, { type: 'buy_shop_hp' });
    expect(rUpHp.error).toBeUndefined();
    expect(rUpHp.state.money).toBe(4250);
    expect(rUpHp.state.player.maxHp).toBe(400);
    expect(rUpHp.state.player.hp).toBe(290);

    const rUpAtk = step(rUpHp.state, { type: 'buy_shop_atk', group: 'm' });
    expect(rUpAtk.error).toBeUndefined();
    expect(rUpAtk.state.money).toBe(3750);
    expect(rUpAtk.state.bonusTileAtk.m).toBe(2);

    // 商店を出るとステージ4へ進む
    const rLeave = step(rUpAtk.state, { type: 'leave_shop' });
    expect(rLeave.error).toBeUndefined();
    expect(rLeave.state.status).toBe('playing');
    expect(rLeave.state.stage).toBe(4);
  });

  it('役固有の効果・永続ステータスボーナス・バフ重複加算・役成立時「癒しの戦旗」が正しく動作する', () => {
    const s0 = newBattle(MONSTERS[7], 42); // 高HPの敵

    // 中セット：補充牌3枚が金牌になり、永続ボーナスとして三元牌攻撃力+4＆銭+200を得る
    const sChun: BattleState = { ...s0, hand: tiles('777z123m456p') };
    const rChun = step(sChun, { type: 'attack', tiles: tiles('777z'), melds: [] });
    expect(rChun.error).toBeUndefined();
    expect(rChun.state.drawn).toHaveLength(3);
    expect(rChun.state.drawn.every((t) => rChun.state.tileMods[t] === 'gold')).toBe(true);
    expect(rChun.state.bonusTileAtk.dragon).toBe(4);
    expect(rChun.state.money).toBe(200); // 1セット役(100) + 中セット追加(100)

    // 平和バフが既に3ターン残っている状態で平和を成立させると、3 + 5 = 8ターンに加算され、全数牌攻撃力+3＆最大HP+50
    const sPinfu: BattleState = {
      ...s0,
      hand: tiles('123m456p789s'),
      buffs: { ...s0.buffs, pinfuTurns: 3 },
    };
    const rPinfu = step(sPinfu, { type: 'attack', tiles: sPinfu.hand, melds: [] });
    expect(rPinfu.error).toBeUndefined();
    expect(rPinfu.state.buffs.pinfuTurns).toBe(8);
    expect(rPinfu.state.bonusTileAtk.m).toBe(3);
    expect(rPinfu.state.bonusTileAtk.p).toBe(3);
    expect(rPinfu.state.bonusTileAtk.s).toBe(3);
    expect(rPinfu.state.player.maxHp).toBe(s0.player.maxHp + 50);

    // 「癒しの戦旗（banner_heal_20）」所持時は役成立ごとに最大HPの20%を回復する
    const sHakuWithBanner: BattleState = {
      ...s0,
      hand: tiles('555z123m456p'),
      player: { ...s0.player, hp: 100, maxHp: 300 },
      equipments: ['banner_heal_20'],
    };
    const rHakuBanner = step(sHakuWithBanner, {
      type: 'attack',
      tiles: tiles('555z'),
      melds: [],
    });
    expect(rHakuBanner.error).toBeUndefined();
    // 癒しの戦旗(round(300*0.2)=60) + 白セット永続強化(maxHp+15, hp+15) + 白セット効果(round(315*0.15)=47) → 100 + 60 + 15 + 47 = 222
    expect(rHakuBanner.state.player.maxHp).toBe(315);
    expect(rHakuBanner.state.player.hp).toBe(222);

    // 字一色：全字牌大幅永続強化（最大HP+150・風牌+15・三元牌+15）＆デバフ全解除
    const sTsuu: BattleState = {
      ...s0,
      hand: tiles('111222555z'),
      player: { ...s0.player, hp: 100, maxHp: 300 },
      buffs: { ...s0.buffs, venomTurns: 3, atkDownTurns: 2 },
    };
    const rTsuu = step(sTsuu, {
      type: 'attack',
      tiles: sTsuu.hand,
      melds: [],
    });
    expect(rTsuu.error).toBeUndefined();
    expect(rTsuu.state.player.maxHp).toBe(450); // 300 + 150
    expect(rTsuu.state.player.hp).toBe(250); // 100 + 150
    expect(rTsuu.state.bonusTileAtk).toEqual({ m: 0, p: 0, s: 0, wind: 15, dragon: 15 });
    expect(rTsuu.state.buffs.venomTurns).toBe(0);
    expect(rTsuu.state.buffs.atkDownTurns).toBe(0);
  });

  it('ボスの新特殊行動（巨体で突き飛ばす・吹雪の息・業火の息・天災）が仕様通り動作する', () => {
    const bossWeights: [number, number, number, number] = [0, 0, 0, 100];

    // 1. 巨体で突き飛ばす（titan_slam）：2倍ダメージ＋手牌2枚強制交換
    const golemDef = { ...MONSTERS[5], weights: bossWeights, bossSkills: ['titan_slam'] as const };
    const sGolem0 = newBattle(golemDef, 101);
    const sGolem: BattleState = { ...sGolem0, hand: tiles('2m3m4m5p6p7p1s2s9s') };
    const rGolem = step(sGolem, { type: 'attack', tiles: [sGolem.hand[0]], melds: [] });
    expect(rGolem.monsterTurnSteps![0].declareText).toContain('巨体で突き飛ばす');
    expect(rGolem.monsterTurnSteps![0].events[0].amount).toBeGreaterThanOrEqual(
      Math.floor(golemDef.atk * 0.9) * 2,
    );

    // 2. 吹雪の息（blizzard_breath）：1.5倍ダメージ＋手牌3枚を2ターン封印
    const knightDef = {
      ...MONSTERS[6],
      weights: bossWeights,
      bossSkills: ['blizzard_breath'] as const,
    };
    const sKnight0 = newBattle(knightDef, 102);
    const sKnight: BattleState = { ...sKnight0, hand: tiles('2m3m4m5p6p7p1s2s9s') };
    const rKnight = step(sKnight, { type: 'attack', tiles: [sKnight.hand[0]], melds: [] });
    expect(rKnight.monsterTurnSteps![0].declareText).toContain('吹雪の息');
    expect(Object.keys(rKnight.state.sealedTiles)).toHaveLength(3);

    // 3. 業火の息（hellfire_breath）：1.5倍ダメージ＋強化牌（金・赤・虹・装備赤牌含む）をすべて通常牌に消去
    const chimeraDef = {
      ...MONSTERS[7],
      weights: bossWeights,
      bossSkills: ['hellfire_breath'] as const,
    };
    const sChimera0 = newBattle(chimeraDef, 103);
    const handWithMods = tiles('456m2m3m5p6p7p9s'); // 456m を含む
    const sChimera: BattleState = {
      ...sChimera0,
      hand: handWithMods,
      equipments: ['all_five_red'], // 5の牌が赤牌になる装備
      tileMods: {
        [handWithMods[0]]: 'gold',
        [handWithMods[2]]: 'rainbow',
      },
    };
    const rChimera = step(sChimera, { type: 'attack', tiles: [handWithMods[8]], melds: [] });
    expect(rChimera.monsterTurnSteps![0].declareText).toContain('業火の息');
    expect(rChimera.state.tileMods[handWithMods[0]]).toBe('normal');
    expect(rChimera.state.tileMods[handWithMods[2]]).toBe('normal');
    // 装備で赤牌になっていた5萬(handWithMods[1])も 'normal' になり赤牌効果が消える
    expect(rChimera.state.tileMods[handWithMods[1]]).toBe('normal');
    const evAfterHellfire = evaluateSelection(
      handWithMods.slice(0, 3), // 456m
      [],
      { tileMods: rChimera.state.tileMods, activeEquips: ['all_five_red'] },
    );
    expect(evAfterHellfire.redCount).toBe(0);
    expect(evAfterHellfire.goldCount).toBe(0);
    expect(evAfterHellfire.rainbowCount).toBe(0);

    // 4. 天災（cataclysm）：2.5倍ダメージ＋手牌すべて強制交換
    const dragonDef = {
      ...MONSTERS[9],
      weights: bossWeights,
      bossSkills: ['cataclysm'] as const,
      actionsPerTurn: 1,
    };
    const sDragon0 = newBattle(dragonDef, 104);
    const sDragon: BattleState = {
      ...sDragon0,
      player: { ...sDragon0.player, hp: 500, maxHp: 500 },
      hand: tiles('2m3m4m5p6p7p1s2s9s'),
    };
    const rDragon = step(sDragon, { type: 'attack', tiles: [sDragon.hand[0]], melds: [] });
    expect(rDragon.monsterTurnSteps![0].declareText).toContain('天災');
    expect(rDragon.monsterTurnSteps![0].events[0].amount).toBeGreaterThanOrEqual(
      Math.round(Math.floor(dragonDef.atk * 0.9) * 2.5),
    );
    expect(rDragon.state.hand).toHaveLength(9);
  });

  it('敵が「ためる」状態のときは次の行動が必ず「通常攻撃」になる', () => {
    const s0 = newBattle(MONSTERS[8], 77); // 多彩なスキルを持つ強敵
    const s: BattleState = {
      ...s0,
      hand: tiles('2m3m4m5p6p7p1s2s9s'),
      enemyBuffs: { ...s0.enemyBuffs, charged: true },
    };
    // 単牌1枚で攻撃して敵ターンへ進める
    const r = step(s, { type: 'attack', tiles: [s.hand[0]], melds: [] });
    expect(r.error).toBeUndefined();
    expect(r.monsterTurnSteps).toBeDefined();
    expect(r.monsterTurnSteps![0].declareText).toContain('通常攻撃');
    expect(r.state.enemyBuffs.charged).toBe(false);
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

    // 治療ONで攻撃 → 自分のHPが回復する（234m 567p = タンヤオ役成立時）
    const rHealOn = step(s, { type: 'toggle_heal' });
    expect(rHealOn.state.healMode).toBe(true);
    const rHealAtk = step(rHealOn.state, { type: 'attack', tiles: handTiles.slice(0, 6), melds: [] });
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

  it('雀剣士は役なし同牌セットでペア補充、麻雀医は役なし並びセットでHP10%回復＆2枚並び補充が発生する', () => {
    const s0 = newBattle(MONSTERS[7], 55, 'sword');
    // 雀剣士：同牌セットのみ（555p）→ 補充3枚のうち先頭2枚がペアになる
    const sKoutsu: BattleState = { ...s0, hand: tiles('555p123m789s') };
    const rK = step(sKoutsu, { type: 'attack', tiles: tiles('555p'), melds: [] });
    expect(rK.error).toBeUndefined();
    expect(rK.state.drawn).toHaveLength(3);
    expect(kindOf(rK.state.drawn[0])).toBe(kindOf(rK.state.drawn[1]));

    // 麻雀医：並びセットのみ（234m）→ HP10%回復し、補充3枚のうち先頭2枚が2枚並びになる
    const sShuntsu: BattleState = {
      ...s0,
      job: 'doctor',
      hand: tiles('234m555p789s'),
      player: { ...s0.player, hp: 50, maxHp: 200 },
      buffs: { ...s0.buffs, nullifyDamage: true },
    };
    const rS = step(sShuntsu, { type: 'attack', tiles: tiles('234m'), melds: [] });
    expect(rS.error).toBeUndefined();
    expect(rS.state.player.hp).toBe(70); // 50 + 200 * 0.10 = 70
    expect(rS.state.drawn).toHaveLength(3);
    const k0 = kindOf(rS.state.drawn[0]);
    const k1 = kindOf(rS.state.drawn[1]);
    expect(suitOf(k0)).toBe(suitOf(k1));
    expect(Math.abs(numOf(k0) - numOf(k1))).toBe(1);
  });

  it('リーチ中は通常最大3枚・雀老師は最大4枚まで入れ替え可能で、3セット完成時は「リーチ」役が成立する', () => {
    const s0 = newBattle(MONSTERS[7], 99, 'master');
    // 123m 456p 239s（9sを切って1s・4s待ちのリーチ）
    const handTiles = tiles('123m456p239s');
    // 山の末尾に無関係な字牌を置き、雀老師の1ターン4枚入れ替えを検証
    const wall = tiles('111222333444z');
    const s: BattleState = { ...s0, hand: handTiles, wall };

    // 1枚目（リーチ宣言時の捨て牌）
    const r1 = step(s, { type: 'riichi', discardTile: handTiles[8] });
    expect(r1.state.turn).toBe(1);
    expect(r1.state.riichiSwapsThisTurn).toBe(1);

    // 2枚目
    const r2 = step(r1.state, { type: 'attack', tiles: [r1.state.drawn[0]], melds: [] });
    expect(r2.state.turn).toBe(1);
    expect(r2.state.riichiSwapsThisTurn).toBe(2);

    // 3枚目（雀老師はまだターン1のまま！）
    const r3 = step(r2.state, { type: 'attack', tiles: [r2.state.drawn[0]], melds: [] });
    expect(r3.state.turn).toBe(1);
    expect(r3.state.riichiSwapsThisTurn).toBe(3);

    // 4枚目（4枚入れ替えたので敵行動が入りターン2へ進む）
    const r4 = step(r3.state, { type: 'attack', tiles: [r3.state.drawn[0]], melds: [] });
    expect(r4.state.turn).toBe(2);
    expect(r4.state.riichiSwapsThisTurn).toBe(0);

    // リーチ中に3セットが揃って攻撃すると「リーチ」役が成立し、他の役（平和など）とも複合する
    const completedHand = tiles('123m456p123s');
    const sComp: BattleState = { ...r4.state, hand: completedHand, riichi: true };
    const rComp = step(sComp, { type: 'attack', tiles: completedHand, melds: [] });
    expect(rComp.error).toBeUndefined();
    expect(rComp.state.yakuHistory.map((y) => y.id)).toEqual(
      expect.arrayContaining(['riichi', 'pinfu']),
    );
    expect(rComp.state.chain).toBeGreaterThanOrEqual(1);
  });

  it('銭とスコアの獲得・計算（役スコア序列・セット内特殊牌ボーナス・撃破報酬・ゲーム終了スコア）が機能する', () => {
    const sHaku = calcYakuScore(ev('555z').yaku[0]);
    const sRiichi = calcYakuScore(
      ev('123m456p789s', [], { riichi: true }).yaku.find((y) => y.id === 'riichi')!,
    );
    const sTanyao = calcYakuScore(ev('234m555p').yaku[0]);
    const sFourPairs = calcYakuScore(ev('11m33p55s77z').yaku[0]);
    const sPinfu = calcYakuScore(ev('123m456p789s').yaku[0]);
    const sDaisangen = calcYakuScore(ev('555666777z').yaku[0]);
    expect(sHaku).toBe(150);
    expect(sRiichi).toBe(150);
    expect(sHaku).toBeLessThan(sTanyao);
    expect(sTanyao).toBeLessThan(sFourPairs);
    expect(sFourPairs).toBeLessThan(sPinfu);
    expect(sPinfu).toBeLessThan(sDaisangen);

    // 役成立ごとの取得銭ボーナス（倍増後：1セット役100、2セット役250、四対子350、3セット役600、役満1000）
    expect(calcYakuMoneyBonus(ev('555z').yaku[0])).toBe(100);
    expect(calcYakuMoneyBonus(ev('234m555p').yaku[0])).toBe(250);
    expect(calcYakuMoneyBonus(ev('11m33p55s77z').yaku[0])).toBe(350);
    expect(calcYakuMoneyBonus(ev('123m456p789s').yaku[0])).toBe(600);
    expect(calcYakuMoneyBonus(ev('555666777z').yaku[0])).toBe(1000);

    const s0 = newBattle(MONSTERS[0], 123);
    const attackTiles = tiles('555666777z'); // 大三元（役満ご祝儀 +1000銭）
    const s: BattleState = {
      ...s0,
      hand: attackTiles,
      tileMods: {
        [attackTiles[0]]: 'gold', // セット内：+30銭
        [attackTiles[1]]: 'red', // セット内：+50銭
        [attackTiles[2]]: 'rainbow', // セット内：+100銭
      },
      equipments: ['unlock_tanyao'], // 招財の算盤（1役につき+60銭）
    };

    const r = step(s, { type: 'attack', tiles: attackTiles, melds: [] });
    expect(r.error).toBeUndefined();
    // 金(30) + 赤(50) + 虹(100) + 役満祝儀(1000) + 招財の算盤(60) + ステージ1撃破(100) = 1340銭
    expect(r.state.money).toBe(1340);

    const sc = calculateScore(r.state);
    expect(sc.yakuScore).toBe(5000);
    expect(sc.totalScore).toBeGreaterThan(5000);
    expect(sc.bonusMoneyFromScore).toBeGreaterThan(0);
  });
});
