import './ui/style.css';
import { Action, BattleState, newBattle, step } from './core/battle';
import { randomSeed } from './core/rng';
import { damageRank, evaluateSelection } from './core/score';
import { kindName, kindOf } from './core/tile';
import { MONSTERS, MonsterDef } from './data/monsters';
import { Preview, UiState, renderBattle, renderTitle } from './ui/render';

const app = document.getElementById('app')!;

let screen: 'title' | 'battle' = 'title';
let state: BattleState | null = null;
let currentMonster: MonsterDef | null = null;
let pendingEvents: BattleState['events'] = [];
const ui: UiState = { selected: new Set(), selectedMelds: new Set(), message: '' };

function clearSelection() {
  ui.selected.clear();
  ui.selectedMelds.clear();
}

function computePreview(s: BattleState): Preview {
  const tiles = [...ui.selected];
  const meldIdx = [...ui.selectedMelds];
  const none: Preview = { text: '', canAttack: false, canDiscard: false, canKan: false };

  if (s.status !== 'playing') return none;
  if (tiles.length === 0 && meldIdx.length === 0) {
    return { ...none, text: '牌を選んでください（1枚 → 打牌 ／ 面子 → 攻撃）' };
  }

  const canDiscard = tiles.length === 1 && meldIdx.length === 0;
  const kinds = new Set(tiles.map(kindOf));
  const canKan =
    meldIdx.length === 0 &&
    kinds.size === 1 &&
    (tiles.length === 1 || tiles.length === 4) &&
    s.hand.filter((t) => kindOf(t) === kindOf(tiles[0])).length >= 4;

  const ev = evaluateSelection(
    tiles,
    meldIdx.map((i) => s.melds[i]),
  );
  const canAttack = ev.valid;

  let text: string;
  if (ev.valid) {
    const yaku = ev.yaku.length > 0 ? ev.yaku.map((y) => `${y.name}(${y.yakuman ? '役満' : y.han})`).join(' ') : '役なし';
    const rank = damageRank(ev.fu, ev.han);
    const rankText = rank ? `${rank} ` : '';
    const chainMult = s.chain + 1;
    const totalDamage = ev.damage * chainMult;
    const mentsuText = ev.multiplier > 1 ? ` ×${ev.multiplier}(${ev.mentsu.length === 4 ? '七対子' : `${ev.mentsu.length}面子`})` : '';
    const chainText = s.chain > 0 ? ` ×${chainMult}(Chain ${s.chain})` : '';
    text = `${yaku} ／ ${ev.fu}符 ${ev.han}翻${mentsuText}${chainText} → ${rankText}${totalDamage.toLocaleString()} ダメージ`;
  } else if (canDiscard) {
    text = `打牌：${kindName(kindOf(tiles[0]))}`;
  } else {
    text = ev.reason ?? '';
  }
  return { text, canAttack, canDiscard, canKan, ev };
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
  const r = step(state, action);
  if (r.error) {
    ui.message = r.error;
  } else {
    state = r.state;
    pendingEvents = r.state.events;
    ui.message = '';
    clearSelection();
  }
  render();
}

function startBattle(def: MonsterDef) {
  currentMonster = def;
  state = newBattle(def, randomSeed());
  screen = 'battle';
  clearSelection();
  ui.message = '';
  render();
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
    if (ui.selected.has(t)) ui.selected.delete(t);
    else ui.selected.add(t);
    ui.message = '';
    render();
    return;
  }
  if (el.dataset.meld !== undefined) {
    if (state.status !== 'playing') return;
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
    case 'discard': {
      const [t] = [...ui.selected];
      if (t !== undefined) dispatch({ type: 'discard', tile: t });
      break;
    }
    case 'kan': {
      const [t] = [...ui.selected];
      if (t !== undefined) dispatch({ type: 'kan', kind: kindOf(t) });
      break;
    }
    case 'clear':
      clearSelection();
      ui.message = '';
      render();
      break;
    case 'retry':
      if (currentMonster) startBattle(currentMonster);
      break;
    case 'title':
      screen = 'title';
      state = null;
      render();
      break;
  }
});

render();
