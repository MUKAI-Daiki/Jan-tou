import './ui/style.css';
import {
  Action,
  BattleState,
  LogEntry,
  MonsterTurnStep,
  buildScoreContext,
  getRiichiMaxSwaps,
  hasAnyPlayerDebuff,
  newBattle,
  step,
} from './core/battle';
import {
  canDeclareRiichi,
  findRiichiDiscards,
  getRiichiWaits,
  hasThreeSets,
  kanCandidates,
} from './core/mentsu';
import { randomSeed } from './core/rng';
import { evaluateSelection } from './core/score';
import { TileGroup, kindName, kindOf } from './core/tile';
import { JobId } from './data/equipments';
import { MONSTERS, MonsterDef } from './data/monsters';
import { Preview, UiState, renderBattle, renderTitle } from './ui/render';

const app = document.getElementById('app')!;

const PLAYER_CHAR_MS = 44; // プレイヤーの文字送り間隔
const MONSTER_CHAR_MS = 58; // 敵の文字送り速さを50%アップ（88ms → 58ms）
const ENEMY_WAIT_MS = 300; // 敵ターンの各節目の0.3秒ウェイト
const SLIDE_OUT_MS = 220; // 行移行時のスライドアウト時間
const SLIDE_IN_WAIT_MS = 220; // 行移行時のスライドイン＆ウェイト時間
const ATTACK_OUT_MS = 180; // 攻撃牌の上方向スライド＋フェードアウト時間
const DRAW_IN_MS = 300; // 補充牌の下方向スライドイン＋フラッシュ時間
const ENEMY_DEFEAT_MS = 950; // 敵撃破時の点滅→ダークアウト演出時間
const LEVEL_UP_MS = 950; // レベルアップ時の発光＋LV UP！スライドイン演出時間

let screen: 'title' | 'battle' = 'title';
let state: BattleState | null = null;
let displayedState: BattleState | null = null;
let pendingEvents: BattleState['events'] = [];
let autoRiichiTimer: number | null = null;
let typewriterTimer: number | null = null;
let phaseResetTimer: number | null = null;
let attackOutTimer: number | null = null;
let drawAnimTimer: number | null = null;
let transitionAnimTimer: number | null = null;
let logQueue: LogEntry[] = [];

const ui: UiState = {
  selectedJob: 'sword',
  selected: new Set(),
  selectedMelds: new Set(),
  selectionOrder: [],
  copyMode: false,
  searchMode: false,
  searchPickedKind: null,
  riichiSelectMode: false,
  combatPhase: 'idle',
  isEnemyTurnAnimating: false,
  drawAnimActive: false,
  isEnemyDefeatAnimating: false,
  isLevelUpAnimating: false,
  logOpen: false,
  liveLogText: '',
  liveLogSide: 'system',
  liveLogTransition: 'idle',
  levelBonusStep: 'root',
  message: '',
};

function isBusyAnimating(): boolean {
  return Boolean(
    ui.isEnemyTurnAnimating ||
      ui.isEnemyDefeatAnimating ||
      ui.isLevelUpAnimating ||
      attackOutTimer !== null,
  );
}

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
  if (attackOutTimer !== null) {
    window.clearTimeout(attackOutTimer);
    attackOutTimer = null;
  }
  if (drawAnimTimer !== null) {
    window.clearTimeout(drawAnimTimer);
    drawAnimTimer = null;
  }
  if (transitionAnimTimer !== null) {
    window.clearTimeout(transitionAnimTimer);
    transitionAnimTimer = null;
  }
  ui.isEnemyTurnAnimating = false;
  ui.drawAnimActive = false;
  ui.isEnemyDefeatAnimating = false;
  ui.isLevelUpAnimating = false;
  ui.liveLogTransition = 'idle';
  displayedState = null;
}

function triggerDrawInAnimation() {
  if (drawAnimTimer !== null) {
    window.clearTimeout(drawAnimTimer);
  }
  ui.drawAnimActive = true;
  drawAnimTimer = window.setTimeout(() => {
    drawAnimTimer = null;
    ui.drawAnimActive = false;
    document.querySelectorAll('.tile.draw-in').forEach((el) => el.classList.remove('draw-in'));
  }, DRAW_IN_MS);
}

function syncCombatPhaseDom() {
  const battleEl = document.querySelector<HTMLElement>('main.battle');
  if (!battleEl) return;
  battleEl.classList.remove('phase-player', 'phase-monster');
  if (ui.combatPhase === 'player') battleEl.classList.add('phase-player');
  if (ui.combatPhase === 'monster') battleEl.classList.add('phase-monster');
}

function syncLiveLogHeaderDom() {
  const sectionEl = document.querySelector<HTMLElement>('.live-log-section');
  if (sectionEl) {
    sectionEl.className = `live-log-section side-${ui.liveLogSide}`;
  }
  const iconEl = document.querySelector<HTMLElement>('.live-icon');
  if (iconEl) {
    iconEl.textContent =
      ui.liveLogSide === 'monster' ? '👾' : ui.liveLogSide === 'player' ? '⚔️' : '📢';
  }
  const textEl = document.getElementById('live-log-text');
  if (textEl) {
    textEl.className = `live-text${
      ui.liveLogTransition === 'out'
        ? ' slide-out'
        : ui.liveLogTransition === 'in'
          ? ' slide-in'
          : ''
    }`;
    textEl.textContent = ui.liveLogText;
  }
}

function typeString(
  text: string,
  charIntervalMs: number,
  prefix: string,
  onDone: () => void,
) {
  const chars = [...text];
  let idx = 0;
  if (chars.length === 0) {
    onDone();
    return;
  }
  const tick = () => {
    idx++;
    ui.liveLogText = prefix + chars.slice(0, idx).join('');
    const el = document.getElementById('live-log-text');
    if (el) el.textContent = ui.liveLogText;
    if (idx < chars.length) {
      typewriterTimer = window.setTimeout(tick, charIntervalMs);
    } else {
      typewriterTimer = null;
      onDone();
    }
  };
  tick();
}

/**
 * 既存の行をスライドアウトさせ、新しい行をスライドイン＋ウェイトを入れてから文字送りを開始する
 */
function transitionAndTypeLine(
  side: 'player' | 'monster' | 'system',
  text: string,
  charIntervalMs: number,
  onBeforeSlideIn: (() => void) | null,
  onDone: () => void,
) {
  const startSlideIn = () => {
    ui.liveLogSide = side;
    ui.liveLogText = '';
    ui.liveLogTransition = 'in';
    if (onBeforeSlideIn) {
      onBeforeSlideIn();
    }
    syncCombatPhaseDom();
    syncLiveLogHeaderDom();

    typewriterTimer = window.setTimeout(() => {
      ui.liveLogTransition = 'idle';
      syncLiveLogHeaderDom();
      typeString(text, charIntervalMs, '', onDone);
    }, SLIDE_IN_WAIT_MS);
  };

  if (ui.liveLogText.length > 0) {
    ui.liveLogTransition = 'out';
    syncLiveLogHeaderDom();
    typewriterTimer = window.setTimeout(startSlideIn, SLIDE_OUT_MS);
  } else {
    startSlideIn();
  }
}

function enqueueLogs(entries: LogEntry[], onAllDone?: () => void) {
  if (entries.length === 0) {
    if (onAllDone) onAllDone();
    return;
  }
  logQueue = [...entries];
  playNextLogInQueue(onAllDone);
}

function playNextLogInQueue(onAllDone?: () => void) {
  if (logQueue.length === 0) {
    if (onAllDone) onAllDone();
    return;
  }
  const entry = logQueue.shift()!;
  if (entry.side === 'player') {
    ui.combatPhase = 'player';
  } else if (entry.side === 'monster') {
    ui.combatPhase = 'monster';
  }

  const speed = entry.side === 'monster' ? MONSTER_CHAR_MS : PLAYER_CHAR_MS;
  transitionAndTypeLine(entry.side, entry.text, speed, null, () => {
    if (logQueue.length > 0) {
      typewriterTimer = window.setTimeout(() => playNextLogInQueue(onAllDone), 340);
    } else if (onAllDone) {
      typewriterTimer = window.setTimeout(onAllDone, 280);
    } else {
      typewriterTimer = null;
      phaseResetTimer = window.setTimeout(() => {
        phaseResetTimer = null;
        ui.combatPhase = 'idle';
        syncCombatPhaseDom();
      }, 500);
    }
  });
}

function playMonsterTurnSequence(steps: MonsterTurnStep[], onComplete: () => void) {
  let stepIdx = 0;

  const runNextMonsterStep = () => {
    if (stepIdx >= steps.length) {
      // 3. ターンをプレイヤーに返す前の 0.3秒ウェイト
      typewriterTimer = window.setTimeout(() => {
        typewriterTimer = null;
        onComplete();
      }, ENEMY_WAIT_MS);
      return;
    }

    const mStep = steps[stepIdx++];
    ui.combatPhase = 'monster';
    syncCombatPhaseDom();

    // 1. 敵行動開始 -> メッセージ表示開始 の 0.3秒ウェイト
    typewriterTimer = window.setTimeout(() => {
      // スライドアウト・スライドイン＋ウェイトを入れて敵行動宣言を文字送り
      transitionAndTypeLine('monster', mStep.declareText, MONSTER_CHAR_MS, null, () => {
        // 2. ダメージ or デバフ 表示前 の 0.3秒ウェイト
        typewriterTimer = window.setTimeout(() => {
          // 行移行のスライドアウト・スライドインを入れつつ、ダメージ/デバフ状態＆赤字ポップアップを反映して結果行を文字送り
          transitionAndTypeLine(
            'monster',
            mStep.effectText,
            MONSTER_CHAR_MS,
            () => {
              displayedState = mStep.stateAfterEffect;
              pendingEvents = mStep.events;
              render();
            },
            () => {
              runNextMonsterStep();
            },
          );
        }, ENEMY_WAIT_MS);
      });
    }, ENEMY_WAIT_MS);
  };

  runNextMonsterStep();
}

function clearSelection() {
  ui.selected.clear();
  ui.selectedMelds.clear();
  ui.selectionOrder = [];
  ui.copyMode = false;
  ui.searchMode = false;
  ui.searchPickedKind = null;
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
  if (
    !state ||
    screen !== 'battle' ||
    state.status !== 'playing' ||
    !state.riichi ||
    state.pendingLevelUps > 0 ||
    isBusyAnimating()
  ) {
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
  const canCure = !s.riichi && !ui.riichiSelectMode && hasAnyPlayerDebuff(s);
  const maxSwaps = getRiichiMaxSwaps(s);
  const masterNote = s.job === 'master' ? '被ダメ半減・' : '';

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
    canGuard: false,
    canCure,
    canKan,
    canRiichi,
    canConfirmRiichi: false,
  };

  if (s.status !== 'playing') return none;

  if (ui.copyMode) {
    if (ui.selectionOrder.length === 1) {
      const srcTile = ui.selectionOrder[0];
      return {
        ...none,
        canCure: false,
        canKan: false,
        canRiichi: false,
        text: `複製（2/2）：「${kindName(kindOf(srcTile))}」を複製 → 消す牌を1枚選択`,
        subText: '次にクリックした手牌が消え、複製した牌に変化します',
      };
    }
    return {
      ...none,
      canCure: false,
      canKan: false,
      canRiichi: false,
      text: '複製（1/2）：複製対象（増やしたい牌）を1枚選択',
      subText: '手牌からコピー元の牌をクリックしてください',
    };
  }

  if (ui.searchMode) {
    if (ui.searchPickedKind !== null && ui.searchPickedKind !== undefined) {
      return {
        ...none,
        canCure: false,
        canKan: false,
        canRiichi: false,
        text: `サーチ（2/2）：「${kindName(ui.searchPickedKind)}」を入手 → 消す牌を1枚選択`,
        subText: '手牌から入れ替えて消す牌を1枚クリックしてください',
      };
    }
    return {
      ...none,
      canCure: false,
      canKan: false,
      canRiichi: false,
      text: 'サーチ：残り牌から手に入れたい牌を選択',
      subText: '残り牌一覧から対象をクリックしてください',
    };
  }

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
                return `${kindName(k)}(残${rem})`;
              })
              .join('・')
          : 'なし';
      return {
        ...none,
        canConfirmRiichi: true,
        text: `捨て牌：${kindName(kindOf(discardTile))} → 待ち：${waitStr}`,
        subText: `「リーチ確定」で開始（${masterNote}毎ターン最大${maxSwaps}枚入替）`,
      };
    }
    return {
      ...none,
      canConfirmRiichi: false,
      text: 'リーチ：最初に捨てる牌を1枚選択',
      subText: `リーチ中は${masterNote}毎ターン最大${maxSwaps}枚自動入替`,
    };
  }

  if (tiles.length === 0 && meldIdx.length === 0) {
    if (s.riichi) {
      const completed = hasThreeSets(s.hand, s.melds);
      return {
        ...none,
        text: completed
          ? 'リーチ完成！全選択して攻撃（威力2倍・チェーン・補充30%金化）'
          : `リーチ中：右端の牌を自動入替中（${Math.min(maxSwaps, s.riichiSwapsThisTurn + 1)}/${maxSwaps}枚目）`,
      };
    }
    return {
      ...none,
      text: '牌を選んで攻撃（セット・役で威力UP＆連続行動）',
    };
  }

  if (s.riichi && !hasThreeSets(s.hand, s.melds)) {
    const t = tiles[0];
    return {
      ...none,
      text: `リーチ入替（${Math.min(maxSwaps, s.riichiSwapsThisTurn + 1)}/${maxSwaps}）：「${
        t !== undefined ? kindName(kindOf(t)) : ''
      }」を切ってツモ`,
    };
  }

  const ctx = buildScoreContext(s);
  const ev = evaluateSelection(
    tiles,
    meldIdx.map((i) => s.melds[i]),
    ctx,
  );

  const hasSealedInSelection = tiles.some((t) => (s.sealedTiles[t] ?? 0) > 0);
  const guardAmount = Math.max(1, Math.round(ev.baseAttack));
  const canGuard = !s.riichi && !ui.riichiSelectMode && !hasSealedInSelection && (tiles.length > 0 || meldIdx.length > 0);

  if (!ev.valid) {
    return {
      ...none,
      canGuard,
      guardAmount,
      text: ev.reason ?? '攻撃できません',
      ev,
    };
  }

  const parts: string[] = [];
  const kantsuCount = ev.decomp.sets.filter((m) => m.type === 'kantsu').length;
  const koutsuCount = ev.decomp.sets.filter((m) => m.type === 'koutsu').length;
  const shuntsuCount = ev.decomp.sets.filter((m) => m.type === 'shuntsu').length;
  const pairCount = ev.decomp.pairs.length;
  if (kantsuCount > 0) parts.push(`カン×${kantsuCount}`);
  if (koutsuCount > 0) parts.push(`同牌×${koutsuCount}`);
  if (shuntsuCount > 0) parts.push(`並び×${shuntsuCount}`);
  if (pairCount > 0) parts.push(`ペア×${pairCount}`);
  if (ev.decomp.singles.length > 0) parts.push(`単牌×${ev.decomp.singles.length}`);

  const yakuStr =
    ev.yaku.length > 0
      ? ev.yaku.map((y) => `【${y.name}：${y.effectText}】`).join(' ')
      : ev.decomp.sets.length > 0
        ? `セットのみ（×${ev.setCountMult}）`
        : '役なし';

  const actionWord = s.healMode ? '回復' : 'ダメージ';
  const chainNotice =
    ev.gainedChains > 0
      ? ` ／ チェーン+${ev.gainedChains}`
      : s.extraChains > 0
        ? ` ／ 連続行動可`
        : '';

  const text = `${yakuStr} → ${ev.damage.toLocaleString()} ${actionWord}${chainNotice}`;
  const setMultNote = ev.setCountMult > 1 ? ` ｜ 倍率×${ev.setCountMult}` : '';
  const jobNote = `${
    ev.basicDrawPairs > 0 ? ` ｜ 雀剣士:威力2倍・ペア×${ev.basicDrawPairs}補充` : ''
  }${
    ev.basicDrawSeq2 > 0
      ? ` ｜ 麻雀医:HP+${Math.round(ev.basicShuntsuHealRate * 100)}%・2連×${ev.basicDrawSeq2}補充`
      : ''
  }${ev.jobBonusChains > 0 ? ' ｜ 忍び:威力2.5倍・チェーン+1' : ''}`;
  const yakuExpNote = ev.yakuExp > 0 ? ` ｜ EXP+${Math.round(ev.yakuExp * s.expMult)}` : '';
  const goldNote = ev.goldCount > 0 ? ` ｜ 金/赤+${ev.goldCount * 50}%` : '';
  const rainbowNote = ev.rainbowCount > 0 ? ` ｜ 虹×${ev.rainbowCount}` : '';
  const subText = `${parts.join('・')} ｜ 基礎 ${guardAmount}（牌${ev.tilePower}+加点${ev.setBonus}）${setMultNote}${jobNote}${yakuExpNote}${goldNote}${rainbowNote}`;

  return {
    text,
    subText,
    canAttack: true,
    canGuard,
    canCure,
    guardAmount,
    canKan,
    canRiichi,
    canConfirmRiichi: false,
    ev,
  };
}

function render() {
  const activeState = displayedState ?? state;
  if (screen === 'title' || !activeState) {
    app.innerHTML = renderTitle(ui.showYakuModal, ui.selectedJob);
    return;
  }
  app.innerHTML = renderBattle({
    state: activeState,
    ui,
    preview: computePreview(activeState),
    events: pendingEvents,
  });
  pendingEvents = [];
  const log = document.getElementById('log');
  if (log) log.scrollTop = log.scrollHeight;
}

function scheduleDefeatAndLevelUpAnimations(
  justDefeatedEnemy: boolean,
  justLeveledUp: boolean,
  onComplete: () => void,
) {
  if (justDefeatedEnemy) {
    ui.isEnemyDefeatAnimating = true;
    render();
    transitionAnimTimer = window.setTimeout(() => {
      transitionAnimTimer = null;
      ui.isEnemyDefeatAnimating = false;
      if (justLeveledUp) {
        ui.isLevelUpAnimating = true;
        render();
        transitionAnimTimer = window.setTimeout(() => {
          transitionAnimTimer = null;
          ui.isLevelUpAnimating = false;
          render();
          onComplete();
        }, LEVEL_UP_MS);
      } else {
        render();
        onComplete();
      }
    }, ENEMY_DEFEAT_MS);
    return;
  }

  if (justLeveledUp) {
    ui.isLevelUpAnimating = true;
    render();
    transitionAnimTimer = window.setTimeout(() => {
      transitionAnimTimer = null;
      ui.isLevelUpAnimating = false;
      render();
      onComplete();
    }, LEVEL_UP_MS);
    return;
  }

  onComplete();
}

function dispatch(action: Action) {
  if (!state || isBusyAnimating()) return;
  stopAutoRiichiTimer();
  stopTypewriter();
  const prevState = state;
  const prevLogLen = state.log.length;
  const r = step(state, action);
  if (r.error) {
    ui.message = r.error;
    render();
    return;
  }

  const applyStepResult = () => {
    attackOutTimer = null;
    state = r.state;
    ui.message = '';
    ui.showWallModal = false;
    clearSelection();

    const didDrawNewTiles =
      r.state.drawn.length > 0 &&
      (action.type === 'attack' || action.type === 'kan' || action.type === 'riichi');
    if (didDrawNewTiles) {
      triggerDrawInAnimation();
    }

    const justDefeatedEnemy =
      prevState.status === 'playing' &&
      (r.state.status === 'reward' || r.state.status === 'won');
    const justLeveledUp =
      r.state.player.level > prevState.player.level ||
      r.state.pendingLevelUps > prevState.pendingLevelUps;

    // 敵ターンが発生した場合は、プレイヤーフェーズ ->（必要に応じレベルアップ演出）-> 敵ターンフェーズを順再生
    if (r.monsterTurnSteps && r.monsterTurnSteps.length > 0 && r.afterPlayerState) {
      ui.isEnemyTurnAnimating = true;
      displayedState = r.afterPlayerState;
      pendingEvents = r.playerEvents ?? [];
      render();

      const pLogs = r.playerLogs ?? [];
      enqueueLogs(pLogs, () => {
        playMonsterTurnSequence(r.monsterTurnSteps!, () => {
          displayedState = null;
          ui.isEnemyTurnAnimating = false;
          ui.combatPhase = 'idle';
          pendingEvents = r.state.events;

          scheduleDefeatAndLevelUpAnimations(false, justLeveledUp, () => {
            if (state && state.status === 'playing' && state.riichi && hasThreeSets(state.hand, state.melds)) {
              selectAllPlayableTiles(state);
            }
            render();
            checkAndScheduleAutoRiichi();
          });
        });
      });
      return;
    }

    pendingEvents = r.state.events;
    const newLogs = state.log.slice(prevLogLen);

    if (justDefeatedEnemy || justLeveledUp) {
      if (newLogs.length > 0) {
        enqueueLogs(newLogs);
      }
      scheduleDefeatAndLevelUpAnimations(justDefeatedEnemy, justLeveledUp, () => {
        if (state && state.status === 'playing' && state.riichi && hasThreeSets(state.hand, state.melds)) {
          selectAllPlayableTiles(state);
        }
        render();
        checkAndScheduleAutoRiichi();
      });
      return;
    }

    // リーチ中に3セットが揃ったら自動で全選択する
    if (state.status === 'playing' && state.riichi && hasThreeSets(state.hand, state.melds)) {
      selectAllPlayableTiles(state);
    }

    render();
    if (newLogs.length > 0) {
      enqueueLogs(newLogs);
    }
    checkAndScheduleAutoRiichi();
  };

  // 攻撃時（またはリーチ捨て牌時）は、使った牌を上方向にスライド・フェードアウトさせてから結果を反映
  const outTiles =
    action.type === 'attack'
      ? action.tiles
      : action.type === 'riichi' && action.discardTile !== undefined
        ? [action.discardTile]
        : [];
  const outMelds = action.type === 'attack' ? action.melds : [];

  if (outTiles.length > 0 || outMelds.length > 0) {
    for (const t of outTiles) {
      document.querySelector<HTMLElement>(`[data-tile="${t}"]`)?.classList.add('attack-out');
    }
    for (const m of outMelds) {
      document.querySelector<HTMLElement>(`[data-meld="${m}"]`)?.classList.add('attack-out');
    }
    attackOutTimer = window.setTimeout(applyStepResult, ATTACK_OUT_MS);
  } else {
    applyStepResult();
  }
}

function startBattle(def: MonsterDef) {
  stopAutoRiichiTimer();
  stopTypewriter();
  state = newBattle(def, randomSeed(), ui.selectedJob);
  screen = 'battle';
  clearSelection();
  ui.combatPhase = 'idle';
  ui.message = '';
  ui.logOpen = false;
  ui.showWallModal = false;
  ui.showYakuModal = false;
  ui.levelBonusStep = 'root';
  render();
  enqueueLogs(state.log);
}

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const jobEl = target.closest<HTMLElement>('[data-job]');
  if (jobEl?.dataset.job) {
    ui.selectedJob = jobEl.dataset.job as JobId;
    render();
    return;
  }

  const searchKindEl = target.closest<HTMLElement>('[data-search-kind]');
  if (searchKindEl?.dataset.searchKind !== undefined && state) {
    const pickedKind = Number(searchKindEl.dataset.searchKind);
    if (ui.selected.size === 1) {
      const [targetTile] = [...ui.selected];
      ui.showWallModal = false;
      dispatch({
        type: 'skill_search',
        targetTile,
        kind: pickedKind,
      });
    } else {
      ui.searchPickedKind = pickedKind;
      ui.showWallModal = false;
      ui.message = '';
      render();
    }
    return;
  }

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
  if (actionEl?.dataset.action === 'open-wall') {
    ui.showWallModal = true;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'close-wall') {
    if (actionEl.classList.contains('overlay') && target.closest('[data-stop]')) return;
    ui.showWallModal = false;
    ui.searchMode = false;
    ui.searchPickedKind = null;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'toggle-log') {
    if (actionEl.classList.contains('overlay') && target.closest('[data-stop]')) return;
    ui.logOpen = !ui.logOpen;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'level-bonus-hp') {
    ui.levelBonusStep = 'root';
    dispatch({ type: 'choose_level_bonus', bonus: { type: 'hp_100' } });
    return;
  }
  if (actionEl?.dataset.action === 'level-bonus-group-menu') {
    ui.levelBonusStep = 'select_group';
    render();
    return;
  }
  if (actionEl?.dataset.action === 'level-bonus-kind-menu') {
    ui.levelBonusStep = 'select_kind';
    render();
    return;
  }
  if (actionEl?.dataset.action === 'level-bonus-back') {
    ui.levelBonusStep = 'root';
    render();
    return;
  }

  const levelGroupEl = target.closest<HTMLElement>('[data-level-group]');
  if (levelGroupEl?.dataset.levelGroup) {
    ui.levelBonusStep = 'root';
    dispatch({
      type: 'choose_level_bonus',
      bonus: { type: 'tile_atk_2', group: levelGroupEl.dataset.levelGroup as TileGroup },
    });
    return;
  }

  const levelBanishEl = target.closest<HTMLElement>('[data-level-banish-kind]');
  if (levelBanishEl?.dataset.levelBanishKind !== undefined) {
    ui.levelBonusStep = 'root';
    dispatch({
      type: 'choose_level_bonus',
      bonus: { type: 'banish_kind', kind: Number(levelBanishEl.dataset.levelBanishKind) },
    });
    return;
  }

  const rewardEl = target.closest<HTMLElement>('[data-reward]');
  if (rewardEl?.dataset.reward) {
    dispatch({ type: 'choose_reward', equipId: rewardEl.dataset.reward });
    return;
  }

  const shopBuyEl = target.closest<HTMLElement>('[data-shop-buy]');
  if (shopBuyEl?.dataset.shopBuy) {
    dispatch({ type: 'buy_shop_item', equipId: shopBuyEl.dataset.shopBuy });
    return;
  }

  const shopSellEl = target.closest<HTMLElement>('[data-shop-sell]');
  if (shopSellEl?.dataset.shopSell !== undefined) {
    dispatch({ type: 'sell_equip', equipIndex: Number(shopSellEl.dataset.shopSell) });
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
    if (state.status !== 'playing' || isBusyAnimating()) return;
    const t = Number(el.dataset.tile);

    // 複製モード中：1枚目＝複製対象（sourceTile） → 2枚目＝消す牌（targetTile）の順に選択して即時発動
    if (ui.copyMode) {
      if (ui.selectionOrder.length === 0) {
        ui.selected.clear();
        ui.selected.add(t);
        ui.selectionOrder = [t];
        ui.message = '';
        render();
      } else {
        const sourceTile = ui.selectionOrder[0];
        if (t === sourceTile) {
          ui.selected.clear();
          ui.selectionOrder = [];
          ui.message = '';
          render();
        } else {
          dispatch({
            type: 'skill_copy',
            sourceTile,
            targetTile: t,
          });
        }
      }
      return;
    }

    // サーチモード中（残り牌から対象牌種を選択済み）：クリックした手牌を消す牌として即時交換
    if (ui.searchMode && ui.searchPickedKind !== null && ui.searchPickedKind !== undefined) {
      dispatch({
        type: 'skill_search',
        targetTile: t,
        kind: ui.searchPickedKind,
      });
      return;
    }

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
    ui.message = '';
    render();
    return;
  }

  if (el.dataset.meld !== undefined) {
    if (
      state.status !== 'playing' ||
      ui.riichiSelectMode ||
      ui.copyMode ||
      ui.searchMode ||
      isBusyAnimating()
    ) {
      return;
    }
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
    case 'guard':
      dispatch({ type: 'guard', tiles: [...ui.selected], melds: [...ui.selectedMelds] });
      break;
    case 'cure-debuff':
      dispatch({ type: 'cure_debuff' });
      break;
    case 'kan': {
      const tiles = [...ui.selected];
      const cands = kanCandidates(state.hand);
      const kind = tiles.length > 0 ? kindOf(tiles[0]) : cands[0];
      if (kind !== undefined) dispatch({ type: 'kan', kind });
      break;
    }
    case 'start-riichi-select': {
      if (isBusyAnimating()) break;
      const validDiscards = findRiichiDiscards(state.hand, state.melds);
      const currentSelected = [...ui.selected];
      ui.selectedMelds.clear();
      ui.copyMode = false;
      ui.searchMode = false;
      ui.searchPickedKind = null;
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
    case 'cancel-riichi-select':
    case 'cancel-skill-mode': {
      clearSelection();
      ui.message = '';
      render();
      break;
    }
    case 'cancel-riichi':
      dispatch({ type: 'cancel_riichi' });
      break;
    case 'toggle-heal':
      dispatch({ type: 'toggle_heal' });
      break;
    case 'skill-reset-wall':
      dispatch({ type: 'skill_reset_wall' });
      break;
    case 'skill-copy': {
      if (isBusyAnimating()) break;
      if (ui.copyMode) {
        clearSelection();
      } else {
        clearSelection();
        ui.copyMode = true;
      }
      ui.message = '';
      render();
      break;
    }
    case 'skill-search': {
      if (isBusyAnimating()) break;
      if (ui.searchMode && !ui.showWallModal) {
        clearSelection();
        ui.message = '';
        render();
        break;
      }
      const preSelectedSingle =
        !ui.copyMode && !ui.riichiSelectMode && ui.selected.size === 1 ? [...ui.selected][0] : null;
      clearSelection();
      if (preSelectedSingle !== null) {
        ui.selected.add(preSelectedSingle);
        ui.selectionOrder = [preSelectedSingle];
      }
      ui.searchMode = true;
      ui.showWallModal = true;
      ui.message = '';
      render();
      break;
    }
    case 'select-all': {
      if (isBusyAnimating()) break;
      selectAllPlayableTiles(state);
      ui.message = '';
      render();
      break;
    }
    case 'clear':
      if (isBusyAnimating()) break;
      clearSelection();
      ui.message = '';
      render();
      break;
    case 'shop-heal':
      dispatch({ type: 'buy_shop_heal' });
      break;
    case 'leave-shop':
      dispatch({ type: 'leave_shop' });
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
