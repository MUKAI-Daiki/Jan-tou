import './ui/style.css';
import {
  Action,
  BattleState,
  LogEntry,
  MonsterTurnStep,
  buildScoreContext,
  calculateScore,
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
import { evaluateSelection, findBestYakuCombo } from './core/score';
import { TileGroup, isHonor, isWind, kindName, kindOf, suitOf } from './core/tile';
import { JobId } from './data/equipments';
import { DifficultyId, MONSTERS, MonsterDef } from './data/monsters';
import { evaluateVeteranTitle } from './core/titles';
import {
  adminDeleteUser,
  adminUpdateUser,
  cloudState,
  deleteVeteranById,
  fetchAdminUsers,
  fetchJobRanking,
  fetchPvpCandidates,
  initCloudSession,
  loginAccount,
  logoutAccount,
  recordBattleEnd,
  recordBattleStart,
  registerAccount,
  resetPasswordByBirthDate,
  saveBattleProgress,
  saveVeteranToSlot,
  syncCloudAutosaveImmediate,
  updateProfile,
  updateVeteranMeta,
} from './client/api';
import { createInitialAccountUiState } from './ui/accountModals';
import { AvatarCropperController, attachAvatarCropper } from './ui/avatarCropper';
import { Preview, UiState, renderBattle, renderTitle } from './ui/render';

const app = document.getElementById('app')!;

const PLAYER_CHAR_MS = 28; // プレイヤーの文字送り間隔
const MONSTER_CHAR_MS = 36; // 敵の文字送り間隔
const ENEMY_WAIT_MS = 240; // 敵ターンの各節目のウェイト
const SLIDE_OUT_MS = 160; // 行移行時のスライドアウト時間
const SLIDE_IN_WAIT_MS = 160; // 行移行時のスライドイン＆ウェイト時間
const ATTACK_OUT_MS = 180; // 攻撃牌の上方向スライド＋フェードアウト時間
const DRAW_IN_MS = 300; // 補充牌の下方向スライドイン＋フラッシュ時間
const ENEMY_DEFEAT_MS = 850; // 敵撃破時の点滅→ダークアウト演出時間

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
  selectedDifficulty: 'beginner',
  selected: new Set(),
  selectedMelds: new Set(),
  selectionOrder: [],
  copyMode: false,
  alchemyMode: false,
  searchMode: false,
  searchPickedKind: null,
  riichiSelectMode: false,
  combatPhase: 'idle',
  isEnemyTurnAnimating: false,
  drawAnimActive: false,
  isEnemyDefeatAnimating: false,
  isLogAnimating: false,
  jobDetailId: null,
  showEquipModal: false,
  logOpen: false,
  liveLogText: '',
  liveLogSide: 'system',
  liveLogTransition: 'idle',
  message: '',
  account: createInitialAccountUiState(),
};

let activeCropper: AvatarCropperController | null = null;
const ACTIVE_SCREEN_SS_KEY = 'jantou_active_screen_v1';

function pickFirstAvailableVeteranSlot(): number {
  const used = new Map(cloudState.veterans.map((v) => [v.slotIndex, v]));
  for (let i = 0; i < 10; i++) {
    if (!used.has(i)) return i;
  }
  for (let i = 0; i < 10; i++) {
    const v = used.get(i);
    if (v && !v.isMarked) return i;
  }
  return 0;
}

function isBusyAnimating(): boolean {
  return Boolean(
    ui.isEnemyTurnAnimating ||
      ui.isEnemyDefeatAnimating ||
      ui.isLogAnimating ||
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
  ui.isLogAnimating = false;
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
      typewriterTimer = window.setTimeout(() => playNextLogInQueue(onAllDone), 220);
    } else if (onAllDone) {
      typewriterTimer = window.setTimeout(onAllDone, 200);
    } else {
      typewriterTimer = null;
      phaseResetTimer = window.setTimeout(() => {
        phaseResetTimer = null;
        ui.combatPhase = 'idle';
        syncCombatPhaseDom();
      }, 400);
    }
  });
}

function playMonsterTurnSequence(steps: MonsterTurnStep[], onComplete: () => void) {
  let stepIdx = 0;

  const runNextMonsterStep = () => {
    if (stepIdx >= steps.length) {
      typewriterTimer = window.setTimeout(() => {
        typewriterTimer = null;
        onComplete();
      }, ENEMY_WAIT_MS);
      return;
    }

    const mStep = steps[stepIdx++];
    ui.combatPhase = 'monster';
    syncCombatPhaseDom();

    typewriterTimer = window.setTimeout(() => {
      transitionAndTypeLine('monster', mStep.declareText, MONSTER_CHAR_MS, null, () => {
        typewriterTimer = window.setTimeout(() => {
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
  ui.alchemyMode = false;
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

    ui.selected.clear();
    ui.selected.add(targetTile);
    ui.selectionOrder = [targetTile];
    render();

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

  if (ui.alchemyMode) {
    return {
      ...none,
      canCure: false,
      canKan: false,
      canRiichi: false,
      text: '🧪 数牌調合：手牌から数牌（萬・筒・索）を1枚選択',
      subText: '選んだ数牌を隣の数字（±1）に変化させ、さらに金牌にします（クールタイム3ターン）',
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
          ? 'リーチ完成！全選択して攻撃（威力2.5倍・チェーン2・補充50%金化）'
          : `リーチ中：右端の牌を自動入替中（${Math.min(maxSwaps, s.riichiSwapsThisTurn + 1)}/${maxSwaps}枚目）`,
      };
    }
    return {
      ...none,
      text: '牌を選んで攻撃（役なし3枚まで ／「役」牌クリックで役候補を自動選択）',
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
  const canGuard = !s.riichi && !ui.riichiSelectMode && !hasSealedInSelection && ev.valid;

  if (!ev.valid) {
    return {
      ...none,
      canGuard: false,
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
      ? ev.yaku.map((y) => `【${y.name}】${y.effectText}`).join(' ')
      : ev.decomp.sets.length > 0
        ? `【セットのみ】📦×${ev.setCountMult}`
        : `【役なし】(${tiles.length}/3枚)`;

  const actionIcon = s.healMode ? '❤️+' : '💥';
  const chainNotice =
    ev.gainedChains > 0
      ? ` ⛓️+${ev.gainedChains}`
      : s.extraChains > 0
        ? ` ⛓️残${s.extraChains}`
        : '';

  const text = `${yakuStr} → ${actionIcon}${ev.damage.toLocaleString()}${chainNotice}`;
  const setMultNote = ev.setCountMult > 1 ? ` 📦×${ev.setCountMult}` : '';
  const totalKoutsu = koutsuCount + kantsuCount;
  const hasManShuntsu = ev.decomp.sets.some((m) => m.type === 'shuntsu' && suitOf(m.kind) === 'm');
  const hasPinShuntsu = ev.decomp.sets.some((m) => m.type === 'shuntsu' && suitOf(m.kind) === 'p');
  const hasSouShuntsu = ev.decomp.sets.some((m) => m.type === 'shuntsu' && suitOf(m.kind) === 's');
  const hasHonorSet = ev.decomp.sets.some(
    (m) => (m.type === 'koutsu' || m.type === 'kantsu') && isHonor(m.kind),
  );
  const hasWindSet = ev.decomp.sets.some(
    (m) => (m.type === 'koutsu' || m.type === 'kantsu') && isWind(m.kind),
  );
  const hasHonorInYaku =
    ev.yaku.length > 0 &&
    (ev.decomp.sets.some((m) => m.tiles.some((t) => isHonor(kindOf(t)))) ||
      ev.decomp.pairs.some((p) => isHonor(p.kind)));

  const swordNote =
    ev.yaku.length === 0 && ev.basicDrawPairs > 0
      ? ` ｜ ⚔️×2 🀇ペア+${ev.basicDrawPairs}`
      : s.job === 'sword' && ev.yaku.length > 0 && totalKoutsu > 0
        ? ` ｜ ⚔️×${totalKoutsu === 1 ? '1.5' : totalKoutsu === 2 ? '2' : '2.5'} 🀇ペア+1 🟨+${totalKoutsu}`
        : '';
  const docMagics: string[] = [];
  if (s.job === 'doctor' && ev.yaku.length > 0) {
    if (hasManShuntsu) docMagics.push('🔥⚔️×1.25 🟥+1');
    if (hasPinShuntsu) docMagics.push('❄️解除・敵⚔️-30%');
    if (hasSouShuntsu) docMagics.push('🌿浄化 🛡️+15%');
  }
  const doctorNote =
    ev.basicDrawSeq2 > 0
      ? ` ｜ 💊❤️+${Math.round(ev.basicShuntsuHealRate * 100)}% 🀇連+${ev.basicDrawSeq2}`
      : docMagics.length > 0
        ? ` ｜ 💊${docMagics.join(' ')}`
        : '';
  const ninjaEffects: string[] = [];
  if (s.job === 'ninja') {
    if (hasHonorSet) ninjaEffects.push('⚔️×4');
    if (hasHonorInYaku) ninjaEffects.push('☠️毒3T');
    if (ev.yaku.length > 0 && hasWindSet) ninjaEffects.push('⚡足止め1T');
  }
  const ninjaNote = ninjaEffects.length > 0 ? ` ｜ 🥷${ninjaEffects.join(' ')}` : '';

  const jobNote = `${swordNote}${doctorNote}${ninjaNote}`;
  const yakuSumNote = ev.yaku.length >= 2 ? ` ｜ 🀄役合算×${ev.yakuMult}` : '';
  const yakuMoneyNote = ev.yakuMoney > 0 ? ` ｜ 💰+${ev.yakuMoney}` : '';
  const goldNote = ev.goldCount > 0 ? ` ｜ 🟨+${ev.goldCount * 50}%` : '';
  const rainbowNote = ev.rainbowCount > 0 ? ` ｜ 🌈×${ev.rainbowCount}` : '';
  const subText = `${parts.join('・')} ｜ 🛡️${guardAmount}(牌${ev.tilePower}+加${ev.setBonus})${setMultNote}${yakuSumNote}${jobNote}${yakuMoneyNote}${goldNote}${rainbowNote}`;

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
  if (activeCropper) {
    activeCropper.destroy();
    activeCropper = null;
  }
  const activeState = displayedState ?? state;
  if (screen === 'title' || !activeState) {
    app.innerHTML = renderTitle(
      ui.showYakuModal,
      ui.selectedJob,
      ui.selectedDifficulty,
      ui.jobDetailId ?? null,
      ui.account,
    );
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

function scheduleDefeatAnimation(
  justDefeatedEnemy: boolean,
  onComplete: () => void,
) {
  if (justDefeatedEnemy) {
    ui.isEnemyDefeatAnimating = true;
    render();
    transitionAnimTimer = window.setTimeout(() => {
      transitionAnimTimer = null;
      ui.isEnemyDefeatAnimating = false;
      render();
      onComplete();
    }, ENEMY_DEFEAT_MS);
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
    const justLostPlayer =
      prevState.status === 'playing' && r.state.status === 'lost';
    const isGameEnded =
      prevState.status === 'playing' &&
      (r.state.status === 'won' || r.state.status === 'lost');

    if (isGameEnded) {
      sessionStorage.removeItem(ACTIVE_SCREEN_SS_KEY);
      if (ui.account) {
        ui.account.selectedSaveSlot = pickFirstAvailableVeteranSlot();
        ui.account.clearSavedSlot = null;
        ui.account.clearCommentDraft = '';
        ui.account.clearMarkDraft = false;
        ui.account.modalError = '';
      }
      void recordBattleEnd(r.state, calculateScore(r.state)).then(() => {
        if (state && (state.status === 'won' || state.status === 'lost')) {
          render();
        }
      });
    } else {
      const immediateSync =
        r.state.status !== prevState.status ||
        action.type === 'choose_reward' ||
        action.type === 'leave_shop';
      saveBattleProgress(r.state, immediateSync);
    }

    // 敵ターンが発生した場合は、プレイヤーフェーズ -> 敵ターンフェーズを順再生
    if (r.monsterTurnSteps && r.monsterTurnSteps.length > 0 && r.afterPlayerState) {
      ui.isEnemyTurnAnimating = true;
      displayedState = r.afterPlayerState;
      pendingEvents = r.playerEvents ?? [];
      render();

      const pLogs = r.playerLogs ?? [];
      const afterMonsterLogStart = prevLogLen + pLogs.length + r.monsterTurnSteps.length;
      const trailingLogs = r.state.log.slice(afterMonsterLogStart);

      enqueueLogs(pLogs, () => {
        playMonsterTurnSequence(r.monsterTurnSteps!, () => {
          const finishEnemyTurn = () => {
            displayedState = null;
            ui.isEnemyTurnAnimating = false;
            ui.isLogAnimating = false;
            ui.combatPhase = 'idle';
            pendingEvents = r.state.events;

            if (state && state.status === 'playing' && state.riichi && hasThreeSets(state.hand, state.melds)) {
              selectAllPlayableTiles(state);
            }
            render();
            checkAndScheduleAutoRiichi();
          };

          if (trailingLogs.length > 0) {
            enqueueLogs(trailingLogs, finishEnemyTurn);
          } else {
            finishEnemyTurn();
          }
        });
      });
      return;
    }

    pendingEvents = r.state.events;
    const newLogs = state.log.slice(prevLogLen);

    // 勝利・報酬・敗北などのイベント発生時は、ダイアログを描画しきってからイベント画面へ進める
    if (justDefeatedEnemy || justLostPlayer) {
      ui.isLogAnimating = true;
      render();
      enqueueLogs(newLogs, () => {
        scheduleDefeatAnimation(justDefeatedEnemy, () => {
          ui.isLogAnimating = false;
          ui.combatPhase = 'idle';
          if (state && state.status === 'playing' && state.riichi && hasThreeSets(state.hand, state.melds)) {
            selectAllPlayableTiles(state);
          }
          render();
          checkAndScheduleAutoRiichi();
        });
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

function startBattle(def: MonsterDef, difficulty: DifficultyId = ui.selectedDifficulty) {
  stopAutoRiichiTimer();
  stopTypewriter();
  state = newBattle(def, randomSeed(), ui.selectedJob, difficulty);
  screen = 'battle';
  sessionStorage.setItem(ACTIVE_SCREEN_SS_KEY, 'battle');
  clearSelection();
  ui.combatPhase = 'idle';
  ui.message = '';
  ui.logOpen = false;
  ui.showWallModal = false;
  ui.showYakuModal = false;
  ui.showEquipModal = false;
  ui.jobDetailId = null;
  if (ui.account) {
    ui.account.clearSavedSlot = null;
    ui.account.clearCommentDraft = '';
    ui.account.clearMarkDraft = false;
    ui.account.modalError = '';
  }
  saveBattleProgress(state, true);
  void recordBattleStart(ui.selectedJob, difficulty);
  render();
  enqueueLogs(state.log);
}

function resumeSavedBattle() {
  const saved = cloudState.activeSave?.state;
  if (!saved) return;
  stopAutoRiichiTimer();
  stopTypewriter();
  state = saved;
  ui.selectedJob = saved.job;
  ui.selectedDifficulty = saved.difficulty;
  screen = 'battle';
  sessionStorage.setItem(ACTIVE_SCREEN_SS_KEY, 'battle');
  clearSelection();
  ui.combatPhase = 'idle';
  ui.message = '';
  ui.logOpen = false;
  ui.showWallModal = false;
  ui.showYakuModal = false;
  ui.showEquipModal = false;
  ui.jobDetailId = null;
  const lastLog = saved.log[saved.log.length - 1];
  ui.liveLogText = lastLog ? lastLog.text : '中断データから再開しました';
  ui.liveLogSide = lastLog ? lastLog.side : 'system';
  render();
  checkAndScheduleAutoRiichi();
}

app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const accEl = target.closest<HTMLElement>('[data-acc-action]');
  if (accEl?.dataset.accAction && ui.account) {
    const act = accEl.dataset.accAction;
    if (act === 'close-modal') {
      if (accEl.classList.contains('overlay') && target.closest('[data-stop]')) return;
      ui.account.activeModal = null;
      ui.account.modalError = '';
      ui.account.modalSuccess = '';
      ui.account.editingVeteranId = null;
      render();
      return;
    }
    if (act === 'open-auth') {
      ui.account.activeModal = 'auth';
      ui.account.authTab = 'login';
      ui.account.croppedAvatarDraft = '';
      ui.account.modalError = '';
      ui.account.modalSuccess = '';
      render();
      return;
    }
    if (act === 'open-profile') {
      ui.account.activeModal = 'profile';
      ui.account.croppedAvatarDraft = cloudState.user?.avatarData ?? '';
      ui.account.modalError = '';
      ui.account.modalSuccess = '';
      render();
      return;
    }
    if (act === 'open-history') {
      ui.account.activeModal = 'history';
      ui.account.modalError = '';
      ui.account.modalSuccess = '';
      render();
      return;
    }
    if (act === 'open-veterans') {
      ui.account.activeModal = 'veterans';
      ui.account.modalError = '';
      ui.account.modalSuccess = '';
      render();
      void fetchPvpCandidates().then(() => {
        if (ui.account?.activeModal === 'veterans') render();
      });
      return;
    }
    if (act === 'open-admin') {
      ui.account.activeModal = 'admin';
      ui.account.modalError = '';
      ui.account.modalSuccess = '';
      render();
      void fetchAdminUsers()
        .then(() => {
          if (ui.account?.activeModal === 'admin') render();
        })
        .catch((err) => {
          if (ui.account) {
            ui.account.modalError = err instanceof Error ? err.message : '取得エラー';
            render();
          }
        });
      return;
    }
    if (act === 'switch-auth-tab') {
      const tab = accEl.dataset.tab as 'login' | 'register' | 'reset';
      if (tab) {
        ui.account.authTab = tab;
        ui.account.modalError = '';
        ui.account.modalSuccess = '';
        render();
      }
      return;
    }
    if (act === 'switch-history-tab') {
      const tab = accEl.dataset.tab as 'jobs' | 'equips' | 'yaku';
      if (tab) {
        ui.account.historyTab = tab;
        render();
      }
      return;
    }
    if (act === 'switch-veterans-tab') {
      const tab = accEl.dataset.tab as 'my' | 'pvp';
      if (tab) {
        ui.account.veteransTab = tab;
        ui.account.modalError = '';
        ui.account.modalSuccess = '';
        render();
        if (tab === 'pvp') {
          void fetchPvpCandidates().then(() => {
            if (ui.account?.activeModal === 'veterans') render();
          });
        }
      }
      return;
    }
    if (act === 'set-rank-tab') {
      const rTab = accEl.dataset.rankTab as 'personal' | 'global';
      if (rTab) {
        ui.account.jobRankingTab = rTab;
        render();
        if (ui.jobDetailId) {
          void fetchJobRanking(ui.jobDetailId).then(() => {
            if (ui.jobDetailId) render();
          });
        }
      }
      return;
    }
    if (act === 'logout') {
      void logoutAccount().then(() => {
        sessionStorage.removeItem(ACTIVE_SCREEN_SS_KEY);
        render();
      });
      return;
    }
    if (act === 'resume-autosave') {
      resumeSavedBattle();
      return;
    }
    if (act === 'discard-autosave') {
      saveBattleProgress(null, true);
      sessionStorage.removeItem(ACTIVE_SCREEN_SS_KEY);
      render();
      return;
    }
    if (act === 'select-save-slot') {
      const slot = Number(accEl.dataset.slot);
      if (Number.isInteger(slot) && slot >= 0 && slot <= 9) {
        ui.account.selectedSaveSlot = slot;
        ui.account.modalError = '';
        render();
      }
      return;
    }
    if (act === 'save-clear-veteran' && state && state.status === 'won') {
      const commentInput = document.getElementById('clear-vet-comment') as HTMLInputElement | null;
      const markInput = document.getElementById('clear-vet-mark') as HTMLInputElement | null;
      const comment = commentInput ? commentInput.value.trim() : ui.account.clearCommentDraft;
      const isMarked = markInput ? markInput.checked : ui.account.clearMarkDraft;
      ui.account.clearCommentDraft = comment;
      ui.account.clearMarkDraft = isMarked;
      const sc = calculateScore(state);
      const titleEval = evaluateVeteranTitle(state, sc);
      const slotIndex = ui.account.selectedSaveSlot;

      void saveVeteranToSlot({
        slotIndex,
        state,
        titleName: titleEval.titleName,
        totalScore: sc.totalScore,
        comment,
        isMarked,
      })
        .then(() => {
          if (ui.account) {
            ui.account.clearSavedSlot = slotIndex;
            ui.account.modalError = '';
            render();
          }
        })
        .catch((err) => {
          if (ui.account) {
            ui.account.modalError = err instanceof Error ? err.message : '保存に失敗しました';
            render();
          }
        });
      return;
    }
    if (act === 'toggle-vet-mark') {
      const vetId = accEl.dataset.vetId;
      const curMarked = accEl.dataset.marked === '1';
      if (vetId) {
        void updateVeteranMeta(vetId, { isMarked: !curMarked })
          .then(() => render())
          .catch((err) => {
            if (ui.account) {
              ui.account.modalError = err instanceof Error ? err.message : '更新エラー';
              render();
            }
          });
      }
      return;
    }
    if (act === 'start-vet-edit') {
      const vetId = accEl.dataset.vetId;
      if (vetId) {
        ui.account.editingVeteranId = vetId;
        ui.account.modalError = '';
        render();
      }
      return;
    }
    if (act === 'cancel-vet-edit') {
      ui.account.editingVeteranId = null;
      render();
      return;
    }
    if (act === 'save-vet-comment') {
      const vetId = accEl.dataset.vetId;
      if (vetId) {
        const inputEl = document.getElementById(`vet-edit-input-${vetId}`) as HTMLInputElement | null;
        const nextComment = inputEl ? inputEl.value.trim() : '';
        void updateVeteranMeta(vetId, { comment: nextComment })
          .then(() => {
            if (ui.account) {
              ui.account.editingVeteranId = null;
              ui.account.modalError = '';
              render();
            }
          })
          .catch((err) => {
            if (ui.account) {
              ui.account.modalError = err instanceof Error ? err.message : '更新エラー';
              render();
            }
          });
      }
      return;
    }
    if (act === 'delete-vet') {
      const vetId = accEl.dataset.vetId;
      if (vetId) {
        void deleteVeteranById(vetId)
          .then(() => {
            if (ui.account) {
              ui.account.modalError = '';
              render();
            }
          })
          .catch((err) => {
            if (ui.account) {
              ui.account.modalError = err instanceof Error ? err.message : '削除エラー';
              render();
            }
          });
      }
      return;
    }
    if (act === 'admin-refresh') {
      void fetchAdminUsers().then(() => render());
      return;
    }
    if (act === 'admin-reset-pass') {
      const userId = accEl.dataset.userId;
      const loginId = accEl.dataset.loginId ?? '';
      if (userId) {
        const newPassword = window.prompt(
          `ユーザー @${loginId} の新しいパスワード（6文字以上）を入力してください：`,
        );
        if (newPassword && newPassword.trim().length >= 6) {
          void adminUpdateUser(userId, { newPassword: newPassword.trim() })
            .then(() => {
              if (ui.account) {
                ui.account.modalSuccess = `@${loginId} のパスワードを再設定しました`;
                ui.account.modalError = '';
                render();
              }
            })
            .catch((err) => {
              if (ui.account) {
                ui.account.modalError = err instanceof Error ? err.message : '更新失敗';
                render();
              }
            });
        }
      }
      return;
    }
    if (act === 'admin-reset-profile') {
      const userId = accEl.dataset.userId;
      const loginId = accEl.dataset.loginId ?? '';
      if (userId && window.confirm(`@${loginId} のニックネーム・アイコン・コメントを初期化しますか？`)) {
        void adminUpdateUser(userId, {
          nickname: loginId,
          comment: '',
          clearAvatar: true,
        })
          .then(() => {
            if (ui.account) {
              ui.account.modalSuccess = `@${loginId} のプロフィールを初期化しました`;
              render();
            }
          })
          .catch((err) => {
            if (ui.account) {
              ui.account.modalError = err instanceof Error ? err.message : '更新失敗';
              render();
            }
          });
      }
      return;
    }
    if (act === 'admin-toggle-suspend') {
      const userId = accEl.dataset.userId;
      const isSuspended = accEl.dataset.suspended === '1';
      if (userId) {
        void adminUpdateUser(userId, { isSuspended: !isSuspended })
          .then(() => render())
          .catch((err) => {
            if (ui.account) {
              ui.account.modalError = err instanceof Error ? err.message : '更新失敗';
              render();
            }
          });
      }
      return;
    }
    if (act === 'admin-delete-user') {
      const userId = accEl.dataset.userId;
      const loginId = accEl.dataset.loginId ?? '';
      if (userId && window.confirm(`ユーザー @${loginId} を完全に削除しますか？この操作は取り消せません。`)) {
        void adminDeleteUser(userId)
          .then(() => {
            if (ui.account) {
              ui.account.modalSuccess = `@${loginId} を削除しました`;
              render();
            }
          })
          .catch((err) => {
            if (ui.account) {
              ui.account.modalError = err instanceof Error ? err.message : '削除失敗';
              render();
            }
          });
      }
      return;
    }
  }

  const diffEl = target.closest<HTMLElement>('[data-difficulty]');
  if (diffEl?.dataset.difficulty) {
    ui.selectedDifficulty = diffEl.dataset.difficulty as DifficultyId;
    render();
    return;
  }

  const jobDetailEl = target.closest<HTMLElement>('[data-job-detail]');
  if (jobDetailEl?.dataset.jobDetail) {
    const jId = jobDetailEl.dataset.jobDetail as JobId;
    ui.jobDetailId = jId;
    render();
    void fetchJobRanking(jId).then(() => {
      if (ui.jobDetailId === jId) render();
    });
    return;
  }

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
  if (actionEl?.dataset.action === 'close-job-detail') {
    if (actionEl.classList.contains('overlay') && target.closest('[data-stop]')) return;
    ui.jobDetailId = null;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'open-equip-detail') {
    ui.showEquipModal = true;
    render();
    return;
  }
  if (actionEl?.dataset.action === 'close-equip-detail') {
    if (actionEl.classList.contains('overlay') && target.closest('[data-stop]')) return;
    ui.showEquipModal = false;
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

  const shopAtkEl = target.closest<HTMLElement>('[data-shop-atk]');
  if (shopAtkEl?.dataset.shopAtk) {
    dispatch({ type: 'buy_shop_atk', group: shopAtkEl.dataset.shopAtk as TileGroup });
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

    // 麻雀医の「数牌調合」モード中：クリックした数牌を隣の数字（±1）＋金牌に変化させる
    if (ui.alchemyMode) {
      dispatch({
        type: 'skill_alchemy',
        targetTile: t,
      });
      return;
    }

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

    // 既に選択されている牌を再クリックした場合は個別解除
    if (ui.selected.has(t)) {
      ui.selected.delete(t);
      ui.selectionOrder = ui.selectionOrder.filter((id) => id !== t);
      ui.message = '';
      render();
      return;
    }

    if ((state.sealedTiles[t] ?? 0) > 0) {
      ui.message = '封印されている牌は選択できません';
      render();
      return;
    }

    // リーチ中（未完成時）は1枚のみ選択
    if (state.riichi && !hasThreeSets(state.hand, state.melds)) {
      ui.selected.clear();
      ui.selected.add(t);
      ui.selectionOrder = [t];
      ui.message = '';
      render();
      return;
    }

    const scoreCtx = buildScoreContext(state);

    // 1. 現在の選択＋クリックした牌 t を含む有効な役組み合わせがあれば、その最大役を自動選択（役選択ガイド）
    const nextRequiredTiles = new Set([...ui.selected, t]);
    const bestCombo = findBestYakuCombo(
      state.hand,
      state.melds,
      scoreCtx,
      nextRequiredTiles,
      ui.selectedMelds,
    );
    if (bestCombo) {
      ui.selected = new Set(bestCombo.tiles);
      ui.selectedMelds = new Set(bestCombo.meldIndices);
      ui.selectionOrder = [...bestCombo.tiles];
      ui.message = '';
      render();
      return;
    }

    // 2. 現在の選択で既に役が成立している場合、役に絡まない牌 t の追加選択は不可
    const curEv = evaluateSelection(
      [...ui.selected],
      [...ui.selectedMelds].map((i) => state!.melds[i]),
      scoreCtx,
    );
    if (curEv.yaku.length > 0) {
      ui.message = '役攻撃時は、役に絡まない牌は選択できません';
      render();
      return;
    }

    // 3. 役なし状態での枚数上限チェック（最大3枚まで）
    if (ui.selected.size + ui.selectedMelds.size * 3 >= 3) {
      ui.message = '役なし攻撃は3枚までしか選択できません';
      render();
      return;
    }

    ui.selected.add(t);
    ui.selectionOrder.push(t);
    ui.message = '';
    render();
    return;
  }

  if (el.dataset.meld !== undefined) {
    if (
      state.status !== 'playing' ||
      ui.riichiSelectMode ||
      ui.copyMode ||
      ui.alchemyMode ||
      ui.searchMode ||
      isBusyAnimating()
    ) {
      return;
    }
    const i = Number(el.dataset.meld);
    if (ui.selectedMelds.has(i)) {
      ui.selectedMelds.delete(i);
      ui.message = '';
      render();
      return;
    }

    const scoreCtx = buildScoreContext(state);
    const bestCombo = findBestYakuCombo(
      state.hand,
      state.melds,
      scoreCtx,
      ui.selected,
      new Set([...ui.selectedMelds, i]),
    );
    if (bestCombo) {
      ui.selected = new Set(bestCombo.tiles);
      ui.selectedMelds = new Set(bestCombo.meldIndices);
      ui.selectionOrder = [...bestCombo.tiles];
      ui.message = '';
    } else {
      ui.message = 'キープしたカンは「2セット役以上」が成立するときのみ選択できます';
    }
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
      ui.alchemyMode = false;
      ui.searchMode = false;
      ui.searchPickedKind = null;
      ui.riichiSelectMode = true;
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
    case 'skill-alchemy': {
      if (isBusyAnimating()) break;
      if (ui.alchemyMode) {
        clearSelection();
      } else {
        clearSelection();
        ui.alchemyMode = true;
      }
      ui.message = '';
      render();
      break;
    }
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
    case 'select-best-yaku': {
      if (isBusyAnimating()) break;
      const best = findBestYakuCombo(state.hand, state.melds, buildScoreContext(state));
      if (best) {
        ui.selected = new Set(best.tiles);
        ui.selectedMelds = new Set(best.meldIndices);
        ui.selectionOrder = [...best.tiles];
        ui.message = '';
        render();
      }
      break;
    }
    case 'clear':
      if (isBusyAnimating()) break;
      clearSelection();
      ui.message = '';
      render();
      break;
    case 'shop-buy-hp':
      dispatch({ type: 'buy_shop_hp' });
      break;
    case 'shop-heal':
      dispatch({ type: 'buy_shop_heal' });
      break;
    case 'leave-shop':
      dispatch({ type: 'leave_shop' });
      break;
    case 'retry':
      startBattle(MONSTERS[0], state?.difficulty ?? ui.selectedDifficulty);
      break;
    case 'suspend-to-title':
      stopAutoRiichiTimer();
      stopTypewriter();
      if (state && state.status !== 'won' && state.status !== 'lost') {
        saveBattleProgress(state, true);
      }
      sessionStorage.removeItem(ACTIVE_SCREEN_SS_KEY);
      screen = 'title';
      state = null;
      render();
      break;
    case 'title':
      stopAutoRiichiTimer();
      stopTypewriter();
      sessionStorage.removeItem(ACTIVE_SCREEN_SS_KEY);
      screen = 'title';
      state = null;
      render();
      break;
  }
});

// フォーム送信イベント（ログイン・新規登録・パスワード再設定・プロフィール更新）
app.addEventListener('submit', (e) => {
  const form = e.target as HTMLFormElement;
  if (!ui.account) return;

  if (form.id === 'auth-login-form') {
    e.preventDefault();
    const fd = new FormData(form);
    const loginId = String(fd.get('loginId') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    ui.account.modalError = '';
    void loginAccount(loginId, password)
      .then(() => {
        if (ui.account) {
          ui.account.activeModal = null;
          ui.account.modalError = '';
        }
        render();
      })
      .catch((err) => {
        if (ui.account) {
          ui.account.modalError = err instanceof Error ? err.message : 'ログインに失敗しました';
          render();
        }
      });
    return;
  }

  if (form.id === 'auth-register-form') {
    e.preventDefault();
    const fd = new FormData(form);
    const loginId = String(fd.get('loginId') ?? '').trim();
    const password = String(fd.get('password') ?? '');
    const birthDate = String(fd.get('birthDate') ?? '').trim();
    const nickname = String(fd.get('nickname') ?? '').trim();
    const comment = String(fd.get('comment') ?? '').trim();
    const avatarData = activeCropper
      ? activeCropper.getCroppedDataUrl()
      : ui.account.croppedAvatarDraft;

    ui.account.modalError = '';
    void registerAccount({
      loginId,
      password,
      birthDate,
      nickname,
      avatarData,
      comment,
    })
      .then(() => {
        if (ui.account) {
          ui.account.activeModal = null;
          ui.account.modalError = '';
        }
        render();
      })
      .catch((err) => {
        if (ui.account) {
          ui.account.modalError = err instanceof Error ? err.message : '登録に失敗しました';
          render();
        }
      });
    return;
  }

  if (form.id === 'auth-reset-form') {
    e.preventDefault();
    const fd = new FormData(form);
    const loginId = String(fd.get('loginId') ?? '').trim();
    const birthDate = String(fd.get('birthDate') ?? '').trim();
    const newPassword = String(fd.get('newPassword') ?? '');

    ui.account.modalError = '';
    void resetPasswordByBirthDate({ loginId, birthDate, newPassword })
      .then(() => {
        if (ui.account) {
          ui.account.activeModal = null;
          ui.account.modalError = '';
        }
        render();
      })
      .catch((err) => {
        if (ui.account) {
          ui.account.modalError =
            err instanceof Error ? err.message : 'パスワード再設定に失敗しました';
          render();
        }
      });
    return;
  }

  if (form.id === 'profile-edit-form') {
    e.preventDefault();
    const fd = new FormData(form);
    const nickname = String(fd.get('nickname') ?? '').trim();
    const comment = String(fd.get('comment') ?? '').trim();
    const avatarData = activeCropper
      ? activeCropper.getCroppedDataUrl()
      : ui.account.croppedAvatarDraft || cloudState.user?.avatarData || '';

    ui.account.modalError = '';
    void updateProfile({ nickname, avatarData, comment })
      .then(() => {
        if (ui.account) {
          ui.account.activeModal = null;
          ui.account.modalError = '';
        }
        render();
      })
      .catch((err) => {
        if (ui.account) {
          ui.account.modalError =
            err instanceof Error ? err.message : 'プロフィール更新に失敗しました';
          render();
        }
      });
  }
});

// アイコン画像選択 → 円形トリミング起動
app.addEventListener('change', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'avatar-file-input' && ui.account) {
    const fileInput = target as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const stageWrap = document.getElementById('cropper-stage-wrap');
      const canvas = document.getElementById('avatar-crop-canvas') as HTMLCanvasElement | null;
      const slider = document.getElementById('avatar-zoom-slider') as HTMLInputElement | null;
      if (!stageWrap || !canvas || !slider) return;
      stageWrap.style.display = 'flex';
      if (activeCropper) {
        activeCropper.destroy();
        activeCropper = null;
      }
      void attachAvatarCropper(canvas, slider, dataUrl, (cropped) => {
        if (ui.account) {
          ui.account.croppedAvatarDraft = cropped;
        }
        const previewContainer = document.querySelector('.cropper-left .user-avatar');
        if (previewContainer) {
          previewContainer.classList.remove('av-fallback');
          previewContainer.innerHTML = `<img src="${cropped}" alt="Preview" />`;
        }
      }).then((ctrl) => {
        activeCropper = ctrl;
      });
    };
    reader.readAsDataURL(file);
    return;
  }

  if (target.id === 'clear-vet-mark' && ui.account) {
    ui.account.clearMarkDraft = (target as HTMLInputElement).checked;
  }
});

app.addEventListener('input', (e) => {
  const target = e.target as HTMLElement;
  if (target.id === 'clear-vet-comment' && ui.account) {
    ui.account.clearCommentDraft = (target as HTMLInputElement).value;
    return;
  }
  if (target.id === 'admin-search-input' && ui.account) {
    const input = target as HTMLInputElement;
    const pos = input.selectionStart ?? input.value.length;
    ui.account.adminSearchQuery = input.value;
    render();
    const nextInput = document.getElementById('admin-search-input') as HTMLInputElement | null;
    if (nextInput) {
      nextInput.focus();
      nextInput.setSelectionRange(pos, pos);
    }
  }
});

// 不意の更新・ページ離脱・タブ切り替え時のオートセーブ即時フラッシュ
window.addEventListener('pagehide', () => {
  if (state && state.status !== 'won' && state.status !== 'lost') {
    saveBattleProgress(state, false);
    void syncCloudAutosaveImmediate(state, true);
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state && state.status !== 'won' && state.status !== 'lost') {
    saveBattleProgress(state, false);
    void syncCloudAutosaveImmediate(state, true);
  }
});

render();

void initCloudSession().then(() => {
  // 直前にバトル画面にいて（F5更新・戻る等）、有効なオートセーブがある場合は自動復帰
  if (sessionStorage.getItem(ACTIVE_SCREEN_SS_KEY) === 'battle' && cloudState.activeSave?.state) {
    resumeSavedBattle();
  } else {
    render();
  }
});
