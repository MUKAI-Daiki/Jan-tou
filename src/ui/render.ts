import { BattleState, wallCounts } from '../core/battle';
import { AttackEval } from '../core/score';
import { ACTIVE_KINDS, Kind, TileId, kindOf, sortTiles, suitOf, tileFace } from '../core/tile';
import { YAKU_CATALOG } from '../core/yaku';
import { MONSTERS } from '../data/monsters';

export interface UiState {
  selected: Set<TileId>;
  selectedMelds: Set<number>;
  message: string;
  showYakuModal?: boolean;
}

export interface BattleView {
  state: BattleState;
  ui: UiState;
  preview: Preview;
  /** 今回の描画で表示する演出（1回だけ） */
  events: BattleState['events'];
}

export interface Preview {
  text: string;
  canAttack: boolean;
  canDiscard: boolean;
  canKan: boolean;
  ev?: AttackEval;
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function tileHtml(kind: Kind, attrs = '', cls = ''): string {
  const f = tileFace(kind);
  const s = suitOf(kind);
  const honorCls = s === 'z' ? ` h${kind - 26}` : '';
  return `<div class="tile s-${s}${honorCls} ${cls}" ${attrs}><span class="t">${f.top}</span>${
    f.bottom ? `<span class="b">${f.bottom}</span>` : ''
  }</div>`;
}

function hpBar(hp: number, max: number, cls: string): string {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  return `<div class="hpbar ${cls}"><div class="fill" style="width:${pct}%"></div>
    <span class="hptext">${hp.toLocaleString()} / ${max.toLocaleString()}</span></div>`;
}

function renderExampleTiles(example: readonly (readonly Kind[])[]): string {
  const groups = example
    .map((m) => `<span class="yaku-mentsu">${m.map((k) => tileHtml(k, '', 'mini')).join('')}</span>`)
    .join('');
  return `<div class="yaku-example">${groups}</div>`;
}

function renderYakuModal(state?: BattleState): string {
  const currentHandBar = state
    ? `<div class="yaku-current-hand">
        <span class="yaku-hand-label">現在の手牌：</span>
        <div class="yaku-hand-tiles">
          ${sortTiles(state.hand)
            .map((t) => tileHtml(kindOf(t), '', 'mini'))
            .join('')}
        </div>
        ${
          state.melds.length > 0
            ? `<div class="yaku-hand-melds">${state.melds
                .map(
                  (m) =>
                    `<span class="yaku-mentsu">${m.tiles
                      .map((_, j) =>
                        j === 0 || j === 3 ? tileHtml(m.kind, '', 'mini back') : tileHtml(m.kind, '', 'mini'),
                      )
                      .join('')}</span>`,
                )
                .join('')}</div>`
            : ''
        }
      </div>`
    : '';

  const rows = YAKU_CATALOG.map(
    (y) => `<tr class="${y.yakuman ? 'yakuman-row' : ''}">
      <td class="y-name">${esc(y.name)}</td>
      <td class="y-han">${esc(y.hanText)}</td>
      <td class="y-scope">${esc(y.scope)}</td>
      <td class="y-desc">
        <div>${esc(y.desc)}</div>
        ${renderExampleTiles(y.example)}
      </td>
    </tr>`,
  ).join('');
  return `<div class="overlay" data-action="close-yaku">
    <div class="yaku-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>実装されている役一覧（具体例つき）</h2>
        <button class="btn-clear btn-sm" data-action="close-yaku">閉じる</button>
      </div>
      ${currentHandBar}
      <div class="yaku-table-wrap">
        <table class="yaku-table">
          <thead>
            <tr><th>役名</th><th>翻数</th><th>成立条件</th><th>説明・具体例</th></tr>
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
      <div class="mhp">HP ${m.hp.toLocaleString()}</div>
    </button>`,
  ).join('');
  return `<main class="title">
    <h1>雀闘<span class="kari">：仮</span></h1>
    <p class="sub">面子を揃えて、役で殴れ。</p>
    <section class="rules">
      <ul>
        <li>使用牌は<b>筒子・索子・三元牌（白發中）</b>の21種84枚（萬子・風牌は不使用）。</li>
        <li>基本手牌は<b>8枚</b>（自模を含めて9枚）。毎ターン1枚自模り、1枚捨てる。捨てるたびにモンスターが攻撃してくる。</li>
        <li>面子（順子・刻子・槓子）または<b>七対子（対子4組）</b>を選んで<b>攻撃</b>。2〜3面子なら役が必要で、翻数に応じて満貫（8,000）〜役満（32,000）のダメージを与える。</li>
        <li>4翻以下は 4 × 符 × 2<sup>翻+2</sup>（100点単位で切り上げ、8,000上限）。5翻＝満貫(8,000)、6〜7翻＝跳満(12,000)、8〜10翻＝倍満(16,000)、11〜12翻＝三倍満(24,000)、13翻〜＝役満(32,000)。さらに<b>面子数ボーナス（1面子:×1 ／ 2面子:×2 ／ 3面子・七対子:×3）</b>が掛かる。</li>
        <li>攻撃で捨てた枚数だけ即座に補充され、<b>1ターンに何度でも連続攻撃（Chain）が可能</b>。攻撃するたびにChain数が1増え、ダメージに <b>×(Chain数＋1)</b> の補正がかかる。</li>
        <li>4枚揃えば暗槓して1枚補充できる。副露した槓子は単独では攻撃できない（役牌は除く）。</li>
      </ul>
      <div class="rules-footer">
        <button class="btn-yaku btn-sm" data-action="open-yaku">役一覧（具体例つき）を見る</button>
      </div>
    </section>
    <h2>対戦相手を選ぶ</h2>
    <div class="monsters">${cards}</div>
    ${showYakuModal ? renderYakuModal() : ''}
  </main>`;
}

export function renderBattle(v: BattleView): string {
  const s = v.state;
  const { ui, preview } = v;

  const monsterFx = v.events
    .filter((e) => e.target === 'monster')
    .map((e) => `<div class="popup dmg-monster">-${e.amount.toLocaleString()}</div>`)
    .join('');
  const playerFx = v.events
    .filter((e) => e.target === 'player')
    .map((e) => `<div class="popup dmg-player">-${e.amount.toLocaleString()}</div>`)
    .join('');
  const monsterHit = v.events.some((e) => e.target === 'monster') ? ' hit' : '';
  const playerHit = v.events.some((e) => e.target === 'player') ? ' hit' : '';

  // 残り牌
  const counts = wallCounts(s);
  const wall = ACTIVE_KINDS.map((k) => {
    const c = counts[k];
    return `<div class="wall-cell${c === 0 ? ' empty' : ''}">${tileHtml(k, '', 'mini')}<span class="cnt">${c}</span></div>`;
  }).join('');

  // 副露
  const melds = s.melds
    .map((m, i) => {
      const sel = ui.selectedMelds.has(i) ? ' selected' : '';
      const tiles = m.tiles
        .map((_, j) => (j === 0 || j === 3 ? tileHtml(m.kind, '', 'back') : tileHtml(m.kind)))
        .join('');
      return `<div class="meld${sel}" data-meld="${i}">${tiles}</div>`;
    })
    .join('');

  // 手牌
  const drawn = new Set(s.drawn);
  const hand = sortTiles(s.hand)
    .map((t) => {
      const cls = [ui.selected.has(t) ? 'selected' : '', drawn.has(t) ? 'new' : ''].join(' ');
      return tileHtml(kindOf(t), `data-tile="${t}"`, cls);
    })
    .join('');

  const log = s.log
    .slice(-60)
    .map((l) => `<li class="log-${l.side}">${esc(l.text)}</li>`)
    .join('');

  const result =
    s.status === 'playing'
      ? ''
      : `<div class="overlay"><div class="result ${s.status}">
          <h2>${s.status === 'won' ? '勝利！' : '敗北……'}</h2>
          <p>${s.turn} ターン / 残りHP ${s.player.hp.toLocaleString()}</p>
          <div class="result-actions">
            <button data-action="retry">もう一度</button>
            <button data-action="title">対戦相手を選ぶ</button>
          </div>
        </div></div>`;

  return `<main class="battle">
    <section class="enemy${monsterHit}">
      <div class="enemy-head">
        <span class="rank">${esc(s.monster.def.rank)}</span>
        <span class="mname">${esc(s.monster.def.name)}</span>
      </div>
      ${hpBar(s.monster.hp, s.monster.def.hp, 'enemy-hp')}
      ${monsterFx}
    </section>

    <section class="middle">
      <div class="wall">
        <div class="panel-title">残り牌 ${s.wall.length}枚${s.resets > 0 ? `（リセット${s.resets}回）` : ''}</div>
        <div class="wall-grid">${wall}</div>
      </div>
      <ul class="log" id="log">${log}</ul>
    </section>

    <section class="table">
      <div class="status-line">
        <span>ターン ${s.turn}</span>
        <span class="${s.chain > 0 ? 'chain-active' : 'ready'}">Chain ${s.chain}（ダメージ ×${s.chain + 1}）</span>
        <button class="btn-yaku btn-xs status-right" data-action="open-yaku">役一覧</button>
      </div>
      <div class="hand-row">
        <div class="hand">${hand}</div>
        ${melds ? `<div class="melds">${melds}</div>` : ''}
      </div>
      <div class="preview${preview.ev?.valid ? ' ok' : ''}">${esc(preview.text)}</div>
      ${ui.message ? `<div class="message">${esc(ui.message)}</div>` : ''}
      <div class="actions">
        <button class="btn-attack" data-action="attack" ${preview.canAttack ? '' : 'disabled'}>攻撃</button>
        <button class="btn-discard" data-action="discard" ${preview.canDiscard ? '' : 'disabled'}>打牌</button>
        <button class="btn-kan" data-action="kan" ${preview.canKan ? '' : 'disabled'}>暗槓</button>
        <button class="btn-clear" data-action="clear">選択解除</button>
        <button class="btn-yaku" data-action="open-yaku">役一覧</button>
      </div>
    </section>

    <section class="player${playerHit}">
      <div class="player-head">あなた</div>
      ${hpBar(s.player.hp, s.player.maxHp, 'player-hp')}
      ${playerFx}
    </section>
    ${result}
    ${ui.showYakuModal ? renderYakuModal(s) : ''}
  </main>`;
}

