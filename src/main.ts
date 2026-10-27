import './ui/style.css';
import { Action, BattleState, LogEntry, buildScoreContext, newBattle, step } from './core/battle';
import {
  canDeclareRiichi,
  canMulliganHand,
  findRiichiDiscards,
  getRiichiWaits,
  hasThreeSets,
  kanCandidates,
} from './core/mentsu';
import { randomSeed } from './core/rng';
import { evaluateSelection } from './core/score';
import { kindName, kindOf } from './core/tile';
import { MONSTERS, MonsterDef } from './data/monsters';
import { Preview, UiState, renderBattle, renderTitle } from './ui/render';

const app = document.getElementById('app')!;

let screen: 'title' | 'battle' = 'title';
let state: BattleState | null = null;
let pendingEvents: BattleState['events'] = [];
let autoRiichiTimer: number | null = null;
let typewriterTimer: number | null = null;
let phaseResetTimer: number | null = null;
let logQueue: LogEntry[] = [];

const ui: UiState = {
  selected: new Set(),
  selectedMelds: new Set(),
  selectionOrder: [],
  searchMode: false,
  riichiSelectMode: false,
  combatPhase: 'idle',
  logOpen: false,
  liveLogText: '',
  liveLogSide: 'system',
  message: '',
};

function stopAutoRiichiTimer() {
  if (autoRiichiTimer !== null) {
    window.clearTimeout(autoRiichiTimer);
    autoRiichiTimer = null;
  }
}

function stopTypewriter() {
  if (typewriterTimer !== null) {
    window.clearTimeout(typewriterTimer);
    typewriterTimer = null;
  }
  if (phaseResetTimer !== null) {
    window.clearTimeout(phaseResetTimer);
    phaseResetTimer = null;
  }
}

function syncCombatPhaseDom() {
  const battleEl = document.querySelector<HTMLElement>('main.battle');
  if (!battleEl) return;
  battleEl.classList.remove('phase-player', 'phase-monster');
  if (ui.combatPhase === 'player') battleEl.classList.add('phase-player');
  if (ui.combatPhase === 'monster') battleEl.classList.add('phase-monster');
}

function enqueueLogs(entries: LogEntry[]) {
  if (entries.length === 0) return;
  stopTypewriter();
  logQueue = [...entries];
  playNextLogInQueue();
}

function playNextLogInQueue() {
  if (logQueue.length === 0) return;
  const entry = logQueue.shift()!;
  ui.liveLogSide = entry.side;
  ui.liveLogText = '';
  if (entry.side === 'player') {
    ui.combatPhase = 'player';
  } else if (entry.side === 'monster') {
    ui.combatPhase = 'monster';
  }
  syncCombatPhaseDom();

  const chars = [...entry.text];
  let idx = 0;

  // アイコンと色クラスを反映
  const sectionEl = document.querySelector<HTMLElement>('.live-log-section');
  if (sectionEl) {
    sectionEl.className = `live-log-section side-${ui.liveLogSide}`;
  }
  const iconEl = document.querySelector<HTMLElement>('.live-icon');
  if (iconEl) {
    iconEl.textContent =
      ui.liveLogSide === 'monster' ? '👾' : ui.liveLogSide === 'player' ? '⚔️' : '📢';
  }

  const tick = () => {
    idx++;
    ui.liveLogText = chars.slice(0, idx).join('');
    const el = document.getElementById('live-log-text');
    if (el) el.textContent = ui.liveLogText;

    if (idx < chars.length) {
      typewriterTimer = window.setTimeout(tick, 22);
    } else if (logQueue.length > 0) {
      typewriterTimer = window.setTimeout(playNextLogInQueue, 340);
    } else {
      typewriterTimer = null;
      phaseResetTimer = window.setTimeout(() => {
        phaseResetTimer = null;
        ui.combatPhase = 'idle';
        syncCombatPhaseDom();
      }, 650);
    }
  };
  tick();
}

function clearSelection() {
  ui.selected.clear();
  ui.selectedMelds.clear();
  ui.selectionOrder = [];
  ui.searchMode = false;
  ui.riichiSelectMode = false;
}

function selectAllPlayableTiles(s: BattleState) {
  clearSelection();
  for (const t of s.hand) {
    if (!(s.sealedTiles[t] > 0)) {
      ui.selected.add(t);
      ui.selectionOrder.push(t);
    }
  }
  for (let i = 0; i < s.melds.length; i++) {
    ui.selectedMelds.add(i);
  }
}

function checkAndScheduleAutoRiichi() {
  stopAutoRiichiTimer();
  if (!state || screen !== 'battle' || state.status !== 'playing' || !state.riichi) {
    return;
  }

  // 3セットが揃った場合はオート自摸切りを止め、全選択してプレイヤーに攻撃を促す
  if (hasThreeSets(state.hand, state.melds)) {
    if (ui.selected.size === 0 && ui.selectedMelds.size === 0) {
      selectAllPlayableTiles(state);
      render();
    }
    return;
  }

  // まだ3セットが揃っていない場合：
  // 1段階目：右端の自摸牌を確認できるよう少し待ってから選択状態（浮き上がり）にする
  autoRiichiTimer = window.setTimeout(() => {
    if (!state || state.status !== 'playing' || !state.riichi) return;
    if (hasThreeSets(state.hand, state.melds)) return;

    const discards = findRiichiDiscards(state.hand, state.melds);
    const drawnTile = state.drawn[0];
    const targetTile =
      drawnTile !== undefined && state.hand.includes(drawnTile)
        ? drawnTile
        : discards[0] ?? state.hand[state.hand.length - 1];

    if (targetTile === undefined) return;

    // 切る自摸牌を浮き上がらせて視覚的に追えるようにする
    ui.selected.clear();
    ui.selected.add(targetTile);
    ui.selectionOrder = [targetTile];
    render();

    // 2段階目：浮き上がった自摸牌を切る
    autoRiichiTimer = window.setTimeout(() => {
      autoRiichiTimer = null;
      if (!state || state.status !== 'playing' || !state.riichi) return;
      if (hasThreeSets(state.hand, state.melds)) return;
      dispatch({ type: 'attack', tiles: [targetTile], melds: [] });
    }, 480);
  }, 650);
}

function computePreview(s: BattleState): Preview {
  const tiles = [...ui.selected];
  const meldIdx = [...ui.selectedMelds];
  const canRiichi = !s.riichi && canDeclareRiichi(s.hand, s.melds);
  const canMulligan = s.turn === 1 && s.chain === 0 && s.mulligansUsed < 2 && canMulliganHand(s.hand);

  const kCands = kanCandidates(s.hand);
  const selectedKinds = new Set(tiles.map(kindOf));
  const canKan =
    !s.riichi &&
    !ui.riichiSelectMode &&
    meldIdx.length === 0 &&
    ((selectedKinds.size === 1 && kCands.includes([...selectedKinds][0])) ||
      (tiles.length === 0 && kCands.length > 0));

  const none: Preview = {
    text: '',
    canAttack: false,
    canKan,
    canRiichi,
    canConfirmRiichi: false,
    canMulligan,
  };

  if (s.status !== 'playing') return none;

  if (ui.riichiSelectMode) {
    const validDiscards = findRiichiDiscards(s.hand, s.melds);
    if (tiles.length === 1 && validDiscards.includes(tiles[0])) {
      const discardTile = tiles[0];
      const waits = getRiichiWaits(s.hand, discardTile, s.melds);
      const waitStr =
        waits.length > 0
          ? waits
              .map((k) => {
                const rem = s.wall.filter((t) => kindOf(t) === k).length;
                return `${kindName(k)}(残${rem}枚)`;
              })
              .join('・')
          : 'なし';
      return {
        ...none,
        canConfirmRiichi: true,
        text: `🔥【リーチ捨て牌：${kindName(kindOf(discardTile))}】 → 待ち牌：${waitStr}`,
        subText: '「この牌を切ってリーチ確定！」を押すと、選択した牌を捨ててオート自摸切りを開始します',
      };
    }
    return {
      ...none,
      canConfirmRiichi: false,
      text: '🔥 リーチ宣言モード：光っている牌の中から、最初に捨てる牌を1枚クリックして選んでください',
      subText: '捨てる牌によって待ち牌（3セット完成に必要な牌）が変わります',
    };
  }

  if (tiles.length === 0 && meldIdx.length === 0) {
    if (s.riichi) {
      const completed = hasThreeSets(s.hand, s.melds);
      return {
        ...none,
        text: completed
          ? '🎉【リーチ完成】3セットが揃いました！全選択して「攻撃」で威力2倍＆チェーン発動！'
          : '🔄【リーチ中】右端の自摸牌を自動でツモ切りしています…（「リーチキャンセル」で中断可）',
      };
    }
    return {
      ...none,
      text: '任意の枚数の牌を選んで「攻撃」してください（セット・役が含まれるとボーナス＆チェーン発生！）',
    };
  }

  if (s.riichi && !hasThreeSets(s.hand, s.melds)) {
    const t = tiles[0];
    return {
      ...none,
      text: `🔄【リーチ自摸切り】自摸牌「${t !== undefined ? kindName(kindOf(t)) : ''}」を切って次の牌をツモります…`,
    };
  }

  const ctx = buildScoreContext(s);
  const ev = evaluateSelection(
    tiles,
    meldIdx.map((i) => s.melds[i]),
    ctx,
  );

  if (!ev.valid) {
    return {
      ...none,
      text: ev.reason ?? '攻撃できません',
      ev,
    };
  }

  const parts: string[] = [];
  const kantsuCount = ev.decomp.sets.filter((m) => m.type === 'kantsu').length;
  const koutsuCount = ev.decomp.sets.filter((m) => m.type === 'koutsu').length;
  const shuntsuCount = ev.decomp.sets.filter((m) => m.type === 'shuntsu').length;
  const pairCount = ev.decomp.pairs.length;
  if (kantsuCount > 0) parts.push(`カン×${kantsuCount}(+${kantsuCount * 30}/基礎+50%)`);
  if (koutsuCount > 0) parts.push(`同牌セット×${koutsuCount}(+${koutsuCount * 20})`);
  if (shuntsuCount > 0) parts.push(`並びセット×${shuntsuCount}(+${shuntsuCount * 10})`);
  if (pairCount > 0) parts.push(`ペア×${pairCount}(+${pairCount * 5})`);
  if (ev.decomp.singles.length > 0) parts.push(`単牌×${ev.decomp.singles.length}`);

  const yakuStr =
    ev.yaku.length > 0
      ? ev.yaku.map((y) => `【${y.name}：${y.effectText}】`).join(' ')
      : ev.isRiichiComplete
        ? '【リーチ完成：威力2倍】'
        : '役なし';

  const actionWord = s.healMode ? '回復' : 'ダメージ';
  const chainNotice =
    ev.gainedChains > 0
      ? ` ／ ⚡チェーン+${ev.gainedChains}発生！`
      : s.extraChains > 0
        ? ` ／ ⚡ストックにより連続行動可`
        : '';

  const text = `${yakuStr} → ${ev.damage.toLocaleString()} ${actionWord}${chainNotice}`;
  const goldNote = ev.goldCount > 0 ? ` ｜ 金/赤牌×${ev.goldCount}(+${ev.goldCount * 50}%)` : '';
  const rainbowNote = ev.rainbowCount > 0 ? ` ｜ 虹牌×${ev.rainbowCount}` : '';
  const subText = `構成: ${parts.join('・')} ｜ 牌攻撃力合計 ${ev.tilePower} + ボーナス ${ev.setBonus}${goldNote}${rainbowNote}`;

  return {
    text,
    subText,
    canAttack: true,
    canKan,
    canRiichi,
    canConfirmRiichi: false,
    canMulligan,
    ev,
  };
}

function render() {
  if (screen === 'title' || !state) {
    app.innerHTML = renderTitle(ui.showYakuModal);
    return;
  }
  app.innerHTML = renderBattle({
    state,
    ui,
    preview: computePreview(state),
    events: pendingEvents,
  });
  pendingEvents = [];
  const log = document.getElementById('log');
  if (log) log.scrollTop = log.scrollHeight;
}

function dispatch(action: Action) {
  if (!state) return;
  stopAutoRiichiTimer();
  const prevLogLen = state.log.length;
  const r = step(state, action);
  if (r.error) {
    ui.message = r.error;
    render();
  } else {
    state = r.state;
    pendingEvents = r.state.events;
    ui.message = '';
    clearSelection();

    // リーチ中に3セットが揃ったら自動で全選択する
    if (state.status === 'playing' && state.riichi && hasThreeSets(state.hand, state.melds)) {
      selectAllPlayableTiles(state);
    }

    const newLogs = state.log.slice(prevLogLen);
    render();
    if (newLogs.length > 0) {
      enqueueLogs(newLogs);
    }
    checkAndScheduleAutoRiichi();
  }
}

function startBattle(def: MonsterDef) {
  stopAutoRiichiTimer();
  stopTypewriter();
  state = newBattle(def, randomSeed());
  screen = 'battle';
  clearSelection();
  ui.combatPhase = 'idle';
  ui.message = '';
  ui.logOpen = false;
  render();
  enqueueLogs(state.log);
}

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const actionEl = target.closest<HTMLElement>('[data-action]');
  if (actionEl?.dataset.action === 'open-yaku') {
    ui.showYakuModal = true;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'close-yaku') {
    if (actionEl.classList.contains('overlay') && target.closest('[data-stop]')) return;
    ui.showYakuModal = false;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'toggle-log') {
    ui.logOpen = !ui.logOpen;
    render();
    return;
  }

  const rewardEl = target.closest<HTMLElement>('[data-reward]');
  if (rewardEl?.dataset.reward) {
    dispatch({ type: 'choose_reward', equipId: rewardEl.dataset.reward });
    return;
  }

  const searchKindEl = target.closest<HTMLElement>('[data-search-kind]');
  if (searchKindEl?.dataset.searchKind !== undefined && state) {
    const [targetTile] = [...ui.selected];
    if (targetTile !== undefined) {
      dispatch({
        type: 'skill_search',
        targetTile,
        kind: Number(searchKindEl.dataset.searchKind),
      });
    }
    return;
  }

  const el = target.closest<HTMLElement>(
    '[data-monster],[data-tile],[data-meld],[data-action]',
  );
  if (!el) return;

  if (el.dataset.monster) {
    const def = MONSTERS.find((m) => m.id === el.dataset.monster);
    if (def) startBattle(def);
    return;
  }
  if (!state) return;

  if (el.dataset.tile !== undefined) {
    if (state.status !== 'playing') return;
    const t = Number(el.dataset.tile);

    // リーチ宣言モード中は、有効な捨て牌候補のみ単一選択で切り替え可能にする
    if (ui.riichiSelectMode) {
      const validDiscards = findRiichiDiscards(state.hand, state.melds);
      if (!validDiscards.includes(t)) return;
      ui.selected.clear();
      ui.selected.add(t);
      ui.selectionOrder = [t];
      ui.message = '';
      render();
      return;
    }

    if (ui.selected.has(t)) {
      ui.selected.delete(t);
      ui.selectionOrder = ui.selectionOrder.filter((id) => id !== t);
    } else {
      ui.selected.add(t);
      ui.selectionOrder.push(t);
    }
    if (ui.selected.size !== 1) ui.searchMode = false;
    ui.message = '';
    render();
    return;
  }

  if (el.dataset.meld !== undefined) {
    if (state.status !== 'playing' || ui.riichiSelectMode) return;
    const i = Number(el.dataset.meld);
    if (ui.selectedMelds.has(i)) ui.selectedMelds.delete(i);
    else ui.selectedMelds.add(i);
    ui.message = '';
    render();
    return;
  }

  switch (el.dataset.action) {
    case 'attack':
      dispatch({ type: 'attack', tiles: [...ui.selected], melds: [...ui.selectedMelds] });
      break;
    case 'kan': {
      const tiles = [...ui.selected];
      const cands = kanCandidates(state.hand);
      const kind = tiles.length > 0 ? kindOf(tiles[0]) : cands[0];
      if (kind !== undefined) dispatch({ type: 'kan', kind });
      break;
    }
    case 'start-riichi-select': {
      const validDiscards = findRiichiDiscards(state.hand, state.melds);
      const currentSelected = [...ui.selected];
      ui.selectedMelds.clear();
      ui.searchMode = false;
      ui.riichiSelectMode = true;
      // 既に有効な捨て牌候補を1枚だけ選択していた場合はそのまま保持し、そうでなければクリアして手動選択させる
      if (currentSelected.length === 1 && validDiscards.includes(currentSelected[0])) {
        ui.selected = new Set([currentSelected[0]]);
        ui.selectionOrder = [currentSelected[0]];
      } else {
        ui.selected.clear();
        ui.selectionOrder = [];
      }
      ui.message = '';
      render();
      break;
    }
    case 'confirm-riichi': {
      const [firstSelected] = [...ui.selected];
      dispatch({ type: 'riichi', discardTile: firstSelected });
      break;
    }
    case 'cancel-riichi-select': {
      clearSelection();
      ui.message = '';
      render();
      break;
    }
    case 'cancel-riichi':
      dispatch({ type: 'cancel_riichi' });
      break;
    case 'mulligan':
      dispatch({ type: 'mulligan' });
      break;
    case 'toggle-heal':
      dispatch({ type: 'toggle_heal' });
      break;
    case 'skill-reset-wall':
      dispatch({ type: 'skill_reset_wall' });
      break;
    case 'skill-copy': {
      if (ui.selectionOrder.length === 2) {
        dispatch({
          type: 'skill_copy',
          targetTile: ui.selectionOrder[0],
          sourceTile: ui.selectionOrder[1],
        });
      }
      break;
    }
    case 'skill-search': {
      ui.searchMode = !ui.searchMode;
      ui.message = ui.searchMode ? '上部の「残り牌」から手牌と入れ替えたい牌をクリックしてください' : '';
      render();
      break;
    }
    case 'select-all': {
      selectAllPlayableTiles(state);
      ui.message = '';
      render();
      break;
    }
    case 'clear':
      clearSelection();
      ui.message = '';
      render();
      break;
    case 'retry':
      startBattle(MONSTERS[0]);
      break;
    case 'title':
      stopAutoRiichiTimer();
      stopTypewriter();
      screen = 'title';
      state = null;
      render();
      break;
  }
});

render();
