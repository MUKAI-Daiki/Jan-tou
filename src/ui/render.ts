import {
  BattleState,
  SHOP_ATK_UP_COST,
  SHOP_HP_UP_COST,
  buildScoreContext,
  calculateScore,
  countActiveEquip,
  getActiveEquips,
  getRiichiMaxSwaps,
  hasAnyPlayerDebuff,
  wallCounts,
} from '../core/battle';
import {
  canDeclareRiichi,
  findRiichiDiscards,
  getRiichiWaits,
  hasThreeSets,
  kanCandidates,
} from '../core/mentsu';
import {
  AttackEval,
  calcSingleTilePower,
  effectiveTileMod,
  findBestYakuCombo,
  getYakuGuideHighlights,
} from '../core/score';
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
import {
  JOBS,
  JobId,
  RARITY_LABEL,
  getEquipment,
  getEquipmentBuyPrice,
  getEquipmentSellPrice,
  getJobDef,
} from '../data/equipments';
import { MAX_STAGE, MONSTERS } from '../data/monsters';

export interface UiState {
  selectedJob: JobId;
  selected: Set<TileId>;
  selectedMelds: Set<number>;
  /** 複製・サーチ用に選択された手牌ID（順序保持用） */
  selectionOrder: TileId[];
  /** 複製待機モードかどうか */
  copyMode?: boolean;
  /** サーチ待機モードかどうか */
  searchMode: boolean;
  /** サーチで残り牌から先に選択した牌種 */
  searchPickedKind?: Kind | null;
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
  ev?: AttackEval;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function tileHtml(
  kind: Kind,
  attrs = '',
  cls = '',
  opts: {
    mod?: TileMod;
    power?: number;
    sealed?: number;
    isTsumo?: boolean;
    yakuGuide?: boolean;
  } = {},
): string {
  const f = tileFace(kind);
  const s = suitOf(kind);
  const honorCls = s === 'z' ? ` h${kind - 26}` : '';
  const modCls = opts.mod && opts.mod !== 'normal' ? ` mod-${opts.mod}` : '';
  const sealCls = opts.sealed && opts.sealed > 0 ? ' tile-sealed' : '';
  const guideCls = opts.yakuGuide ? ' tile-yaku-guide' : '';
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
  const guideBadge = opts.yakuGuide ? '<span class="yguide-badge">役</span>' : '';

  return `<div class="tile s-${s}${honorCls}${modCls}${sealCls}${guideCls} ${cls}" ${attrs}>
    ${modBadge}${sealBadge}${guideBadge}
    <span class="t">${f.top}</span>${f.bottom ? `<span class="b">${f.bottom}</span>` : ''}
    ${pwrBadge}
  </div>`;
}

function hpBar(hp: number, max: number, cls: string): string {
  const pct = Math.max(0, Math.min(100, (hp / Math.max(1, max)) * 100));
  return `<div class="hpbar ${cls}"><div class="fill" style="width:${pct}%"></div>
    <span class="hptext">HP ${hp.toLocaleString()} / ${max.toLocaleString()}</span></div>`;
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
      <div class="y-perm">🌟 永続強化：${esc(y.permEffect)}</div>
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

export function renderTitle(showYakuModal = false, selectedJob: JobId = 'sword'): string {
  const jobCards = JOBS.map((j) => {
    const active = j.id === selectedJob ? ' active' : '';
    return `<button class="job-card${active}" data-job="${j.id}">
      <div class="job-head">
        <span class="job-icon">${j.icon}</span>
        <span class="job-name">${esc(j.name)}</span>
      </div>
      <div class="job-desc">${esc(j.detailDesc)}</div>
    </button>`;
  }).join('');

  const cards = MONSTERS.map(
    (m) => `<button class="monster-card" data-monster="${m.id}">
      <div class="rank">${esc(m.rank)}</div>
      <div class="mname">${esc(m.name)}</div>
      <div class="mhp">HP ${m.hp.toLocaleString()} / 攻撃 ${m.atk}</div>
    </button>`,
  ).join('');
  const curJob = getJobDef(selectedJob);
  return `<main class="title">
    <h1>雀闘<span class="kari">：改</span></h1>
    <p class="sub">牌を束ね、役とチェーンで${MAX_STAGE}連戦を勝ち抜け。</p>
    <h2>1. 職業を選択（現在：${curJob.icon}${esc(curJob.name)}）</h2>
    <div class="job-grid">${jobCards}</div>
    <div class="start-hero">
      <button class="btn-start-main" data-monster="${MONSTERS[0].id}">${curJob.icon}${esc(curJob.name)}で${MAX_STAGE}連戦を開始</button>
      <button class="btn-yaku" data-action="open-yaku">役・効果一覧</button>
    </div>
    <section class="rules">
      <ul>
        <li><b>基本ルール</b>：全34種136枚・手牌9枚。<b>役なし攻撃は3枚まで</b>、<b>役攻撃時は役に絡む牌のみ</b>選択可能。</li>
        <li><b>役選択ガイド</b>：手牌で役が作れる牌には<b>「役」マーク</b>が表示され、クリックすると<b>役を構成する候補牌を自動選択</b>！</li>
        <li><b>役成立の特権</b>：役成立で固有効果＆<b>チェーン（連続攻撃）</b>発生に加え、<b>多額の銭</b>と<b>役に合わせた永続ステータス強化</b>を獲得！</li>
        <li><b>特殊牌と商店</b>：<b>金牌</b>（威力+50%）・<b>赤牌</b>（金効果＋同種攻撃+5永続）・<b>虹牌</b>（威力2倍＆チェーン+2）は<b>セット内に組み込むと発動</b>し<b>銭</b>も獲得。3試合ごとに<b>商店</b>で<b>ステータス永続強化・装備売買・HP回復</b>が可能。</li>
        <li><b>カン・リーチ</b>：同種4枚で<b>カン</b>（金牌1枚補充、2セット役以上で使用可）。あと1枚で3セット揃う時は<b>リーチ</b>可（毎ターン最大3枚入替［雀老師は4枚＆被ダメ半減］・完成で<b>リーチ役</b>成立）。</li>
      </ul>
    </section>
    <h2>2. ステージを選択して開始</h2>
    <div class="monsters">${cards}</div>
    ${showYakuModal ? renderYakuModal() : ''}
  </main>`;
}

function renderBuffBadges(s: BattleState): string {
  const badges: string[] = [];
  const b = s.buffs;
  if (s.riichi) {
    badges.push(
      s.job === 'master'
        ? '<span class="badge buff">リーチ(被ダメ半減)</span>'
        : '<span class="badge buff">リーチ中</span>',
    );
  }
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
  if (eb.charged) badges.push('<span class="badge debuff">ためる(次通常3倍)</span>');
  if (eb.defendTurns > 0) badges.push(`<span class="badge debuff">防御(${eb.defendTurns}T)</span>`);
  if (eb.reflectTurns > 0) badges.push(`<span class="badge debuff">反射(${eb.reflectTurns}T)</span>`);
  return badges.join('');
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
    ui.isEnemyTurnAnimating ||
    ui.isEnemyDefeatAnimating
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
  const nextNote =
    s.stage % 3 === 0 && s.stage < MAX_STAGE
      ? '装備を1つ選ぶと「商店」へ入ります。'
      : `装備を1つ選んで第${s.stage + 1}戦へ進みます。`;
  return `<div class="overlay">
    <div class="reward-modal">
      <h2>ステージ ${s.stage} クリア！ 報酬選択</h2>
      <p class="reward-sub">${nextNote}</p>
      <div class="equip-choices">${cards}</div>
    </div>
  </div>`;
}

function renderShopModal(s: BattleState, ui: UiState): string {
  if (
    s.status !== 'shop' ||
    ui.isEnemyTurnAnimating ||
    ui.isEnemyDefeatAnimating
  ) {
    return '';
  }
  const buyCards =
    s.shopItems.length === 0
      ? '<p class="muted-note">購入可能な装備はすべて売り切れました。</p>'
      : s.shopItems
          .map((id) => {
            const eq = getEquipment(id);
            const price = getEquipmentBuyPrice(eq.rarity);
            const canBuy = s.money >= price;
            return `<button class="equip-card rarity-${eq.rarity}${canBuy ? '' : ' shop-disabled'}" data-shop-buy="${esc(
              eq.id,
            )}" ${canBuy ? '' : 'disabled'}>
              <div class="eq-rarity">${esc(RARITY_LABEL[eq.rarity])} ｜ 💰 ${price.toLocaleString()} 銭</div>
              <div class="eq-name">${esc(eq.name)}</div>
              <div class="eq-desc">${esc(eq.desc)}</div>
            </button>`;
          })
          .join('');

  const canBuyHpUp = s.money >= SHOP_HP_UP_COST;
  const groups: TileGroup[] = ['m', 'p', 's', 'wind', 'dragon'];
  const atkUpgradeButtons = groups
    .map((g) => {
      const cur = s.bonusTileAtk?.[g] ?? 0;
      const canBuyAtk = s.money >= SHOP_ATK_UP_COST;
      return `<button class="shop-upgrade-btn${canBuyAtk ? '' : ' shop-disabled'}" data-shop-atk="${g}" ${
        canBuyAtk ? '' : 'disabled'
      }>
        <span class="up-title">⚔️ ${esc(TILE_GROUP_LABEL[g])} 攻撃+2</span>
        <span class="up-sub">現在 +${cur} → <b>+${cur + 2}</b> ｜ 💰 ${SHOP_ATK_UP_COST.toLocaleString()} 銭</span>
      </button>`;
    })
    .join('');

  const healAmount = Math.max(1, Math.round(s.player.maxHp * 0.3));
  const canHeal = !s.shopHealUsed && s.money >= 1000 && s.player.hp < s.player.maxHp;
  const healLabel = s.shopHealUsed
    ? '🍵 HP 30%回復（購入済み）'
    : s.player.hp >= s.player.maxHp
      ? '🍵 HP 30%回復（HP満タン）'
      : `🍵 HP 30%回復（+${healAmount} HP ／ 1,000 銭）`;

  const sellList =
    s.equipments.length === 0
      ? '<span class="muted-note">売却できる所持装備がありません</span>'
      : s.equipments
          .map((id, idx) => {
            const eq = getEquipment(id);
            const sellPrice = getEquipmentSellPrice(eq.rarity);
            return `<button class="shop-sell-pill rarity-${eq.rarity}" data-shop-sell="${idx}" title="${esc(
              eq.desc,
            )}">
              <span>${esc(eq.name)}</span>
              <span class="sell-price">売却 +${sellPrice.toLocaleString()}銭</span>
            </button>`;
          })
          .join('');

  return `<div class="overlay">
    <div class="reward-modal shop-modal">
      <div class="shop-header">
        <div>
          <h2>🏮 雀闘商店（第${s.stage}戦突破）</h2>
          <p class="reward-sub">銭を使ってステータス永続強化・装備売買・HP回復ができます。</p>
        </div>
        <div class="shop-status">
          <span class="money-badge">💰 ${s.money.toLocaleString()} 銭</span>
          <span class="shop-hp-badge">❤️ HP ${s.player.hp.toLocaleString()} / ${s.player.maxHp.toLocaleString()}</span>
        </div>
      </div>

      ${ui.message ? `<div class="shop-msg">⚠️ ${esc(ui.message)}</div>` : ''}

      <div class="shop-section">
        <div class="shop-sec-title">💪 ステータス永続強化（何回でも購入可）</div>
        <div class="shop-upgrade-grid">
          <button class="shop-upgrade-btn hp-up-btn${canBuyHpUp ? '' : ' shop-disabled'}" data-action="shop-buy-hp" ${
            canBuyHpUp ? '' : 'disabled'
          }>
            <span class="up-title">❤️ 最大HP ＋100</span>
            <span class="up-sub">${s.player.maxHp} → <b>${s.player.maxHp + 100}</b>（HPも+100）｜ 💰 ${SHOP_HP_UP_COST.toLocaleString()} 銭</span>
          </button>
          ${atkUpgradeButtons}
        </div>
      </div>

      <div class="shop-section">
        <div class="shop-sec-title">🛒 装備ラインナップ（クリックで購入）</div>
        <div class="equip-choices shop-grid">${buyCards}</div>
      </div>

      <div class="shop-section shop-service-row">
        <div class="shop-sec-title">🍵 養生サービス（1回のみ）</div>
        <button class="btn-shop-heal" data-action="shop-heal" ${canHeal ? '' : 'disabled'}>${healLabel}</button>
      </div>

      <div class="shop-section">
        <div class="shop-sec-title">💰 所持装備の売却（クリックで買値の半額で売却）</div>
        <div class="shop-sell-list">${sellList}</div>
      </div>

      <div class="shop-footer">
        <button class="btn-start-main" data-action="leave-shop">第${s.stage + 1}戦へ進む</button>
      </div>
    </div>
  </div>`;
}

function renderWallModal(s: BattleState, ui: UiState): string {
  const counts = wallCounts(s);
  const canSearchClick =
    ui.searchMode &&
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
          ? `<div class="search-modal-banner">${
              ui.selected.size === 1
                ? '入れ替えたい残り牌をクリック'
                : 'サーチ対象（手に入れたい残り牌）をクリック'
            }</div>`
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
  const scoreCtx = buildScoreContext(s);

  const isSpecialSelectMode = Boolean(ui.riichiSelectMode || ui.copyMode || ui.searchMode);
  const { guideTiles, guideMelds } = !isSpecialSelectMode
    ? getYakuGuideHighlights(s.hand, s.melds, scoreCtx)
    : { guideTiles: new Set<TileId>(), guideMelds: new Set<number>() };

  const hasCurrentYaku = Boolean(preview.ev && preview.ev.yaku.length > 0);
  const isNoYakuFull = Boolean(
    !hasCurrentYaku &&
      !s.riichi &&
      ui.selected.size + ui.selectedMelds.size * 3 >= 3,
  );

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
      const isSelected = ui.selectedMelds.has(i);
      const isGuide = guideMelds.has(i);
      const sel = isSelected ? ' selected' : '';
      const guideCls = isGuide ? ' meld-yaku-guide' : '';
      const tiles = m.tiles
        .map((t, j) => {
          const mod = effectiveTileMod(t, s.tileMods, activeEquips);
          const pwr = calcSingleTilePower(m.kind, activeEquips, s.bonusTileAtk);
          return j === 0 || j === 3
            ? tileHtml(m.kind, '', 'back', { mod, power: pwr })
            : tileHtml(m.kind, '', '', { mod, power: pwr, yakuGuide: isGuide && j === 1 });
        })
        .join('');
      return `<div class="meld${sel}${guideCls}" data-meld="${i}" title="キープしたカン（2セット役以上で使用可）">${tiles}</div>`;
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
      const isSelected = ui.selected.has(t);
      const isGuide = guideTiles.has(t);

      // 現在の選択状態から追加選択不可かどうかを判定
      let isLimitDisabled = false;
      if (!isSpecialSelectMode && !isSelected && sealed === 0 && !s.riichi) {
        if (hasCurrentYaku || isNoYakuFull) {
          const canExtendYaku =
            findBestYakuCombo(
              s.hand,
              s.melds,
              scoreCtx,
              new Set([...ui.selected, t]),
              ui.selectedMelds,
            ) !== null;
          if (!canExtendYaku) {
            isLimitDisabled = true;
          }
        }
      }

      const riichiCls = validRiichiDiscards
        ? validRiichiDiscards.has(t)
          ? 'riichi-candidate'
          : 'riichi-disabled'
        : '';
      const cls = [
        isSelected ? 'selected' : '',
        isNew ? 'new' : '',
        isNew && ui.drawAnimActive ? 'draw-in' : '',
        isSeparatedTsumo ? 'tsumo-gap' : '',
        riichiCls,
        isLimitDisabled ? 'tile-limit-disabled' : '',
        (ui.copyMode && orderIdx === 0) || (orderIdx === 0 && ui.selectionOrder.length === 2)
          ? 'copy-target'
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      return tileHtml(k, `data-tile="${t}"`, cls, {
        mod,
        power: pwr,
        sealed,
        isTsumo: isNew,
        yakuGuide: isGuide,
      });
    })
    .join('');

  const isModalBlockedByAnim = Boolean(
    ui.isEnemyTurnAnimating || ui.isEnemyDefeatAnimating,
  );

  // 装備スキルの表示判定（現在使用可能なもののみ表示）
  const hasHealSkill = countActiveEquip(s, 'unlock_heal') > 0;
  const hasResetWallSkill = countActiveEquip(s, 'skill_reset_wall') > 0;
  const hasCopySkill = countActiveEquip(s, 'skill_copy') > 0;
  const hasSearchSkill = countActiveEquip(s, 'skill_search') > 0;

  const canUseSkillsNow = !isModalBlockedByAnim && !s.riichi && !ui.riichiSelectMode && s.status === 'playing';
  const canToggleHealNow = canUseSkillsNow && hasHealSkill;
  const canResetWallNow = canUseSkillsNow && hasResetWallSkill && s.cooldowns.resetWall === 0;
  const canCopyNow = canUseSkillsNow && hasCopySkill && s.cooldowns.copy === 0;
  const canSearchNow = canUseSkillsNow && hasSearchSkill && s.cooldowns.search === 0;
  const hasAnyUsableSkill = canToggleHealNow || canResetWallNow || canCopyNow || canSearchNow;

  const canAutoSelectYaku =
    !isModalBlockedByAnim &&
    !s.riichi &&
    !isSpecialSelectMode &&
    (guideTiles.size > 0 || guideMelds.size > 0) &&
    ui.selected.size === 0 &&
    ui.selectedMelds.size === 0;

  const canClearSelection =
    !isModalBlockedByAnim &&
    !s.riichi &&
    !ui.riichiSelectMode &&
    !ui.copyMode &&
    !ui.searchMode &&
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
          <p>到達ステージ: ${s.stage} / ${MAX_STAGE} ｜ 残りHP ${s.player.hp.toLocaleString()} / ${s.player.maxHp.toLocaleString()}</p>
          <div class="score-breakdown">
            <table>
              <tbody>
                <tr><th>勝ち抜きステージ（${sc.stagesCleared}戦${s.status === 'won' ? '＋全制覇' : ''}）</th><td>+${sc.stageScore.toLocaleString()} pt</td></tr>
                <tr><th>永続攻撃強化（合計+${sc.permAtkTotal}）</th><td>+${sc.permScore.toLocaleString()} pt</td></tr>
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
                getRiichiMaxSwaps(s),
                s.riichiSwapsThisTurn + 1,
              )}/${getRiichiMaxSwaps(s)})</span>`
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
              : ui.copyMode || ui.searchMode
                ? '<button class="btn-clear" data-action="cancel-skill-mode">戻る</button>'
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
                    canAutoSelectYaku
                      ? '<button class="btn-yaku" data-action="select-best-yaku">🌟 役候補を自動選択</button>'
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
                  ? `<button class="btn-skill ${ui.copyMode ? 'active' : ''}" data-action="skill-copy">複製</button>`
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

    <section class="player${playerHit}">
      <div class="player-head">
        <span>${getJobDef(s.job).icon}${esc(getJobDef(s.job).name)}</span>
        <span class="money-badge">💰 ${s.money.toLocaleString()} 銭</span>
      </div>
      ${hpBar(s.player.hp, s.player.maxHp, 'player-hp')}
      <div class="equip-bar">
        <span class="equip-label">所持装備：</span>
        <div class="equip-list">${equipBadges}</div>
      </div>
    </section>
    ${renderRewardModal(s, ui)}
    ${renderShopModal(s, ui)}
    ${result}
    ${ui.logOpen ? renderLogModal(s) : ''}
    ${ui.showWallModal ? renderWallModal(s, ui) : ''}
    ${ui.showYakuModal ? renderYakuModal(s) : ''}
  </main>`;
}

export {
  buildScoreContext,
  canDeclareRiichi,
  findRiichiDiscards,
  getRiichiWaits,
  hasAnyPlayerDebuff,
  hasThreeSets,
  kanCandidates,
  kindName,
};
