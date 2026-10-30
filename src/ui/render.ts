import {
  BattleState,
  buildScoreContext,
  calculateScore,
  countActiveEquip,
  getActiveEquips,
  hasAnyPlayerDebuff,
  isKindBanished,
  wallCounts,
} from '../core/battle';
import {
  canDeclareRiichi,
  canMulliganHand,
  findRiichiDiscards,
  getRiichiWaits,
  hasThreeSets,
  kanCandidates,
} from '../core/mentsu';
import { AttackEval, calcSingleTilePower, effectiveTileMod } from '../core/score';
import {
  ACTIVE_KINDS,
  Kind,
  TILE_GROUP_LABEL,
  TileGroup,
  TileId,
  TileMod,
  kindName,
  kindOf,
  sortTiles,
  suitName,
  suitOf,
  tileFace,
} from '../core/tile';
import { YAKU_CATALOG } from '../core/yaku';
import { RARITY_LABEL, getEquipment } from '../data/equipments';
import { MAX_STAGE, MONSTERS, expForNextLevel } from '../data/monsters';

export interface UiState {
  selected: Set<TileId>;
  selectedMelds: Set<number>;
  /** 複製・サーチ用に選択された手牌ID（順序保持用） */
  selectionOrder: TileId[];
  /** サーチ待機モードかどうか */
  searchMode: boolean;
  /** リーチ宣言時の捨て牌選択モードかどうか */
  riichiSelectMode: boolean;
  /** 過去ログを開いているかどうか */
  logOpen: boolean;
  /** 現在ライブ表示中のテキスト */
  liveLogText: string;
  liveLogSide: 'player' | 'monster' | 'system';
  /** 行移行時のスライドアニメーション状態 */
  liveLogTransition?: 'idle' | 'out' | 'in';
  /** 現在の攻撃・被弾演出フェーズ */
  combatPhase: 'idle' | 'player' | 'monster';
  /** 敵ターン演出の進行中かどうか */
  isEnemyTurnAnimating?: boolean;
  /** 補充牌のスライドイン＋フラッシュ演出中かどうか */
  drawAnimActive?: boolean;
  /** 敵撃破時の点滅→ダークアウト演出中かどうか */
  isEnemyDefeatAnimating?: boolean;
  /** レベルアップ時の発光＋「LV UP！」スライドイン演出中かどうか */
  isLevelUpAnimating?: boolean;
  /** レベルアップボーナス選択モーダルのサブ画面状態 */
  levelBonusStep?: 'root' | 'select_group' | 'select_kind';
  message: string;
  showYakuModal?: boolean;
  showWallModal?: boolean;
}

export interface BattleView {
  state: BattleState;
  ui: UiState;
  preview: Preview;
  events: BattleState['events'];
}

export interface Preview {
  text: string;
  subText?: string;
  canAttack: boolean;
  canGuard: boolean;
  canCure: boolean;
  guardAmount?: number;
  canKan: boolean;
  canRiichi: boolean;
  canConfirmRiichi: boolean;
  canMulligan: boolean;
  ev?: AttackEval;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function tileHtml(
  kind: Kind,
  attrs = '',
  cls = '',
  opts: { mod?: TileMod; power?: number; sealed?: number; isTsumo?: boolean } = {},
): string {
  const f = tileFace(kind);
  const s = suitOf(kind);
  const honorCls = s === 'z' ? ` h${kind - 26}` : '';
  const modCls = opts.mod && opts.mod !== 'normal' ? ` mod-${opts.mod}` : '';
  const sealCls = opts.sealed && opts.sealed > 0 ? ' tile-sealed' : '';
  const pwrBadge = opts.power !== undefined ? `<span class="pwr">${opts.power}</span>` : '';
  const modBadge =
    opts.mod === 'gold'
      ? '<span class="mbadge gold">金</span>'
      : opts.mod === 'red'
        ? '<span class="mbadge red">赤</span>'
        : opts.mod === 'rainbow'
          ? '<span class="mbadge rainbow">虹</span>'
          : '';
  const sealBadge =
    opts.sealed && opts.sealed > 0 ? `<span class="sbadge">封${opts.sealed}</span>` : '';

  return `<div class="tile s-${s}${honorCls}${modCls}${sealCls} ${cls}" ${attrs}>
    ${modBadge}${sealBadge}
    <span class="t">${f.top}</span>${f.bottom ? `<span class="b">${f.bottom}</span>` : ''}
    ${pwrBadge}
  </div>`;
}

function hpBar(hp: number, max: number, cls: string): string {
  const pct = Math.max(0, Math.min(100, (hp / Math.max(1, max)) * 100));
  return `<div class="hpbar ${cls}"><div class="fill" style="width:${pct}%"></div>
    <span class="hptext">HP ${hp.toLocaleString()} / ${max.toLocaleString()}</span></div>`;
}

function expBar(exp: number, max: number): string {
  const pct = Math.max(0, Math.min(100, (exp / Math.max(1, max)) * 100));
  return `<div class="expbar"><div class="fill" style="width:${pct}%"></div>
    <span class="exptext">EXP ${exp} / ${max}</span></div>`;
}

function renderExampleTiles(example: readonly (readonly Kind[])[]): string {
  const groups = example
    .map((m) => `<span class="yaku-mentsu">${m.map((k) => tileHtml(k, '', 'mini')).join('')}</span>`)
    .join('');
  return `<div class="yaku-example">${groups}</div>`;
}

function renderYakuModal(state?: BattleState): string {
  const equips = state ? getActiveEquips(state) : undefined;
  const currentHandBar = state
    ? `<div class="yaku-current-hand">
        <span class="yaku-hand-label">現在の手牌：</span>
        <div class="yaku-hand-tiles">
          ${sortTiles(state.hand)
            .map((t) =>
              tileHtml(kindOf(t), '', 'mini', {
                mod: effectiveTileMod(t, state.tileMods, equips),
              }),
            )
            .join('')}
        </div>
        ${
          state.melds.length > 0
            ? `<div class="yaku-hand-melds">${state.melds
                .map(
                  (m) =>
                    `<span class="yaku-mentsu">${m.tiles
                      .map((t, j) =>
                        j === 0 || j === 3
                          ? tileHtml(m.kind, '', 'mini back')
                          : tileHtml(m.kind, '', 'mini', {
                              mod: effectiveTileMod(t, state.tileMods, equips),
                            }),
                      )
                      .join('')}</span>`,
                )
                .join('')}</div>`
            : ''
        }
      </div>`
    : '';

  const cards = YAKU_CATALOG.map(
    (y) => `<div class="yaku-card${y.highTier ? ' yakuman-card' : ''}">
      <div class="y-card-head">
        <span class="y-name">${esc(y.name)}</span>
        <span class="y-scope">${esc(y.scope)}</span>
      </div>
      <div class="y-han">効果：${esc(y.effect)}</div>
      <div class="y-desc">条件：${esc(y.desc)}</div>
      ${renderExampleTiles(y.example)}
    </div>`,
  ).join('');
  return `<div class="overlay" data-action="close-yaku">
    <div class="yaku-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>役・効果一覧</h2>
        <button class="btn-clear btn-sm" data-action="close-yaku">閉じる</button>
      </div>
      ${currentHandBar}
      <div class="yaku-card-list">
        ${cards}
      </div>
    </div>
  </div>`;
}

export function renderTitle(showYakuModal = false): string {
  const cards = MONSTERS.map(
    (m) => `<button class="monster-card" data-monster="${m.id}">
      <div class="rank">${esc(m.rank)}</div>
      <div class="mname">${esc(m.name)}</div>
      <div class="mhp">HP ${m.hp.toLocaleString()} / 攻撃 ${m.atk}</div>
    </button>`,
  ).join('');
  return `<main class="title">
    <h1>雀闘<span class="kari">：改</span></h1>
    <p class="sub">牌を束ね、役とチェーンで${MAX_STAGE}連戦を勝ち抜け。</p>
    <div class="start-hero">
      <button class="btn-start-main" data-monster="${MONSTERS[0].id}">${MAX_STAGE}連戦を開始</button>
      <button class="btn-yaku" data-action="open-yaku">役・効果一覧</button>
    </div>
    <section class="rules">
      <ul>
        <li><b>基本ルール</b>：全34種136枚・手牌9枚。任意の枚数を選んで<b>攻撃</b>し、同数を補充する。</li>
        <li><b>攻撃力とセット強化</b>：1・9・字牌は<b>10</b>、2〜8はその数字。セット数に応じ最終威力<b>1.5倍／2倍／3倍</b>。役なしの<b>同牌セット</b>は基礎+50%＆ペア補充、<b>並びセット</b>はHP10%回復＆2枚並び補充。</li>
        <li><b>役とチェーン</b>：役成立で固有効果＆<b>チェーン（連続攻撃）</b>発生。役満以外の役はすべて複合、タンヤオも常時発動可。</li>
        <li><b>特殊牌と銭</b>：<b>金牌</b>（威力+50%）・<b>赤牌</b>（金効果＋同種攻撃+5永続）・<b>虹牌</b>（威力2倍＆チェーン+2）の使用や敵撃破・役満で<b>銭</b>を獲得。</li>
        <li><b>カン・リーチ</b>：同種4枚で<b>カン</b>（金牌1枚補充、2セット役以上で使用可）。あと1枚で3セット揃う時は<b>リーチ</b>可（被ダメ半減・毎ターン最大3枚入替・完成で<b>リーチ役</b>成立）。</li>
        <li><b>成長とスコア</b>：経験値でLvUP、勝利ごとに<b>ユニーク装備</b>を獲得。終了時に到達戦・Lv・成立役・装備から<b>最終スコア</b>を算出。</li>
      </ul>
    </section>
    <h2>ステージを選択して開始</h2>
    <div class="monsters">${cards}</div>
    ${showYakuModal ? renderYakuModal() : ''}
  </main>`;
}

function renderBuffBadges(s: BattleState): string {
  const badges: string[] = [];
  const b = s.buffs;
  if (s.riichi) badges.push('<span class="badge buff">リーチ(被ダメ半減)</span>');
  if (s.healMode) badges.push('<span class="badge buff">回復変換ON</span>');
  if (b.nullifyDamage) badges.push('<span class="badge buff">白障壁</span>');
  if (b.guardBarrier > 0) badges.push(`<span class="badge buff">ガード-${b.guardBarrier}</span>`);
  if (b.sanankouTurns > 0) badges.push(`<span class="badge buff">三暗刻(${b.sanankouTurns}T)</span>`);
  if (b.honiisouTurns > 0) badges.push(`<span class="badge buff">混一色(${b.honiisouTurns}T)</span>`);
  if (b.pinfuTurns > 0) badges.push(`<span class="badge buff">平和(${b.pinfuTurns}T)</span>`);
  if (b.chinroutouTurns > 0) badges.push(`<span class="badge buff">清老頭(${b.chinroutouTurns}T)</span>`);
  if (b.chiniisouTurns > 0 && b.chiniisouSuit) {
    badges.push(`<span class="badge buff">清一色:${suitName(b.chiniisouSuit)}(${b.chiniisouTurns}T)</span>`);
  }
  if (s.expMult > 1) badges.push(`<span class="badge buff">EXP×${s.expMult}</span>`);
  const groups: TileGroup[] = ['m', 'p', 's', 'wind', 'dragon'];
  for (const g of groups) {
    const val = s.bonusTileAtk?.[g] ?? 0;
    if (val > 0) {
      const shortLabel =
        g === 'm' ? '萬子' : g === 'p' ? '筒子' : g === 's' ? '索子' : g === 'wind' ? '風牌' : '三元牌';
      badges.push(`<span class="badge buff">${shortLabel}+${val}</span>`);
    }
  }

  if (b.sealYakuTurns > 0) badges.push(`<span class="badge debuff">役封印(${b.sealYakuTurns}T)</span>`);
  if (b.atkDownTurns > 0) badges.push(`<span class="badge debuff">攻撃-10(${b.atkDownTurns}T)</span>`);
  if (b.slowTurns > 0) badges.push(`<span class="badge debuff">鈍化(${b.slowTurns}T)</span>`);
  if (b.venomTurns > 0) badges.push(`<span class="badge debuff">猛毒(${b.venomTurns}T)</span>`);
  return badges.join('');
}

function renderEnemyBuffBadges(s: BattleState): string {
  const eb = s.enemyBuffs;
  const badges: string[] = [];
  if (eb.charged) badges.push('<span class="badge debuff">ためる(次3倍)</span>');
  if (eb.defendTurns > 0) badges.push(`<span class="badge debuff">防御(${eb.defendTurns}T)</span>`);
  if (eb.reflectTurns > 0) badges.push(`<span class="badge debuff">反射(${eb.reflectTurns}T)</span>`);
  return badges.join('');
}

function renderLevelUpModal(s: BattleState, ui: UiState): string {
  if (
    s.pendingLevelUps <= 0 ||
    s.status === 'lost' ||
    ui.isEnemyTurnAnimating ||
    ui.isEnemyDefeatAnimating ||
    ui.isLevelUpAnimating
  ) {
    return '';
  }
  const step = ui.levelBonusStep ?? 'root';
  const remNote = s.pendingLevelUps > 1 ? `（残${s.pendingLevelUps}回）` : '';

  if (step === 'select_group') {
    const groupDefs: { group: TileGroup; samples: Kind[] }[] = [
      { group: 'm', samples: [0, 4, 8] },
      { group: 'p', samples: [9, 13, 17] },
      { group: 's', samples: [18, 22, 26] },
      { group: 'wind', samples: [27, 28, 29, 30] },
      { group: 'dragon', samples: [31, 32, 33] },
    ];
    const cards = groupDefs
      .map(({ group, samples }) => {
        const cur = s.bonusTileAtk?.[group] ?? 0;
        const sampleHtml = samples.map((k) => tileHtml(k, '', 'mini')).join('');
        return `<button class="equip-card rarity-uncommon" data-level-group="${group}">
          <div class="eq-rarity">強化値: +${cur} → <b>+${cur + 2}</b></div>
          <div class="eq-name">${esc(TILE_GROUP_LABEL[group])} 攻撃+2</div>
          <div class="yaku-example">${sampleHtml}</div>
        </button>`;
      })
      .join('');

    return `<div class="overlay">
      <div class="reward-modal levelup-modal">
        <div class="yaku-modal-head">
          <h2>攻撃+2にする牌種を選択${remNote}</h2>
          <button class="btn-clear btn-sm" data-action="level-bonus-back">戻る</button>
        </div>
        <p class="reward-sub">選んだ牌種の基礎攻撃力が永続+2されます。</p>
        <div class="equip-choices">${cards}</div>
      </div>
    </div>`;
  }

  if (step === 'select_kind') {
    const counts = wallCounts(s);
    const wall = ACTIVE_KINDS.map((k) => {
      const c = counts[k];
      const banished = isKindBanished(s, k);
      const attr = banished ? '' : `data-level-banish-kind="${k}"`;
      const cls = banished ? ' empty banished-cell' : ' searchable';
      return `<div class="wall-cell${cls}" ${attr}>
        ${tileHtml(k, '', 'mini')}
        <span class="cnt">${banished ? '封鎖済' : `残${c}→0`}</span>
      </div>`;
    }).join('');

    return `<div class="overlay">
      <div class="wall-modal levelup-modal">
        <div class="yaku-modal-head">
          <h2>残り牌を0にする牌を選択${remNote}</h2>
          <button class="btn-clear btn-sm" data-action="level-bonus-back">戻る</button>
        </div>
        <p class="reward-sub">選んだ牌の残り牌数が永続0になります。</p>
        <div class="wall-grid">${wall}</div>
      </div>
    </div>`;
  }

  return `<div class="overlay">
    <div class="reward-modal levelup-modal">
      <h2>Lv.${s.player.level} 能力アップ選択${remNote}</h2>
      <p class="reward-sub">強化ボーナスを1つ選択してください。</p>
      <div class="equip-choices">
        <button class="equip-card rarity-uncommon" data-action="level-bonus-hp">
          <div class="eq-rarity">耐久強化</div>
          <div class="eq-name">最大HP＋20</div>
          <div class="eq-desc">最大HPと現在HPを+20（${s.player.maxHp} → ${s.player.maxHp + 20}）</div>
        </button>
        <button class="equip-card rarity-rare" data-action="level-bonus-group-menu">
          <div class="eq-rarity">火力強化</div>
          <div class="eq-name">特定牌種の攻撃＋2</div>
          <div class="eq-desc">1種類の牌の基礎攻撃力を永続+2</div>
        </button>
        <button class="equip-card rarity-legend" data-action="level-bonus-kind-menu">
          <div class="eq-rarity">山圧縮</div>
          <div class="eq-name">残り牌1種を永続0に</div>
          <div class="eq-desc">選んだ牌1種の残り牌を永続0にする</div>
        </button>
      </div>
    </div>
  </div>`;
}

function renderLogModal(s: BattleState): string {
  const log = s.log
    .slice(-100)
    .map((l) => `<li class="log-${l.side}">${esc(l.text)}</li>`)
    .join('');
  return `<div class="overlay" data-action="toggle-log">
    <div class="wall-modal log-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>ログ履歴（${s.log.length}件）</h2>
        <button class="btn-clear btn-sm" data-action="toggle-log">閉じる</button>
      </div>
      <ul class="log" id="log">${log}</ul>
    </div>
  </div>`;
}

function renderRewardModal(s: BattleState, ui: UiState): string {
  if (
    s.status !== 'reward' ||
    s.pendingLevelUps > 0 ||
    ui.isEnemyTurnAnimating ||
    ui.isEnemyDefeatAnimating ||
    ui.isLevelUpAnimating
  ) {
    return '';
  }
  const cards = s.rewardChoices
    .map((id) => {
      const eq = getEquipment(id);
      return `<button class="equip-card rarity-${eq.rarity}" data-reward="${esc(eq.id)}">
        <div class="eq-rarity">${esc(RARITY_LABEL[eq.rarity])}</div>
        <div class="eq-name">${esc(eq.name)}</div>
        <div class="eq-desc">${esc(eq.desc)}</div>
      </button>`;
    })
    .join('');
  return `<div class="overlay">
    <div class="reward-modal">
      <h2>ステージ ${s.stage} クリア！ 報酬選択</h2>
      <p class="reward-sub">装備を1つ選んで第${s.stage + 1}戦へ進みます。</p>
      <div class="equip-choices">${cards}</div>
    </div>
  </div>`;
}

function renderWallModal(s: BattleState, ui: UiState): string {
  const counts = wallCounts(s);
  const canSearchClick =
    ui.searchMode &&
    ui.selected.size === 1 &&
    countActiveEquip(s, 'skill_search') > 0 &&
    s.cooldowns.search === 0;
  const wall = ACTIVE_KINDS.map((k) => {
    const c = counts[k];
    const searchAttr = canSearchClick && c > 0 ? `data-search-kind="${k}"` : '';
    const searchCls = canSearchClick && c > 0 ? ' searchable' : '';
    return `<div class="wall-cell${c === 0 ? ' empty' : ''}${searchCls}" ${searchAttr}>${tileHtml(
      k,
      '',
      'mini',
    )}<span class="cnt">${c}</span></div>`;
  }).join('');

  return `<div class="overlay" data-action="close-wall">
    <div class="wall-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>残り牌（${s.wall.length}枚${s.resets > 0 ? `／補充${s.resets}回` : ''}）</h2>
        <button class="btn-clear btn-sm" data-action="close-wall">閉じる</button>
      </div>
      ${
        canSearchClick
          ? '<div class="search-modal-banner">入れ替えたい牌をクリック</div>'
          : ''
      }
      <div class="wall-grid">${wall}</div>
    </div>
  </div>`;
}

export function renderBattle(v: BattleView): string {
  const s = v.state;
  const { ui, preview } = v;
  const activeEquips = getActiveEquips(s);

  const monsterFx = v.events
    .filter((e) => e.target === 'monster')
    .map(
      (e) =>
        `<div class="popup ${e.type === 'heal' ? 'heal-popup' : 'dmg-monster'}">${
          e.type === 'heal' ? '+' : '-'
        }${e.amount.toLocaleString()}</div>`,
    )
    .join('');
  const playerFx = v.events
    .filter((e) => e.target === 'player')
    .map(
      (e) =>
        `<div class="popup ${e.type === 'heal' ? 'heal-popup' : 'dmg-player'}">${
          e.type === 'heal' ? '+' : ''
        }${e.amount.toLocaleString()}</div>`,
    )
    .join('');
  const monsterHit = v.events.some((e) => e.target === 'monster' && e.type === 'damage') ? ' hit' : '';
  const playerHit = v.events.some((e) => e.target === 'player' && e.type === 'damage') ? ' hit' : '';

  // キープしたカン
  const melds = s.melds
    .map((m, i) => {
      const sel = ui.selectedMelds.has(i) ? ' selected' : '';
      const tiles = m.tiles
        .map((t, j) => {
          const mod = effectiveTileMod(t, s.tileMods, activeEquips);
          const pwr = calcSingleTilePower(m.kind, activeEquips, s.bonusTileAtk);
          return j === 0 || j === 3
            ? tileHtml(m.kind, '', 'back', { mod, power: pwr })
            : tileHtml(m.kind, '', '', { mod, power: pwr });
        })
        .join('');
      return `<div class="meld${sel}" data-meld="${i}" title="キープしたカン（2セット役以上で使用可）">${tiles}</div>`;
    })
    .join('');

  // 手牌描画：
  // リーチ中は固定された手牌を左側に理牌し、自摸した1枚(s.drawn[0])はソートせず必ず右端に独立表示する！
  const drawnSet = new Set(s.drawn);
  const validRiichiDiscards = ui.riichiSelectMode
    ? new Set(findRiichiDiscards(s.hand, s.melds))
    : null;

  let orderedHand: TileId[];
  let separatedTsumoTile: TileId | undefined;
  if (s.riichi && s.drawn.length === 1 && s.hand.includes(s.drawn[0])) {
    separatedTsumoTile = s.drawn[0];
    orderedHand = [...sortTiles(s.hand.filter((t) => t !== separatedTsumoTile)), separatedTsumoTile];
  } else {
    orderedHand = sortTiles(s.hand);
  }

  const hand = orderedHand
    .map((t) => {
      const k = kindOf(t);
      const mod = effectiveTileMod(t, s.tileMods, activeEquips);
      const pwr = calcSingleTilePower(k, activeEquips, s.bonusTileAtk);
      const sealed = s.sealedTiles[t] ?? 0;
      const orderIdx = ui.selectionOrder.indexOf(t);
      const isNew = drawnSet.has(t);
      const isSeparatedTsumo = t === separatedTsumoTile;
      const riichiCls = validRiichiDiscards
        ? validRiichiDiscards.has(t)
          ? 'riichi-candidate'
          : 'riichi-disabled'
        : '';
      const cls = [
        ui.selected.has(t) ? 'selected' : '',
        isNew ? 'new' : '',
        isNew && ui.drawAnimActive ? 'draw-in' : '',
        isSeparatedTsumo ? 'tsumo-gap' : '',
        riichiCls,
        orderIdx === 0 && ui.selectionOrder.length === 2 ? 'copy-target' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return tileHtml(k, `data-tile="${t}"`, cls, {
        mod,
        power: pwr,
        sealed,
        isTsumo: isNew,
      });
    })
    .join('');

  const isModalBlockedByAnim = Boolean(
    ui.isEnemyTurnAnimating || ui.isEnemyDefeatAnimating || ui.isLevelUpAnimating,
  );

  // 装備スキルの表示判定（現在使用可能なもののみ表示）
  const hasHealSkill = countActiveEquip(s, 'unlock_heal') > 0;
  const hasResetWallSkill = countActiveEquip(s, 'skill_reset_wall') > 0;
  const hasCopySkill = countActiveEquip(s, 'skill_copy') > 0;
  const hasSearchSkill = countActiveEquip(s, 'skill_search') > 0;

  const canUseSkillsNow = !isModalBlockedByAnim && !s.riichi && !ui.riichiSelectMode && s.status === 'playing';
  const canToggleHealNow = canUseSkillsNow && hasHealSkill;
  const canResetWallNow = canUseSkillsNow && hasResetWallSkill && s.cooldowns.resetWall === 0;
  const canCopyNow = canUseSkillsNow && hasCopySkill && s.cooldowns.copy === 0 && ui.selectionOrder.length === 2;
  const canSearchNow = canUseSkillsNow && hasSearchSkill && s.cooldowns.search === 0 && ui.selected.size === 1;
  const hasAnyUsableSkill = canToggleHealNow || canResetWallNow || canCopyNow || canSearchNow;

  const playableHandCount = s.hand.filter((t) => !(s.sealedTiles[t] > 0)).length;
  const canSelectAll =
    !isModalBlockedByAnim &&
    !s.riichi &&
    !ui.riichiSelectMode &&
    playableHandCount > 0 &&
    (ui.selected.size < playableHandCount || ui.selectedMelds.size < s.melds.length);
  const canClearSelection =
    !isModalBlockedByAnim &&
    !s.riichi &&
    !ui.riichiSelectMode &&
    (ui.selected.size > 0 || ui.selectedMelds.size > 0);

  // 所持装備一覧
  const equipBadges =
    s.equipments.length === 0
      ? '<span class="muted-note">なし</span>'
      : s.equipments
          .map((id, idx) => {
            const eq = getEquipment(id);
            const isSealed = s.sealedEquipIndices.includes(idx);
            return `<span class="equip-pill rarity-${eq.rarity}${isSealed ? ' equip-sealed' : ''}" title="${esc(
              eq.desc,
            )}">${esc(eq.name)}${isSealed ? '(封)' : ''}</span>`;
          })
          .join('');

  const sc =
    !isModalBlockedByAnim && (s.status === 'won' || s.status === 'lost') ? calculateScore(s) : null;
  const result = sc
    ? `<div class="overlay"><div class="result ${s.status}">
          <h2>${s.status === 'won' ? `全${MAX_STAGE}連戦 制覇！！` : `第${s.stage}戦 敗北……`}</h2>
          <p>到達ステージ: ${s.stage} / ${MAX_STAGE} ｜ Lv.${s.player.level} ｜ 残りHP ${s.player.hp.toLocaleString()}</p>
          <div class="score-breakdown">
            <table>
              <tbody>
                <tr><th>勝ち抜きステージ（${sc.stagesCleared}戦${s.status === 'won' ? '＋全制覇' : ''}）</th><td>+${sc.stageScore.toLocaleString()} pt</td></tr>
                <tr><th>到達レベル（Lv.${s.player.level}）</th><td>+${sc.levelScore.toLocaleString()} pt</td></tr>
                <tr><th>成立させた役（計${sc.yakuCount}回）</th><td>+${sc.yakuScore.toLocaleString()} pt</td></tr>
                <tr><th>所持装備（計${sc.equipCount}個）</th><td>+${sc.equipScore.toLocaleString()} pt</td></tr>
                <tr class="score-total-row"><th>🏆 最終スコア</th><td>${sc.totalScore.toLocaleString()} pt</td></tr>
              </tbody>
            </table>
            <div class="money-summary">
              <span>スコアボーナス: <b>+${sc.bonusMoneyFromScore.toLocaleString()} 銭</b></span>
              <span>💰 総獲得銭: <b>${s.money.toLocaleString()} 銭</b></span>
            </div>
          </div>
          <div class="result-actions">
            <button data-action="retry">第1戦から再挑戦</button>
            <button data-action="title">タイトルへ戻る</button>
          </div>
        </div></div>`
    : '';

  const chainMult = (s.chain + 1) * (s.chain > 0 ? s.nextChainMult : 1);
  const riichiAutoRunning = s.riichi && !hasThreeSets(s.hand, s.melds) && s.status === 'playing';
  const liveIcon =
    ui.liveLogSide === 'monster' ? '👾' : ui.liveLogSide === 'player' ? '⚔️' : '📢';
  const phaseCls =
    ui.combatPhase === 'player'
      ? ' phase-player'
      : ui.combatPhase === 'monster'
        ? ' phase-monster'
        : '';
  const phaseBanner =
    ui.combatPhase === 'player'
      ? '<span class="phase-tag player-tag">⚔️ プレイヤーの攻撃！</span>'
      : ui.combatPhase === 'monster'
        ? '<span class="phase-tag monster-tag">👾 敵の攻撃・被弾！</span>'
        : '';
  const enemyDefeatCls = ui.isEnemyDefeatAnimating
    ? ' enemy-defeating'
    : s.monster.hp <= 0
      ? ' enemy-darkout'
      : '';
  const playerLvUpCls = ui.isLevelUpAnimating ? ' player-levelup' : '';
  const lvUpBanner = ui.isLevelUpAnimating
    ? '<div class="lvup-banner"><span class="lvup-text">LV UP！</span></div>'
    : '';

  return `<main class="battle${phaseCls}">
    <section class="enemy${monsterHit}${enemyDefeatCls}">
      <div class="enemy-head">
        <span class="stage-badge">STAGE ${s.stage} / ${MAX_STAGE}</span>
        <span class="rank">${esc(s.monster.def.rank)}</span>
        <span class="mname">${esc(s.monster.def.name)}</span>
        <span class="matk">基礎攻撃力 ${s.monster.def.atk}</span>
        ${phaseBanner}
        <div class="buff-row">${renderEnemyBuffBadges(s)}</div>
      </div>
      ${hpBar(s.monster.hp, s.monster.maxHp, 'enemy-hp')}
      ${monsterFx}
    </section>

    <section class="live-log-section side-${ui.liveLogSide}">
      <div class="live-log-bar">
        <span class="live-icon">${liveIcon}</span>
        <div class="live-text-viewport">
          <div class="live-text${
            ui.liveLogTransition === 'out'
              ? ' slide-out'
              : ui.liveLogTransition === 'in'
                ? ' slide-in'
                : ''
          }" id="live-log-text">${esc(ui.liveLogText)}</div>
        </div>
        <button class="btn-clear btn-xs" data-action="toggle-log">
          📜 ログ（${s.log.length}）
        </button>
      </div>
    </section>

    <section class="table">
      <div class="status-line">
        <span>ターン ${s.turn}</span>
        <span class="${s.chain > 0 ? 'chain-active' : 'ready'}">Chain ${s.chain}（×${chainMult}）</span>
        ${
          s.extraChains > 0
            ? `<span class="chain-stock">ストック:${s.extraChains}</span>`
            : ''
        }
        ${
          riichiAutoRunning
            ? `<span class="riichi-auto-indicator">リーチ入替(${Math.min(
                3,
                s.riichiSwapsThisTurn + 1,
              )}/3)</span>`
            : ''
        }
        <div class="buff-row">${renderBuffBadges(s)}</div>
        <div class="status-right">
          <button class="btn-wall btn-xs" data-action="open-wall">残り牌(${s.wall.length})</button>
          <button class="btn-yaku btn-xs" data-action="open-yaku">役一覧</button>
        </div>
      </div>
      <div class="preview${preview.ev?.valid || preview.canConfirmRiichi ? ' ok' : ''}">
        <div class="preview-main">${esc(ui.message ? `⚠️ ${ui.message}` : preview.text)}</div>
        <div class="preview-sub">${esc(preview.subText ?? '')}</div>
      </div>
      <div class="actions">
        ${
          isModalBlockedByAnim
            ? ''
            : ui.riichiSelectMode
              ? `${
                  preview.canConfirmRiichi
                    ? '<button class="btn-riichi" data-action="confirm-riichi">リーチ確定</button>'
                    : ''
                }
                <button class="btn-clear" data-action="cancel-riichi-select">戻る</button>`
              : `${
                  preview.canAttack
                    ? `<button class="btn-attack" data-action="attack">${
                        s.healMode ? '回復攻撃' : '攻撃'
                      }</button>`
                    : ''
                }
                ${
                  preview.canGuard
                    ? '<button class="btn-guard" data-action="guard">ガード</button>'
                    : ''
                }
                ${
                  preview.canCure
                    ? '<button class="btn-cure" data-action="cure-debuff">治療</button>'
                    : ''
                }
                ${
                  preview.canKan
                    ? '<button class="btn-kan" data-action="kan">カン</button>'
                    : ''
                }
                ${
                  s.riichi
                    ? '<button class="btn-cancel-riichi" data-action="cancel-riichi">リーチ解除</button>'
                    : preview.canRiichi
                      ? '<button class="btn-riichi" data-action="start-riichi-select">リーチ</button>'
                      : ''
                }
                ${
                  preview.canMulligan
                    ? '<button class="btn-mulligan" data-action="mulligan">マリガン</button>'
                    : ''
                }
                ${
                  canSelectAll
                    ? '<button class="btn-clear" data-action="select-all">全選択</button>'
                    : ''
                }
                ${
                  canClearSelection
                    ? '<button class="btn-clear" data-action="clear">選択解除</button>'
                    : ''
                }`
        }
      </div>
      ${
        hasAnyUsableSkill
          ? `<div class="skill-actions">
              <span class="skill-label">スキル：</span>
              ${
                canToggleHealNow
                  ? `<button class="btn-skill ${s.healMode ? 'active' : ''}" data-action="toggle-heal">回復変換:${
                      s.healMode ? 'ON' : 'OFF'
                    }</button>`
                  : ''
              }
              ${
                canResetWallNow
                  ? '<button class="btn-skill" data-action="skill-reset-wall">山リセット</button>'
                  : ''
              }
              ${
                canCopyNow
                  ? '<button class="btn-skill" data-action="skill-copy">複製</button>'
                  : ''
              }
              ${
                canSearchNow
                  ? `<button class="btn-skill ${ui.searchMode ? 'active' : ''}" data-action="skill-search">サーチ</button>`
                  : ''
              }
            </div>`
          : ''
      }
      <div class="hand-row${playerHit}">
        <div class="hand">${hand}</div>
        ${melds ? `<div class="melds">${melds}</div>` : ''}
        ${playerFx}
      </div>
    </section>

    <section class="player${playerHit}${playerLvUpCls}">
      <div class="player-head">
        <span>あなた（Lv.${s.player.level} ／ 攻撃補正 ×${(1 + s.player.level / 4).toFixed(2)}）</span>
        <span class="money-badge">💰 ${s.money.toLocaleString()} 銭</span>
        ${expBar(s.player.exp, expForNextLevel(s.player.level))}
      </div>
      ${hpBar(s.player.hp, s.player.maxHp, 'player-hp')}
      <div class="equip-bar">
        <span class="equip-label">所持装備：</span>
        <div class="equip-list">${equipBadges}</div>
      </div>
      ${lvUpBanner}
    </section>
    ${renderLevelUpModal(s, ui)}
    ${renderRewardModal(s, ui)}
    ${result}
    ${ui.logOpen ? renderLogModal(s) : ''}
    ${ui.showWallModal ? renderWallModal(s, ui) : ''}
    ${ui.showYakuModal ? renderYakuModal(s) : ''}
  </main>`;
}

export {
  buildScoreContext,
  canDeclareRiichi,
  canMulliganHand,
  findRiichiDiscards,
  getRiichiWaits,
  hasAnyPlayerDebuff,
  hasThreeSets,
  kanCandidates,
  kindName,
};
