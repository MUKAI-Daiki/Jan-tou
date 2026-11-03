import {
  CloudAppState,
  ScoreRecord,
  cloudState,
} from '../client/api';
import { BattleState, ScoreBreakdown } from '../core/battle';
import { TILE_GROUP_LABEL, TileGroup } from '../core/tile';
import { evaluateVeteranTitle } from '../core/titles';
import { YakuId } from '../core/yaku';
import {
  EQUIPMENTS,
  JOBS,
  JobId,
  RARITY_LABEL,
  getEquipment,
  getJobDef,
} from '../data/equipments';
import { getDifficultyDef } from '../data/monsters';

export interface AccountUiState {
  activeModal:
    | null
    | 'auth'
    | 'profile'
    | 'history'
    | 'veterans'
    | 'admin';
  authTab: 'login' | 'register' | 'reset';
  historyTab: 'jobs' | 'equips' | 'yaku';
  veteransTab: 'my' | 'pvp';
  jobRankingTab: 'personal' | 'global';
  selectedSaveSlot: number;
  clearCommentDraft: string;
  clearMarkDraft: boolean;
  clearSavedSlot: number | null;
  croppedAvatarDraft: string;
  editingVeteranId: string | null;
  modalError: string;
  modalSuccess: string;
  adminSearchQuery: string;
}

export function createInitialAccountUiState(): AccountUiState {
  return {
    activeModal: null,
    authTab: 'login',
    historyTab: 'jobs',
    veteransTab: 'my',
    jobRankingTab: 'personal',
    selectedSaveSlot: 0,
    clearCommentDraft: '',
    clearMarkDraft: false,
    clearSavedSlot: null,
    croppedAvatarDraft: '',
    editingVeteranId: null,
    modalError: '',
    modalSuccess: '',
    adminSearchQuery: '',
  };
}

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function renderAvatarCircle(
  avatarData: string | undefined,
  nickname: string,
  sizeCls = 'av-md',
): string {
  if (avatarData && avatarData.startsWith('data:image/')) {
    return `<span class="user-avatar ${sizeCls}"><img src="${esc(avatarData)}" alt="${esc(nickname)}" /></span>`;
  }
  const initial = [...(nickname || '雀')][0] ?? '雀';
  return `<span class="user-avatar ${sizeCls} av-fallback">${esc(initial)}</span>`;
}

const YAKU_LIST_META: readonly { id: YakuId; name: string; category: string; isYakuman?: boolean }[] = [
  { id: 'haku', name: '白セット', category: '1セット役' },
  { id: 'hatsu', name: '發セット', category: '1セット役' },
  { id: 'chun', name: '中セット', category: '1セット役' },
  { id: 'riichi', name: 'リーチ', category: '1セット役' },
  { id: 'wind_27', name: '東風セット', category: '風牌役' },
  { id: 'wind_28', name: '南風セット', category: '風牌役' },
  { id: 'wind_29', name: '西風セット', category: '風牌役' },
  { id: 'wind_30', name: '北風セット', category: '風牌役' },
  { id: 'tanyao', name: 'タンヤオ', category: '2セット役' },
  { id: 'iipeikou', name: '一盃口', category: '2セット役' },
  { id: 'nishoku_doujun', name: '二色同順', category: '2セット役' },
  { id: 'nishoku_doukou', name: '二色同刻', category: '2セット役' },
  { id: 'niankou', name: '二暗刻', category: '2セット役' },
  { id: 'chanta', name: 'チャンタ', category: '2セット役' },
  { id: 'four_pairs', name: '四対子', category: '特殊役' },
  { id: 'neko_punch', name: 'ねこぱんち', category: '職業専用役' },
  { id: 'tsuyotsuyo', name: 'つよつよこうげき', category: '職業専用役' },
  { id: 'honiisou', name: '混一色', category: '3セット役' },
  { id: 'pinfu', name: '平和', category: '3セット役' },
  { id: 'sanankou', name: '三暗刻', category: '3セット役' },
  { id: 'chinroutou', name: '清老頭', category: '3セット役' },
  { id: 'chiniisou', name: '清一色', category: '3セット役' },
  { id: 'daisangen', name: '大三元', category: '役満', isYakuman: true },
  { id: 'ryuuiisou', name: '緑一色', category: '役満', isYakuman: true },
  { id: 'tsuuiisou', name: '字一色', category: '役満', isYakuman: true },
  { id: 'sankantsu', name: '三槓子', category: '役満', isYakuman: true },
];

/**
 * 1. タイトル画面上部のアカウント＆メニューバー
 */
export function renderAccountTopBar(cs: CloudAppState = cloudState): string {
  const u = cs.user;
  const vetCount = cs.veterans.length;

  if (!u) {
    return `<header class="account-topbar guest-bar">
      <div class="account-user-info">
        ${renderAvatarCircle('', 'ゲスト', 'av-md')}
        <div class="account-user-text">
          <div class="account-name-row">
            <span class="account-nickname">ゲスト雀士（未ログイン）</span>
            <span class="account-badge guest">ローカル保存中</span>
          </div>
          <div class="account-comment">ログインするとクラウド保存・強者共の共有が可能になります</div>
        </div>
      </div>
      <div class="account-actions">
        <button type="button" class="btn-acc-nav" data-acc-action="open-veterans">
          👑 強者共 (${vetCount}/10)
        </button>
        <button type="button" class="btn-acc-nav" data-acc-action="open-history">
          📊 戦績・図鑑
        </button>
        <button type="button" class="btn-acc-primary" data-acc-action="open-auth">
          🔑 ログイン / アカウント作成
        </button>
      </div>
    </header>`;
  }

  return `<header class="account-topbar">
    <div class="account-user-info">
      ${renderAvatarCircle(u.avatarData, u.nickname, 'av-md')}
      <div class="account-user-text">
        <div class="account-name-row">
          <span class="account-nickname">${esc(u.nickname)}</span>
          <span class="account-login-id">@${esc(u.loginId)}</span>
          ${u.role === 'admin' ? '<span class="account-badge admin">ADMIN</span>' : '<span class="account-badge online">CLOUD接続中</span>'}
        </div>
        <div class="account-comment">${
          u.comment ? `💬 「${esc(u.comment)}」` : '<span class="muted-note">コメント未設定</span>'
        }</div>
      </div>
    </div>
    <div class="account-actions">
      <button type="button" class="btn-acc-nav" data-acc-action="open-veterans">
        👑 強者共 (${vetCount}/10)
      </button>
      <button type="button" class="btn-acc-nav" data-acc-action="open-history">
        📊 戦績・図鑑
      </button>
      <button type="button" class="btn-acc-nav" data-acc-action="open-profile">
        👤 プロフィール編集
      </button>
      ${
        u.role === 'admin'
          ? `<button type="button" class="btn-acc-admin" data-acc-action="open-admin">
               🛠️ ユーザー管理
             </button>`
          : ''
      }
      <button type="button" class="btn-acc-logout" data-acc-action="logout">
        ログアウト
      </button>
    </div>
  </header>`;
}

/**
 * 2. オートセーブ途中再開バナー（タイトル画面用）
 */
export function renderResumeBanner(cs: CloudAppState = cloudState): string {
  const save = cs.activeSave;
  if (!save || !save.state) return '';
  const s = save.state;
  if (s.status === 'won' || s.status === 'lost') return '';

  const jobDef = getJobDef(s.job);
  const diffDef = getDifficultyDef(s.difficulty);
  const statusLabel =
    s.status === 'reward'
      ? '報酬選択中'
      : s.status === 'shop'
        ? '商店滞在'
        : `ターン ${s.turn} 交戦中`;

  return `<div class="resume-banner">
    <div class="resume-info">
      <span class="resume-badge">⚡ オートセーブ中断データあり</span>
      <div class="resume-detail">
        <b>【${esc(diffDef.name)}】${jobDef.icon}${esc(jobDef.name)}</b> ｜ 第 <b>${s.stage}</b> 戦（${statusLabel}）
        ｜ ❤️ HP ${s.player.hp.toLocaleString()}/${s.player.maxHp.toLocaleString()}
        ｜ 💰 ${s.money.toLocaleString()} 銭 ｜ 🎒 装備 ${s.equipments.length}個
      </div>
    </div>
    <div class="resume-btns">
      <button type="button" class="btn-resume-play" data-acc-action="resume-autosave">
        ▶️ 続きから再開する
      </button>
      <button type="button" class="btn-resume-discard" data-acc-action="discard-autosave">
        破棄
      </button>
    </div>
  </div>`;
}

/**
 * 3. 職業詳細モーダル内に埋め込む「戦績＆スコアTOP3」セクション
 */
export function renderJobStatsAndTop3Html(
  jobId: JobId,
  accUi: AccountUiState,
  cs: CloudAppState = cloudState,
): string {
  const begStat = cs.jobStats.find((s) => s.jobId === jobId && s.difficulty === 'beginner');
  const advStat = cs.jobStats.find((s) => s.jobId === jobId && s.difficulty === 'advanced');
  const begPlay = begStat?.playCount ?? 0;
  const begClear = begStat?.clearCount ?? 0;
  const advPlay = advStat?.playCount ?? 0;
  const advClear = advStat?.clearCount ?? 0;

  const isGlobal = accUi.jobRankingTab === 'global';
  const records: ScoreRecord[] =
    (isGlobal ? cs.globalTop3ByJob[jobId] : cs.personalTop3ByJob[jobId]) ?? [];

  const rankRows =
    records.length === 0
      ? `<div class="empty-rank-note">まだスコア記録がありません。プレイして記録を刻みましょう！</div>`
      : records
          .slice(0, 3)
          .map((r, idx) => {
            const medal = idx === 0 ? '🥇 1位' : idx === 1 ? '🥈 2位' : '🥉 3位';
            const diffDef = getDifficultyDef(r.difficulty);
            const resultTag = r.isWon ? '🏆全制覇' : `${r.stagesCleared}戦突破`;
            return `<div class="top3-row rank-${idx + 1}">
              <div class="top3-left">
                <span class="top3-medal">${medal}</span>
                ${renderAvatarCircle(r.avatarData, r.nickname, 'av-xs')}
                <span class="top3-player">${esc(r.nickname)}</span>
                <span class="top3-diff ${r.difficulty === 'advanced' ? 'adv' : 'beg'}">${esc(diffDef.name)}</span>
                <span class="top3-stage">${resultTag}</span>
              </div>
              <div class="top3-score">${r.totalScore.toLocaleString()} pt</div>
            </div>`;
          })
          .join('');

  return `<div class="job-detail-section job-stats-highlight">
    <div class="job-stats-header-row">
      <h3>🏆 プレイ戦績 ＆ スコアランキング TOP3</h3>
      <div class="rank-scope-tabs">
        <button type="button" class="rank-tab-btn${!isGlobal ? ' active' : ''}" data-acc-action="set-rank-tab" data-rank-tab="personal">
          👤 個人TOP3
        </button>
        <button type="button" class="rank-tab-btn${isGlobal ? ' active' : ''}" data-acc-action="set-rank-tab" data-rank-tab="global">
          🌐 全体TOP3
        </button>
      </div>
    </div>
    <div class="job-play-counter-grid">
      <div class="play-counter-box">
        <span class="pc-label">🌱 初級編</span>
        <span class="pc-val">プレイ <b>${begPlay}</b> 回 ／ クリア <b>${begClear}</b> 回</span>
      </div>
      <div class="play-counter-box adv">
        <span class="pc-label">🔥 上級編</span>
        <span class="pc-val">プレイ <b>${advPlay}</b> 回 ／ クリア <b>${advClear}</b> 回</span>
      </div>
    </div>
    <div class="top3-list">${rankRows}</div>
  </div>`;
}

/**
 * 4. クリア時（status === 'won'）のリザルト画面内に表示する「強者共」登録セクション
 */
export function renderClearVeteranSaveSection(
  s: BattleState,
  sc: ScoreBreakdown,
  accUi: AccountUiState,
  cs: CloudAppState = cloudState,
): string {
  if (s.status !== 'won') return '';

  const titleEval = evaluateVeteranTitle(s, sc);
  const slotCards = Array.from({ length: 10 }, (_, idx) => {
    const existing = cs.veterans.find((v) => v.slotIndex === idx);
    const isSelected = accUi.selectedSaveSlot === idx;
    const isLocked = Boolean(existing?.isMarked);
    const jobDef = existing ? getJobDef(existing.jobId) : null;

    return `<button type="button" class="vet-slot-pill${isSelected ? ' selected' : ''}${isLocked ? ' locked' : ''}"
      data-acc-action="select-save-slot" data-slot="${idx}" ${isLocked ? 'disabled title="保護マーク中のため上書き不可"' : ''}>
      <span class="slot-num">#${idx + 1}</span>
      ${
        existing
          ? `<span class="slot-info">${jobDef?.icon ?? ''}${esc(existing.titleName)} (${existing.totalScore.toLocaleString()}pt)${isLocked ? ' ⭐保護' : ''}</span>`
          : '<span class="slot-empty">空き枠</span>'
      }
    </button>`;
  }).join('');

  if (accUi.clearSavedSlot !== null) {
    return `<div class="clear-veteran-box saved-complete">
      <div class="vet-award-banner">
        <span class="vet-tier-badge tier-${titleEval.tier}">${titleEval.tier}ランク称号</span>
        <span class="vet-title-main">『${esc(titleEval.titleName)}』</span>
      </div>
      <p class="vet-saved-msg">✅ スロット #${accUi.clearSavedSlot + 1} に「強者共」として保存しました！</p>
      <button type="button" class="btn-acc-nav btn-sm" data-acc-action="open-veterans">👑 強者共一覧を確認・管理する</button>
    </div>`;
  }

  return `<div class="clear-veteran-box">
    <div class="vet-award-banner">
      <span class="vet-tier-badge tier-${titleEval.tier}">獲得称号 (${titleEval.tier})</span>
      <span class="vet-title-main">『${esc(titleEval.titleName)}』</span>
      <span class="vet-title-reason">（${esc(titleEval.reason)}）</span>
    </div>
    <div class="vet-save-form">
      <div class="vet-save-desc">
        このクリア時のステータス（最大HP ${s.player.maxHp}・永続攻撃+${sc.permAtkTotal}・装備${s.equipments.length}個）を<b>「強者共」</b>に保存できます（最大10人・将来の対人戦で使用可能）。
      </div>
      <div class="vet-slot-selector-label">保存先スロットを選択（1〜10）：</div>
      <div class="vet-slot-grid">${slotCards}</div>
      <div class="vet-save-inputs">
        <input type="text" id="clear-vet-comment" class="acc-input" maxlength="20"
          placeholder="強者コメント（全角20文字以内・任意）" value="${esc(accUi.clearCommentDraft)}" />
        <label class="vet-mark-check">
          <input type="checkbox" id="clear-vet-mark" ${accUi.clearMarkDraft ? 'checked' : ''} />
          ⭐ 保護マークを付ける
        </label>
        <button type="button" class="btn-save-veteran" data-acc-action="save-clear-veteran">
          👑 スロット #${accUi.selectedSaveSlot + 1} に保存
        </button>
      </div>
      ${accUi.modalError ? `<div class="acc-msg error">⚠️ ${esc(accUi.modalError)}</div>` : ''}
    </div>
  </div>`;
}

/**
 * 5. 認証・プロフィール・戦績・強者共・Admin モーダル描画
 */
export function renderAccountModals(
  accUi: AccountUiState,
  cs: CloudAppState = cloudState,
): string {
  switch (accUi.activeModal) {
    case 'auth':
      return renderAuthModal(accUi);
    case 'profile':
      return renderProfileModal(accUi, cs);
    case 'history':
      return renderHistoryCollectionModal(accUi, cs);
    case 'veterans':
      return renderVeteransModal(accUi, cs);
    case 'admin':
      return renderAdminModal(accUi, cs);
    default:
      return '';
  }
}

function renderCropperWidget(currentAvatar: string): string {
  return `<div class="cropper-box">
    <div class="cropper-left">
      <div class="cropper-preview-label">現在の円形アイコン</div>
      ${renderAvatarCircle(currentAvatar, 'Preview', 'av-lg')}
      <label class="btn-upload-file">
        📷 画像を選択
        <input type="file" id="avatar-file-input" accept="image/*" hidden />
      </label>
    </div>
    <div class="cropper-stage-wrap" id="cropper-stage-wrap" style="display:none;">
      <div class="cropper-hint">ドラッグで位置調整・スライダーで拡大縮小</div>
      <canvas id="avatar-crop-canvas" width="200" height="200"></canvas>
      <div class="cropper-zoom-row">
        <span>🔍</span>
        <input type="range" id="avatar-zoom-slider" min="1" max="3" step="0.02" value="1" />
      </div>
    </div>
  </div>`;
}

function renderAuthModal(accUi: AccountUiState): string {
  const tab = accUi.authTab;

  let formHtml = '';
  if (tab === 'login') {
    formHtml = `<form id="auth-login-form" class="acc-form">
      <div class="form-field">
        <label>ユーザーID</label>
        <input type="text" name="loginId" class="acc-input" placeholder="半角英数字 (例: d-mukai)" required />
      </div>
      <div class="form-field">
        <label>パスワード</label>
        <input type="password" name="password" class="acc-input" placeholder="パスワードを入力" required />
      </div>
      <button type="submit" class="btn-acc-submit">🔑 ログインする</button>
    </form>`;
  } else if (tab === 'register') {
    formHtml = `<form id="auth-register-form" class="acc-form">
      <div class="form-row-2">
        <div class="form-field">
          <label>ユーザーID <span class="req">必須</span></label>
          <input type="text" name="loginId" class="acc-input" placeholder="半角英数字 3〜24文字" required />
        </div>
        <div class="form-field">
          <label>パスワード <span class="req">必須</span></label>
          <input type="password" name="password" class="acc-input" placeholder="6文字以上" required />
        </div>
      </div>
      <div class="form-row-2">
        <div class="form-field">
          <label>生年月日（パスワード再設定用） <span class="req">必須</span></label>
          <input type="date" name="birthDate" class="acc-input" required />
        </div>
        <div class="form-field">
          <label>ニックネーム（他者表示名） <span class="req">必須</span></label>
          <input type="text" name="nickname" class="acc-input" maxlength="16" placeholder="1〜16文字" required />
        </div>
      </div>
      <div class="form-field">
        <label>ひとことコメント（全角20文字以内）</label>
        <input type="text" name="comment" class="acc-input" maxlength="20" placeholder="よろしく！（20文字以内）" />
      </div>
      <div class="form-field">
        <label>プロフィールアイコン（アップロード → 円形トリミング）</label>
        ${renderCropperWidget(accUi.croppedAvatarDraft)}
      </div>
      <button type="submit" class="btn-acc-submit">✨ アカウントを作成して開始</button>
    </form>`;
  } else {
    formHtml = `<form id="auth-reset-form" class="acc-form">
      <p class="form-note">登録時の「ユーザーID」と「生年月日」を照合して新しいパスワードを設定します。</p>
      <div class="form-field">
        <label>ユーザーID</label>
        <input type="text" name="loginId" class="acc-input" placeholder="登録したユーザーID" required />
      </div>
      <div class="form-field">
        <label>登録した生年月日</label>
        <input type="date" name="birthDate" class="acc-input" required />
      </div>
      <div class="form-field">
        <label>新しいパスワード（6文字以上）</label>
        <input type="password" name="newPassword" class="acc-input" placeholder="新しいパスワード" required />
      </div>
      <button type="submit" class="btn-acc-submit">🔄 パスワードを再設定してログイン</button>
    </form>`;
  }

  return `<div class="overlay" data-acc-action="close-modal">
    <div class="wall-modal acc-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>🔑 アカウント認証・登録</h2>
        <button type="button" class="btn-clear btn-sm" data-acc-action="close-modal">閉じる</button>
      </div>
      <div class="acc-tabs">
        <button type="button" class="acc-tab${tab === 'login' ? ' active' : ''}" data-acc-action="switch-auth-tab" data-tab="login">
          ログイン
        </button>
        <button type="button" class="acc-tab${tab === 'register' ? ' active' : ''}" data-acc-action="switch-auth-tab" data-tab="register">
          新規アカウント作成
        </button>
        <button type="button" class="acc-tab${tab === 'reset' ? ' active' : ''}" data-acc-action="switch-auth-tab" data-tab="reset">
          パスワードリセット（生年月日）
        </button>
      </div>
      ${accUi.modalError ? `<div class="acc-msg error">⚠️ ${esc(accUi.modalError)}</div>` : ''}
      ${accUi.modalSuccess ? `<div class="acc-msg success">✅ ${esc(accUi.modalSuccess)}</div>` : ''}
      ${formHtml}
    </div>
  </div>`;
}

function renderProfileModal(accUi: AccountUiState, cs: CloudAppState): string {
  const u = cs.user;
  if (!u) return '';
  const avatarPreview = accUi.croppedAvatarDraft || u.avatarData;

  return `<div class="overlay" data-acc-action="close-modal">
    <div class="wall-modal acc-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>👤 プロフィール編集（@${esc(u.loginId)}）</h2>
        <button type="button" class="btn-clear btn-sm" data-acc-action="close-modal">閉じる</button>
      </div>
      ${accUi.modalError ? `<div class="acc-msg error">⚠️ ${esc(accUi.modalError)}</div>` : ''}
      ${accUi.modalSuccess ? `<div class="acc-msg success">✅ ${esc(accUi.modalSuccess)}</div>` : ''}
      <form id="profile-edit-form" class="acc-form">
        <div class="form-field">
          <label>ニックネーム（他者表示名・1〜16文字）</label>
          <input type="text" name="nickname" class="acc-input" maxlength="16" value="${esc(u.nickname)}" required />
        </div>
        <div class="form-field">
          <label>コメント（全角20文字以内）</label>
          <input type="text" name="comment" class="acc-input" maxlength="20" value="${esc(u.comment)}" placeholder="20文字以内でひとこと" />
        </div>
        <div class="form-field">
          <label>アイコン画像（アップロード → 円形トリミング）</label>
          ${renderCropperWidget(avatarPreview)}
        </div>
        <button type="submit" class="btn-acc-submit">💾 プロフィールを保存</button>
      </form>
    </div>
  </div>`;
}

function renderHistoryCollectionModal(accUi: AccountUiState, cs: CloudAppState): string {
  const tab = accUi.historyTab;
  let contentHtml = '';

  if (tab === 'jobs') {
    const rows = JOBS.map((j) => {
      const beg = cs.jobStats.find((s) => s.jobId === j.id && s.difficulty === 'beginner');
      const adv = cs.jobStats.find((s) => s.jobId === j.id && s.difficulty === 'advanced');
      const topScore = cs.personalTop3ByJob[j.id]?.[0]?.totalScore ?? 0;

      return `<div class="hist-job-card">
        <div class="hist-job-head">
          <span class="hist-job-name">${j.icon} ${esc(j.name)}</span>
          <span class="hist-job-best">最高スコア: <b>${topScore.toLocaleString()} pt</b></span>
        </div>
        <div class="hist-job-stats">
          <div class="hist-diff-pill">
            <span>🌱 初級編</span>
            <span>出撃 <b>${beg?.playCount ?? 0}</b> 回 ／ 制覇 <b>${beg?.clearCount ?? 0}</b> 回</span>
          </div>
          <div class="hist-diff-pill adv">
            <span>🔥 上級編</span>
            <span>出撃 <b>${adv?.playCount ?? 0}</b> 回 ／ 制覇 <b>${adv?.clearCount ?? 0}</b> 回</span>
          </div>
        </div>
      </div>`;
    }).join('');
    contentHtml = `<div class="hist-job-grid">${rows}</div>`;
  } else if (tab === 'equips') {
    const ownedCount = EQUIPMENTS.filter((eq) => (cs.collections.equipCounts[eq.id] ?? 0) > 0).length;
    const cards = EQUIPMENTS.map((eq) => {
      const count = cs.collections.equipCounts[eq.id] ?? 0;
      const unlocked = count > 0;
      return `<div class="col-equip-card rarity-${eq.rarity}${unlocked ? '' : ' locked'}">
        <div class="col-eq-top">
          <span class="col-eq-icon">${unlocked ? eq.icon : '❓'}</span>
          <span class="col-eq-name">${unlocked ? esc(eq.name) : '？？？'}</span>
          <span class="col-eq-cnt">${unlocked ? `獲得 ${count}回` : '未獲得'}</span>
        </div>
        <div class="col-eq-desc">${unlocked ? esc(eq.desc) : `【${esc(RARITY_LABEL[eq.rarity])}】未発見の装備`}</div>
      </div>`;
    }).join('');
    contentHtml = `
      <div class="col-summary-bar">装備コレクション達成率：<b>${ownedCount} / ${EQUIPMENTS.length}</b> 種</div>
      <div class="col-equip-grid">${cards}</div>
    `;
  } else {
    const totalYakuCount = Object.values(cs.collections.yakuCounts).reduce((a, b) => a + b, 0);
    const cards = YAKU_LIST_META.map((ym) => {
      const cnt = cs.collections.yakuCounts[ym.id] ?? 0;
      return `<div class="col-yaku-row${ym.isYakuman ? ' yakuman' : ''}${cnt > 0 ? ' achieved' : ''}">
        <div class="col-yaku-left">
          <span class="col-yaku-cat">${esc(ym.category)}</span>
          <span class="col-yaku-name">${esc(ym.name)}</span>
        </div>
        <div class="col-yaku-count">${cnt > 0 ? `<b>${cnt.toLocaleString()}</b> 回成立` : '<span class="muted-note">0 回</span>'}</div>
      </div>`;
    }).join('');
    contentHtml = `
      <div class="col-summary-bar">累計役成立回数：<b>${totalYakuCount.toLocaleString()}</b> 回</div>
      <div class="col-yaku-list">${cards}</div>
    `;
  }

  return `<div class="overlay" data-acc-action="close-modal">
    <div class="wall-modal acc-modal acc-wide-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>📊 プレイ履歴・コレクション図鑑</h2>
        <button type="button" class="btn-clear btn-sm" data-acc-action="close-modal">閉じる</button>
      </div>
      <div class="acc-tabs">
        <button type="button" class="acc-tab${tab === 'jobs' ? ' active' : ''}" data-acc-action="switch-history-tab" data-tab="jobs">
          ⚔️ 職業別プレイ＆クリア数
        </button>
        <button type="button" class="acc-tab${tab === 'equips' ? ' active' : ''}" data-acc-action="switch-history-tab" data-tab="equips">
          🎒 装備コレクション
        </button>
        <button type="button" class="acc-tab${tab === 'yaku' ? ' active' : ''}" data-acc-action="switch-history-tab" data-tab="yaku">
          🀄 役成立数
        </button>
      </div>
      <div class="acc-modal-body">${contentHtml}</div>
    </div>
  </div>`;
}

function renderVeteranCard(
  v: CloudAppState['veterans'][number],
  isOwner: boolean,
  editingId: string | null,
): string {
  const jobDef = getJobDef(v.jobId);
  const diffDef = getDifficultyDef(v.difficulty);
  const groups: TileGroup[] = ['m', 'p', 's', 'wind', 'dragon'];
  const atkBadges = groups
    .map((g) => {
      const val = v.bonusTileAtk?.[g] ?? 0;
      if (val <= 0) return '';
      return `<span class="badge buff">${esc(TILE_GROUP_LABEL[g])}+${val}</span>`;
    })
    .filter(Boolean)
    .join('');

  const equipChips =
    v.equipments.length === 0
      ? '<span class="muted-note">装備なし</span>'
      : v.equipments
          .map((eqId) => {
            const eq = getEquipment(eqId);
            return `<span class="equip-chip rarity-${eq.rarity}" title="${esc(eq.name)}：${esc(eq.desc)}">
              <span class="eq-chip-icon">${eq.icon}</span>
              <span class="eq-chip-kanji">${esc(eq.kanji)}</span>
            </span>`;
          })
          .join('');

  const isEditing = isOwner && editingId === v.id;

  return `<div class="veteran-card${v.isMarked ? ' marked' : ''}">
    <div class="vet-card-top">
      <div class="vet-card-title-group">
        ${
          isOwner
            ? `<span class="vet-slot-tag">SLOT #${v.slotIndex + 1}</span>`
            : `${renderAvatarCircle(v.ownerAvatar, v.ownerNickname || '雀士', 'av-sm')}
               <span class="vet-owner-name">${esc(v.ownerNickname || '名無しの雀士')}</span>`
        }
        <span class="vet-title-pill">『${esc(v.titleName)}』</span>
        <span class="vet-job-label">${jobDef.icon}${esc(jobDef.name)}</span>
        <span class="top3-diff ${v.difficulty === 'advanced' ? 'adv' : 'beg'}">${esc(diffDef.name)}</span>
      </div>
      <div class="vet-card-score">🏆 ${v.totalScore.toLocaleString()} pt</div>
    </div>

    <div class="vet-stats-line">
      <span class="vet-hp-pill">❤️ 最大HP <b>${v.maxHp.toLocaleString()}</b></span>
      <div class="buff-row">${atkBadges || '<span class="muted-note">永続強化なし</span>'}</div>
    </div>

    <div class="vet-equip-row">
      <span class="equip-label">装備(${v.equipments.length})：</span>
      <div class="equip-list">${equipChips}</div>
    </div>

    <div class="vet-card-foot">
      ${
        isEditing
          ? `<div class="vet-comment-edit-row">
               <input type="text" id="vet-edit-input-${esc(v.id)}" class="acc-input btn-sm" maxlength="20"
                 value="${esc(v.comment)}" placeholder="強者コメント（20文字以内）" />
               <button type="button" class="btn-acc-primary btn-xs" data-acc-action="save-vet-comment" data-vet-id="${esc(v.id)}">保存</button>
               <button type="button" class="btn-clear btn-xs" data-acc-action="cancel-vet-edit">キャンセル</button>
             </div>`
          : `<div class="vet-comment-display">
               💬 ${v.comment ? `「${esc(v.comment)}」` : '<span class="muted-note">コメントなし</span>'}
             </div>`
      }
      ${
        isOwner
          ? `<div class="vet-manage-btns">
               <button type="button" class="btn-vet-mark${v.isMarked ? ' active' : ''}"
                 data-acc-action="toggle-vet-mark" data-vet-id="${esc(v.id)}" data-marked="${v.isMarked ? '1' : '0'}">
                 ${v.isMarked ? '⭐ 保護ON' : '☆ マーク'}
               </button>
               <button type="button" class="btn-clear btn-xs" data-acc-action="start-vet-edit" data-vet-id="${esc(v.id)}">
                 ✏️ コメント
               </button>
               <button type="button" class="btn-vet-del btn-xs" data-acc-action="delete-vet" data-vet-id="${esc(v.id)}"
                 ${v.isMarked ? 'disabled title="保護マークを解除すると削除できます"' : ''}>
                 🗑️ 削除
               </button>
             </div>`
          : ''
      }
    </div>
  </div>`;
}

function renderVeteransModal(accUi: AccountUiState, cs: CloudAppState): string {
  const tab = accUi.veteransTab;
  let bodyHtml = '';

  if (tab === 'my') {
    if (cs.veterans.length === 0) {
      bodyHtml = `<div class="empty-rank-note">
        まだ「強者共」が保存されていません。<br/>
        全10連戦をクリア（制覇）すると、その時点のステータス・装備・称号を最大10人まで保存できます！
      </div>`;
    } else {
      bodyHtml = `<div class="veteran-list">
        ${cs.veterans.map((v) => renderVeteranCard(v, true, accUi.editingVeteranId)).join('')}
      </div>`;
    }
  } else {
    if (cs.pvpCandidates.length === 0) {
      bodyHtml = `<div class="empty-rank-note">現在登録されている全国の「強者共」はまだいません。</div>`;
    } else {
      bodyHtml = `
        <div class="pvp-intro-banner">
          ⚔️ <b>強者共の殿堂（対人戦アリーナ候補）</b>：各プレイヤーが全10戦制覇で鍛え上げた「強者共」一覧です（今後の対人戦モードで対戦可能になります）。
        </div>
        <div class="veteran-list">
          ${cs.pvpCandidates.map((v) => renderVeteranCard(v, false, null)).join('')}
        </div>
      `;
    }
  }

  return `<div class="overlay" data-acc-action="close-modal">
    <div class="wall-modal acc-modal acc-wide-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>👑 強者共（クリアキャラ保存・管理：${cs.veterans.length}/10人）</h2>
        <button type="button" class="btn-clear btn-sm" data-acc-action="close-modal">閉じる</button>
      </div>
      <div class="acc-tabs">
        <button type="button" class="acc-tab${tab === 'my' ? ' active' : ''}" data-acc-action="switch-veterans-tab" data-tab="my">
          👑 マイ強者共 (${cs.veterans.length}/10)
        </button>
        <button type="button" class="acc-tab${tab === 'pvp' ? ' active' : ''}" data-acc-action="switch-veterans-tab" data-tab="pvp">
          🌐 全国の強者共（対人戦ロビー）
        </button>
      </div>
      ${accUi.modalError ? `<div class="acc-msg error">⚠️ ${esc(accUi.modalError)}</div>` : ''}
      ${accUi.modalSuccess ? `<div class="acc-msg success">✅ ${esc(accUi.modalSuccess)}</div>` : ''}
      <div class="acc-modal-body">${bodyHtml}</div>
    </div>
  </div>`;
}

function renderAdminModal(accUi: AccountUiState, cs: CloudAppState): string {
  const q = accUi.adminSearchQuery.trim().toLowerCase();
  const filtered = cs.adminUsers.filter(
    (u) =>
      !q ||
      u.loginId.toLowerCase().includes(q) ||
      u.nickname.toLowerCase().includes(q) ||
      u.comment.toLowerCase().includes(q),
  );

  const rows = filtered
    .map(
      (u) => `<div class="admin-user-row${u.isSuspended ? ' suspended' : ''}">
        <div class="admin-user-main">
          ${renderAvatarCircle(u.avatarData, u.nickname, 'av-sm')}
          <div class="admin-user-meta">
            <div class="admin-user-line1">
              <b>${esc(u.nickname)}</b>
              <span class="account-login-id">@${esc(u.loginId)}</span>
              ${u.role === 'admin' ? '<span class="account-badge admin">ADMIN</span>' : ''}
              ${u.isSuspended ? '<span class="badge debuff">🚫 停止中</span>' : ''}
            </div>
            <div class="admin-user-line2">
              💬 ${u.comment ? esc(u.comment) : '（コメントなし）'} ｜ 出撃 ${u.totalPlays} ／ 制覇 ${u.totalClears} ／ 強者共 ${u.veteranCount}体
            </div>
          </div>
        </div>
        <div class="admin-user-actions">
          <button type="button" class="btn-clear btn-xs" data-acc-action="admin-reset-pass" data-user-id="${esc(u.id)}" data-login-id="${esc(u.loginId)}">
            🔑 Pass再設定
          </button>
          <button type="button" class="btn-clear btn-xs" data-acc-action="admin-reset-profile" data-user-id="${esc(u.id)}" data-login-id="${esc(u.loginId)}">
            🧹 表示初期化
          </button>
          ${
            u.loginId !== 'd-mukai'
              ? `<button type="button" class="btn-clear btn-xs" data-acc-action="admin-toggle-suspend" data-user-id="${esc(u.id)}" data-suspended="${u.isSuspended ? '1' : '0'}">
                   ${u.isSuspended ? '✅ 停止解除' : '🚫 利用停止'}
                 </button>
                 <button type="button" class="btn-vet-del btn-xs" data-acc-action="admin-delete-user" data-user-id="${esc(u.id)}" data-login-id="${esc(u.loginId)}">
                   🗑️ 削除
                 </button>`
              : ''
          }
        </div>
      </div>`,
    )
    .join('');

  return `<div class="overlay" data-acc-action="close-modal">
    <div class="wall-modal acc-modal acc-wide-modal" data-stop>
      <div class="yaku-modal-head">
        <h2>🛠️ Admin ユーザー管理コンソール（登録 ${cs.adminUsers.length} 名）</h2>
        <button type="button" class="btn-clear btn-sm" data-acc-action="close-modal">閉じる</button>
      </div>
      ${accUi.modalError ? `<div class="acc-msg error">⚠️ ${esc(accUi.modalError)}</div>` : ''}
      ${accUi.modalSuccess ? `<div class="acc-msg success">✅ ${esc(accUi.modalSuccess)}</div>` : ''}
      <div class="admin-toolbar">
        <input type="text" id="admin-search-input" class="acc-input" placeholder="ユーザーID・ニックネーム・コメントで検索..." value="${esc(accUi.adminSearchQuery)}" />
        <button type="button" class="btn-clear btn-sm" data-acc-action="admin-refresh">🔄 再読込</button>
      </div>
      <div class="acc-modal-body admin-user-list">
        ${rows || '<div class="empty-rank-note">該当するユーザーがいません</div>'}
      </div>
    </div>
  </div>`;
}
