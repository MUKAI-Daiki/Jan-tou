import {
  BattleState,
  buildScoreContext,
  countActiveEquip,
  getActiveEquips,
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
import { EXP_PER_LEVEL, MAX_STAGE, MONSTERS } from '../data/monsters';

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
  /** 現在の攻撃・被弾演出フェーズ */
  combatPhase: 'idle' | 'player' | 'monster';
  message: string;
  showYakuModal?: boolean;
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
  const tsumoBadge = opts.isTsumo ? '<span class="tbadge">自摸</span>' : '';

  return `<div class="tile s-${s}${honorCls}${modCls}${sealCls} ${cls}" ${attrs}>
    ${modBadge}${sealBadge}${tsumoBadge}
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

  const rows = YAKU_CATALOG.map(
    (y) => `<tr class="${y.highTier ? 'yakuman-row' : ''}">
      <td class="y-name">${esc(y.name)}</td>
      <td class="y-scope">${esc(y.scope)}</td>
      <td class="y-han">${esc(y.effect)}</td>
      <td class="y-desc">
        <div>${esc(y.desc)}</div>
        ${renderExampleTiles(y.example)}
      </td>
    </tr>`,
  ).join('');
  return `<div class="overlay" data-action="close-yaku">
    <div class="yaku-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>役と効果一覧（具体例つき）</h2>
        <button class="btn-clear btn-sm" data-action="close-yaku">閉じる</button>
      </div>
      ${currentHandBar}
      <div class="yaku-table-wrap">
        <table class="yaku-table">
          <thead>
            <tr><th>役名</th><th>区分</th><th>効果・チェーン</th><th>条件・具体例</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
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
    <p class="sub">牌を束ね、役の効果とチェーンで8連戦を勝ち抜け。</p>
    <div class="start-hero">
      <button class="btn-start-main" data-monster="${MONSTERS[0].id}">8連戦を開始する（第1戦〜）</button>
      <button class="btn-yaku" data-action="open-yaku">📖 役と効果一覧を見る</button>
    </div>
    <section class="rules">
      <ul>
        <li><b>全34種136枚</b>を使用。手牌は9枚。「打牌」はなく、<b>任意の枚数の牌を選んで「攻撃」</b>し、使った枚数だけ補充される。</li>
        <li><b>牌の攻撃力とセットボーナス</b>：1・9・字牌は<b>10</b>、2〜8はその数字。セットが含まれるとボーナス加算（<b>同牌セット+20 ／ 並びセット+10 ／ ペア+5 ／ カン+30＆基礎攻撃+50%</b>）。</li>
        <li><b>役とチェーン</b>：攻撃に「役」が含まれると固有の<b>効果</b>が発動し、<b>チェーン（連続攻撃）</b>が発生！チェーン中はダメージに <b>×(Chain数＋1)</b> の補正がかかる。</li>
        <li><b>特殊牌</b>：<b>金牌</b>は1枚ごとに最終ダメージ<b>+50%</b>。<b>赤牌</b>は金牌効果＋役攻撃で経験値ボーナス。<b>虹牌</b>はセットに含めると最終ダメージ<b>2倍＆チェーン+2</b>。</li>
        <li><b>カン・リーチ・マリガン</b>：同種4枚で<b>カン</b>（キープ＋金牌1枚補充、2セット役以上で使用可）。あと1枚で3セットが揃う時は捨て牌を1枚選んで<b>リーチ</b>宣言可（右端の自摸牌をオート自摸切り、完成攻撃で威力2倍＆チェーン可）。1ターン目に1・9・字牌が6枚以上なら<b>マリガン</b>（手牌総入れ替え・2回まで）可能。</li>
        <li><b>8連戦・成長・装備</b>：与ダメージ＋被ダメージがそのまま経験値になり、500EXPごとにレベルアップ（最大HP+10%・HP30%回復）。勝利ごとに3択の<b>ユニーク装備</b>を獲得し、手牌・持続効果・残り牌を次の戦いへ持ち越す！</li>
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
  if (s.riichi) badges.push('<span class="badge buff">リーチ宣言中</span>');
  if (s.healMode) badges.push('<span class="badge buff">治療モードON</span>');
  if (b.nullifyDamage) badges.push('<span class="badge buff">白障壁(次ダメージ無効)</span>');
  if (b.sanankouTurns > 0) badges.push(`<span class="badge buff">三暗刻:威力3倍(${b.sanankouTurns}T)</span>`);
  if (b.honiisouTurns > 0) badges.push(`<span class="badge buff">混一色:字牌金化(${b.honiisouTurns}T)</span>`);
  if (b.pinfuTurns > 0) badges.push(`<span class="badge buff">平和:自動回復(${b.pinfuTurns}T)</span>`);
  if (b.chinroutouTurns > 0) badges.push(`<span class="badge buff">清老頭:2-8補充(${b.chinroutouTurns}T)</span>`);
  if (b.chiniisouTurns > 0 && b.chiniisouSuit) {
    badges.push(`<span class="badge buff">清一色:${suitName(b.chiniisouSuit)}補充(${b.chiniisouTurns}T)</span>`);
  }
  if (s.expMult > 1) badges.push(`<span class="badge buff">経験値×${s.expMult}</span>`);

  if (b.sealYakuTurns > 0) badges.push(`<span class="badge debuff">役封印(${b.sealYakuTurns}T)</span>`);
  if (b.atkDownTurns > 0) badges.push(`<span class="badge debuff">攻撃力-10(${b.atkDownTurns}T)</span>`);
  if (b.slowTurns > 0) badges.push(`<span class="badge debuff">鈍化:チェーン完全封じ(${b.slowTurns}T)</span>`);
  if (b.venomTurns > 0) badges.push(`<span class="badge debuff">猛毒:攻撃-20/HP-10%(${b.venomTurns}T)</span>`);
  return badges.join('');
}

function renderEnemyBuffBadges(s: BattleState): string {
  const eb = s.enemyBuffs;
  const badges: string[] = [];
  if (eb.charged) badges.push('<span class="badge debuff">ためる(次ダメージ3倍)</span>');
  if (eb.defendTurns > 0) badges.push(`<span class="badge debuff">防御:ダメージ半減(${eb.defendTurns}T)</span>`);
  if (eb.reflectTurns > 0) badges.push(`<span class="badge debuff">反射:半返し(${eb.reflectTurns}T)</span>`);
  return badges.join('');
}

function renderRewardModal(s: BattleState): string {
  if (s.status !== 'reward') return '';
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
      <h2>ステージ ${s.stage} クリア！ 報酬装備を選択</h2>
      <p class="reward-sub">未所持の装備から1つを選んで獲得し、手牌と状態を引き継いで第${s.stage + 1}戦へ進みます。</p>
      <div class="equip-choices">${cards}</div>
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
          e.type === 'heal' ? '+' : '-'
        }${e.amount.toLocaleString()}</div>`,
    )
    .join('');
  const monsterHit = v.events.some((e) => e.target === 'monster' && e.type === 'damage') ? ' hit' : '';
  const playerHit = v.events.some((e) => e.target === 'player' && e.type === 'damage') ? ' hit' : '';

  // 残り牌グリッド（全34種）
  const counts = wallCounts(s);
  const canSearchClick =
    ui.searchMode && ui.selected.size === 1 && countActiveEquip(s, 'skill_search') > 0 && s.cooldowns.search === 0;
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

  // キープしたカン
  const melds = s.melds
    .map((m, i) => {
      const sel = ui.selectedMelds.has(i) ? ' selected' : '';
      const tiles = m.tiles
        .map((t, j) => {
          const mod = effectiveTileMod(t, s.tileMods, activeEquips);
          const pwr = calcSingleTilePower(m.kind, activeEquips);
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
      const pwr = calcSingleTilePower(k, activeEquips);
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

  const log = s.log
    .slice(-80)
    .map((l) => `<li class="log-${l.side}">${esc(l.text)}</li>`)
    .join('');

  // 装備スキルの表示判定
  const hasHealSkill = countActiveEquip(s, 'unlock_heal') > 0;
  const hasResetWallSkill = countActiveEquip(s, 'skill_reset_wall') > 0;
  const hasCopySkill = countActiveEquip(s, 'skill_copy') > 0;
  const hasSearchSkill = countActiveEquip(s, 'skill_search') > 0;

  const canCopyNow = hasCopySkill && s.cooldowns.copy === 0 && ui.selectionOrder.length === 2;
  const canSearchNow = hasSearchSkill && s.cooldowns.search === 0 && ui.selected.size === 1;

  // 所持装備一覧
  const equipBadges =
    s.equipments.length === 0
      ? '<span class="muted-note">なし（バトル勝利で獲得）</span>'
      : s.equipments
          .map((id, idx) => {
            const eq = getEquipment(id);
            const isSealed = s.sealedEquipIndices.includes(idx);
            return `<span class="equip-pill rarity-${eq.rarity}${isSealed ? ' equip-sealed' : ''}" title="${esc(
              eq.desc,
            )}">${esc(eq.name)}${isSealed ? '(封)' : ''}</span>`;
          })
          .join('');

  const result =
    s.status === 'won' || s.status === 'lost'
      ? `<div class="overlay"><div class="result ${s.status}">
          <h2>${s.status === 'won' ? '全8連戦 制覇！！' : `第${s.stage}戦 敗北……`}</h2>
          <p>到達ステージ: ${s.stage} / ${MAX_STAGE} ｜ Lv.${s.player.level} ｜ 残りHP ${s.player.hp.toLocaleString()}</p>
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

  return `<main class="battle${phaseCls}">
    <section class="enemy${monsterHit}">
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
        <div class="live-text" id="live-log-text">${esc(ui.liveLogText)}</div>
        <button class="btn-clear btn-xs" data-action="toggle-log">
          📜 ログ履歴を${ui.logOpen ? '閉じる ▲' : '開く ▼'}（${s.log.length}）
        </button>
      </div>
      ${ui.logOpen ? `<ul class="log" id="log">${log}</ul>` : ''}
    </section>

    <section class="middle single-col">
      <div class="wall">
        <div class="panel-title">
          残り牌 ${s.wall.length}枚${s.resets > 0 ? `（山補充${s.resets}回）` : ''}
          ${
            canSearchClick
              ? '<span class="search-hint">【サーチ中：変化させたい残り牌をクリック！】</span>'
              : ''
          }
        </div>
        <div class="wall-grid">${wall}</div>
      </div>
    </section>

    <section class="table">
      <div class="status-line">
        <span>ターン ${s.turn}</span>
        <span class="${s.chain > 0 ? 'chain-active' : 'ready'}">Chain ${s.chain}（倍率 ×${chainMult}）</span>
        ${
          s.extraChains > 0
            ? `<span class="chain-stock">追加行動ストック: ${s.extraChains}</span>`
            : ''
        }
        ${
          riichiAutoRunning
            ? '<span class="riichi-auto-indicator">🔄 リーチ中：右端の自摸牌をオート自摸切り中…</span>'
            : ''
        }
        <div class="buff-row">${renderBuffBadges(s)}</div>
        <button class="btn-yaku btn-xs status-right" data-action="open-yaku">📖 役・効果一覧</button>
      </div>
      <div class="hand-row">
        <div class="hand">${hand}</div>
        ${melds ? `<div class="melds">${melds}</div>` : ''}
      </div>
      <div class="preview${preview.ev?.valid || preview.canConfirmRiichi ? ' ok' : ''}">
        <div>${esc(preview.text)}</div>
        ${preview.subText ? `<div class="preview-sub">${esc(preview.subText)}</div>` : ''}
      </div>
      ${ui.message ? `<div class="message">${esc(ui.message)}</div>` : ''}
      <div class="actions">
        ${
          ui.riichiSelectMode
            ? `<button class="btn-riichi" data-action="confirm-riichi" ${
                preview.canConfirmRiichi ? '' : 'disabled'
              }>🔥 この牌を切ってリーチ確定！</button>
              <button class="btn-clear" data-action="cancel-riichi-select">戻る</button>`
            : `<button class="btn-attack" data-action="attack" ${preview.canAttack ? '' : 'disabled'}>
                ${s.healMode ? '💚 治療攻撃（回復）' : '⚔️ 攻撃（破棄＆補充）'}
              </button>
              <button class="btn-kan" data-action="kan" ${preview.canKan ? '' : 'disabled'}>カン（4枚キープ）</button>
              ${
                s.riichi
                  ? '<button class="btn-cancel-riichi" data-action="cancel-riichi">🚫 リーチキャンセル（5T役封印）</button>'
                  : `<button class="btn-riichi" data-action="start-riichi-select" ${
                      preview.canRiichi ? '' : 'disabled'
                    }>リーチ宣言（捨て牌選択）</button>`
              }
              ${
                preview.canMulligan
                  ? `<button class="btn-mulligan" data-action="mulligan">マリガン（残り${2 - s.mulligansUsed}回）</button>`
                  : ''
              }
              <button class="btn-clear" data-action="select-all">全選択</button>
              <button class="btn-clear" data-action="clear">選択解除</button>
              <button class="btn-yaku" data-action="open-yaku">役一覧</button>`
        }
      </div>
      ${
        hasHealSkill || hasResetWallSkill || hasCopySkill || hasSearchSkill
          ? `<div class="skill-actions">
              <span class="skill-label">装備スキル：</span>
              ${
                hasHealSkill
                  ? `<button class="btn-skill ${s.healMode ? 'active' : ''}" data-action="toggle-heal">治療切替(${
                      s.healMode ? 'ON' : 'OFF'
                    })</button>`
                  : ''
              }
              ${
                hasResetWallSkill
                  ? `<button class="btn-skill" data-action="skill-reset-wall" ${
                      s.cooldowns.resetWall > 0 ? 'disabled' : ''
                    }>残り牌リセット${s.cooldowns.resetWall > 0 ? `(CT:${s.cooldowns.resetWall})` : ''}</button>`
                  : ''
              }
              ${
                hasCopySkill
                  ? `<button class="btn-skill" data-action="skill-copy" ${
                      canCopyNow ? '' : 'disabled'
                    } title="手牌を2枚選択（1枚目を2枚目と同じ牌に変化）">複製${
                      s.cooldowns.copy > 0 ? `(CT:${s.cooldowns.copy})` : '(手牌2枚選択)'
                    }</button>`
                  : ''
              }
              ${
                hasSearchSkill
                  ? `<button class="btn-skill ${ui.searchMode ? 'active' : ''}" data-action="skill-search" ${
                      canSearchNow ? '' : 'disabled'
                    } title="手牌を1枚選んで押し、上の残り牌をクリック">サーチ${
                      s.cooldowns.search > 0 ? `(CT:${s.cooldowns.search})` : '(手牌1枚選択)'
                    }</button>`
                  : ''
              }
            </div>`
          : ''
      }
    </section>

    <section class="player${playerHit}">
      <div class="player-head">
        <span>あなた（Lv.${s.player.level} ／ 攻撃補正 ×${(1 + s.player.level / 4).toFixed(2)}）</span>
        ${expBar(s.player.exp, EXP_PER_LEVEL)}
      </div>
      ${hpBar(s.player.hp, s.player.maxHp, 'player-hp')}
      <div class="equip-bar">
        <span class="equip-label">所持装備：</span>
        <div class="equip-list">${equipBadges}</div>
      </div>
      ${playerFx}
    </section>
    ${renderRewardModal(s)}
    ${result}
    ${ui.showYakuModal ? renderYakuModal(s) : ''}
  </main>`;
}

export {
  buildScoreContext,
  canDeclareRiichi,
  canMulliganHand,
  findRiichiDiscards,
  getRiichiWaits,
  hasThreeSets,
  kanCandidates,
  kindName,
};
