import { BattleState, ScoreBreakdown } from '../core/battle';
import { VeteranCharacter } from '../core/titles';
import { JobId } from '../data/equipments';
import { DifficultyId } from '../data/monsters';

export interface UserProfile {
  id: string;
  loginId: string;
  role: 'user' | 'admin';
  nickname: string;
  avatarData: string;
  comment: string;
  createdAt: number;
}

export interface ActiveSaveInfo {
  state: BattleState;
  stage: number;
  jobId: JobId;
  difficulty: DifficultyId;
  updatedAt: number;
}

export interface JobStatEntry {
  jobId: JobId;
  difficulty: DifficultyId;
  playCount: number;
  clearCount: number;
}

export interface CollectionData {
  equipCounts: Record<string, number>;
  yakuCounts: Record<string, number>;
}

export interface ScoreRecord {
  id: string;
  jobId: JobId;
  difficulty: DifficultyId;
  totalScore: number;
  stagesCleared: number;
  isWon: boolean;
  breakdown: ScoreBreakdown;
  createdAt: number;
  nickname: string;
  avatarData: string;
}

export interface AdminUserEntry {
  id: string;
  loginId: string;
  role: 'user' | 'admin';
  isSuspended: boolean;
  nickname: string;
  avatarData: string;
  comment: string;
  createdAt: number;
  updatedAt: number;
  totalPlays: number;
  totalClears: number;
  veteranCount: number;
}

export interface CloudAppState {
  initialized: boolean;
  user: UserProfile | null;
  activeSave: ActiveSaveInfo | null;
  jobStats: JobStatEntry[];
  collections: CollectionData;
  veterans: VeteranCharacter[];
  personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
  globalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
  pvpCandidates: VeteranCharacter[];
  adminUsers: AdminUserEntry[];
}

const LS_TOKEN_KEY = 'jantou_session_token_v1';
const LS_AUTOSAVE_KEY = 'jantou_autosave_v1';
const LS_GUEST_DATA_KEY = 'jantou_guest_data_v1';

export const cloudState: CloudAppState = {
  initialized: false,
  user: null,
  activeSave: null,
  jobStats: [],
  collections: { equipCounts: {}, yakuCounts: {} },
  veterans: [],
  personalTop3ByJob: {},
  globalTop3ByJob: {},
  pvpCandidates: [],
  adminUsers: [],
};

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(LS_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string | null) {
  try {
    if (token) localStorage.setItem(LS_TOKEN_KEY, token);
    else localStorage.removeItem(LS_TOKEN_KEY);
  } catch {
    // ignore
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getStoredToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `通信エラーが発生しました (${res.status})`);
  }
  return data;
}

// ---------- ローカル（未ログイン時またはL1キャッシュ）ヘルパー ----------

export function readLocalAutosave(): (ActiveSaveInfo & { userId?: string | null }) | null {
  try {
    const raw = localStorage.getItem(LS_AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.state) return null;
    if (parsed.state.status === 'won' || parsed.state.status === 'lost') {
      localStorage.removeItem(LS_AUTOSAVE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLocalAutosave(state: BattleState | null) {
  try {
    if (!state || state.status === 'won' || state.status === 'lost') {
      localStorage.removeItem(LS_AUTOSAVE_KEY);
      cloudState.activeSave = null;
      return;
    }
    const entry: ActiveSaveInfo & { userId?: string | null } = {
      state,
      stage: state.stage,
      jobId: state.job,
      difficulty: state.difficulty,
      updatedAt: Date.now(),
      userId: cloudState.user?.id ?? null,
    };
    localStorage.setItem(LS_AUTOSAVE_KEY, JSON.stringify(entry));
    cloudState.activeSave = entry;
  } catch {
    // ignore quota errors
  }
}

interface GuestLocalStore {
  jobStats: JobStatEntry[];
  collections: CollectionData;
  veterans: VeteranCharacter[];
  personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
}

function loadGuestStore(): GuestLocalStore {
  try {
    const raw = localStorage.getItem(LS_GUEST_DATA_KEY);
    if (!raw) {
      return {
        jobStats: [],
        collections: { equipCounts: {}, yakuCounts: {} },
        veterans: [],
        personalTop3ByJob: {},
      };
    }
    return JSON.parse(raw) as GuestLocalStore;
  } catch {
    return {
      jobStats: [],
      collections: { equipCounts: {}, yakuCounts: {} },
      veterans: [],
      personalTop3ByJob: {},
    };
  }
}

function saveGuestStore() {
  if (cloudState.user) return;
  try {
    const data: GuestLocalStore = {
      jobStats: cloudState.jobStats,
      collections: cloudState.collections,
      veterans: cloudState.veterans,
      personalTop3ByJob: cloudState.personalTop3ByJob,
    };
    localStorage.setItem(LS_GUEST_DATA_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function applyBootstrapPayload(payload: {
  user: UserProfile;
  activeSave: ActiveSaveInfo | null;
  jobStats: JobStatEntry[];
  collections: CollectionData;
  veterans: VeteranCharacter[];
  personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
}) {
  cloudState.user = payload.user;
  cloudState.jobStats = payload.jobStats ?? [];
  cloudState.collections = payload.collections ?? { equipCounts: {}, yakuCounts: {} };
  cloudState.veterans = payload.veterans ?? [];
  cloudState.personalTop3ByJob = payload.personalTop3ByJob ?? {};

  // LocalStorage の L1 オートセーブと Cloud の L2 オートセーブを比較し、新しい方を採用
  const localSave = readLocalAutosave();
  const cloudSave = payload.activeSave ?? null;

  if (
    localSave &&
    (!localSave.userId || localSave.userId === payload.user.id) &&
    (!cloudSave || localSave.updatedAt >= cloudSave.updatedAt)
  ) {
    cloudState.activeSave = localSave;
    // クラウド側へも非同期で同期しておく
    void syncCloudAutosaveImmediate(localSave.state);
  } else if (cloudSave) {
    cloudState.activeSave = cloudSave;
    writeLocalAutosave(cloudSave.state);
  } else {
    cloudState.activeSave = null;
  }
}

// ---------- 初期ブートストラップ ----------

export async function initCloudSession(): Promise<void> {
  try {
    const res = await apiFetch<{
      authenticated: boolean;
      user: UserProfile | null;
      activeSave?: ActiveSaveInfo | null;
      jobStats?: JobStatEntry[];
      collections?: CollectionData;
      veterans?: VeteranCharacter[];
      personalTop3ByJob?: Partial<Record<JobId, ScoreRecord[]>>;
    }>('/api/auth/me');

    if (res.authenticated && res.user) {
      applyBootstrapPayload({
        user: res.user,
        activeSave: res.activeSave ?? null,
        jobStats: res.jobStats ?? [],
        collections: res.collections ?? { equipCounts: {}, yakuCounts: {} },
        veterans: res.veterans ?? [],
        personalTop3ByJob: res.personalTop3ByJob ?? {},
      });
    } else {
      cloudState.user = null;
      const guest = loadGuestStore();
      cloudState.jobStats = guest.jobStats;
      cloudState.collections = guest.collections;
      cloudState.veterans = guest.veterans;
      cloudState.personalTop3ByJob = guest.personalTop3ByJob;
      cloudState.activeSave = readLocalAutosave();
    }
  } catch {
    cloudState.user = null;
    const guest = loadGuestStore();
    cloudState.jobStats = guest.jobStats;
    cloudState.collections = guest.collections;
    cloudState.veterans = guest.veterans;
    cloudState.personalTop3ByJob = guest.personalTop3ByJob;
    cloudState.activeSave = readLocalAutosave();
  } finally {
    cloudState.initialized = true;
  }
}

// ---------- 認証・プロフィール操作 ----------

export async function registerAccount(params: {
  loginId: string;
  password: string;
  birthDate: string;
  nickname: string;
  avatarData: string;
  comment: string;
}): Promise<void> {
  const res = await apiFetch<{
    token?: string;
    user: UserProfile;
    activeSave: ActiveSaveInfo | null;
    jobStats: JobStatEntry[];
    collections: CollectionData;
    veterans: VeteranCharacter[];
    personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
  }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (res.token) setStoredToken(res.token);
  applyBootstrapPayload(res);
}

export async function loginAccount(loginId: string, password: string): Promise<void> {
  const res = await apiFetch<{
    token?: string;
    user: UserProfile;
    activeSave: ActiveSaveInfo | null;
    jobStats: JobStatEntry[];
    collections: CollectionData;
    veterans: VeteranCharacter[];
    personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
  }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ loginId, password }),
  });
  if (res.token) setStoredToken(res.token);
  applyBootstrapPayload(res);
}

export async function resetPasswordByBirthDate(params: {
  loginId: string;
  birthDate: string;
  newPassword: string;
}): Promise<void> {
  const res = await apiFetch<{
    token?: string;
    user: UserProfile;
    activeSave: ActiveSaveInfo | null;
    jobStats: JobStatEntry[];
    collections: CollectionData;
    veterans: VeteranCharacter[];
    personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
  }>('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (res.token) setStoredToken(res.token);
  applyBootstrapPayload(res);
}

export async function updateProfile(params: {
  nickname: string;
  avatarData: string;
  comment: string;
}): Promise<void> {
  const res = await apiFetch<{ user: UserProfile }>('/api/auth/profile', {
    method: 'PUT',
    body: JSON.stringify(params),
  });
  cloudState.user = res.user;
}

export async function logoutAccount(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  setStoredToken(null);
  cloudState.user = null;
  cloudState.adminUsers = [];
  const guest = loadGuestStore();
  cloudState.jobStats = guest.jobStats;
  cloudState.collections = guest.collections;
  cloudState.veterans = guest.veterans;
  cloudState.personalTop3ByJob = guest.personalTop3ByJob;
  cloudState.activeSave = null;
  writeLocalAutosave(null);
}

// ---------- 2層ハイブリッド・オートセーブ ----------

let cloudSaveTimer: number | null = null;

export async function syncCloudAutosaveImmediate(
  state: BattleState | null,
  keepalive = false,
): Promise<void> {
  if (cloudSaveTimer !== null) {
    window.clearTimeout(cloudSaveTimer);
    cloudSaveTimer = null;
  }
  if (!cloudState.user) return;
  try {
    await apiFetch('/api/game/autosave', {
      method: 'PUT',
      body: JSON.stringify({ state }),
      keepalive,
    });
  } catch {
    // オフライン時は LocalStorage L1 キャッシュが保持する
  }
}

export function saveBattleProgress(state: BattleState | null, immediateCloud = false): void {
  // L1: LocalStorage へ0msで即時書き込み
  writeLocalAutosave(state);

  if (!cloudState.user) return;

  // L2: Cloud DB へ同期（チェックポイント時は即時、通常打牌時は1.5秒デバウンス）
  if (immediateCloud || !state || state.status !== 'playing') {
    void syncCloudAutosaveImmediate(state);
    return;
  }

  if (cloudSaveTimer !== null) {
    window.clearTimeout(cloudSaveTimer);
  }
  cloudSaveTimer = window.setTimeout(() => {
    cloudSaveTimer = null;
    void syncCloudAutosaveImmediate(state);
  }, 1500);
}

// ---------- 戦績・コレクション・スコア記録 ----------

export async function recordBattleStart(jobId: JobId, difficulty: DifficultyId): Promise<void> {
  // ローカル状態を即時反映
  const existing = cloudState.jobStats.find(
    (s) => s.jobId === jobId && s.difficulty === difficulty,
  );
  if (existing) {
    existing.playCount++;
  } else {
    cloudState.jobStats.push({ jobId, difficulty, playCount: 1, clearCount: 0 });
  }
  saveGuestStore();

  if (!cloudState.user) return;
  try {
    const res = await apiFetch<{ jobStats: JobStatEntry[] }>('/api/game/record-play', {
      method: 'POST',
      body: JSON.stringify({ jobId, difficulty }),
    });
    cloudState.jobStats = res.jobStats;
  } catch {
    // ignore
  }
}

export async function recordBattleEnd(
  state: BattleState,
  breakdown: ScoreBreakdown,
): Promise<void> {
  const isWon = state.status === 'won';
  const yakuIds = (state.yakuHistory ?? []).map((y) => y.id);

  // L1 セーブをクリア
  writeLocalAutosave(null);

  if (!cloudState.user) {
    // ゲスト時のローカル集計
    if (isWon) {
      const stat = cloudState.jobStats.find(
        (s) => s.jobId === state.job && s.difficulty === state.difficulty,
      );
      if (stat) stat.clearCount++;
      else {
        cloudState.jobStats.push({
          jobId: state.job,
          difficulty: state.difficulty,
          playCount: 1,
          clearCount: 1,
        });
      }
    }
    for (const eq of state.equipments) {
      cloudState.collections.equipCounts[eq] = (cloudState.collections.equipCounts[eq] ?? 0) + 1;
    }
    for (const yId of yakuIds) {
      cloudState.collections.yakuCounts[yId] = (cloudState.collections.yakuCounts[yId] ?? 0) + 1;
    }
    const list = cloudState.personalTop3ByJob[state.job] ?? [];
    list.push({
      id: `local-${Date.now()}`,
      jobId: state.job,
      difficulty: state.difficulty,
      totalScore: breakdown.totalScore,
      stagesCleared: breakdown.stagesCleared,
      isWon,
      breakdown,
      createdAt: Date.now(),
      nickname: 'ゲスト雀士',
      avatarData: '',
    });
    list.sort((a, b) => b.totalScore - a.totalScore);
    cloudState.personalTop3ByJob[state.job] = list.slice(0, 3);
    saveGuestStore();
    return;
  }

  try {
    const res = await apiFetch<{
      user: UserProfile;
      activeSave: ActiveSaveInfo | null;
      jobStats: JobStatEntry[];
      collections: CollectionData;
      veterans: VeteranCharacter[];
      personalTop3ByJob: Partial<Record<JobId, ScoreRecord[]>>;
    }>('/api/game/record-result', {
      method: 'POST',
      body: JSON.stringify({
        jobId: state.job,
        difficulty: state.difficulty,
        isWon,
        stagesCleared: breakdown.stagesCleared,
        totalScore: breakdown.totalScore,
        breakdown,
        equipments: state.equipments,
        yakuIds,
      }),
    });
    applyBootstrapPayload(res);
  } catch {
    // ignore
  }
}

export async function fetchJobRanking(jobId: JobId): Promise<void> {
  try {
    const res = await apiFetch<{
      jobId: JobId;
      personalTop3: ScoreRecord[];
      globalTop3: ScoreRecord[];
    }>(`/api/game/job-ranking/${jobId}`);
    if (cloudState.user) {
      cloudState.personalTop3ByJob[jobId] = res.personalTop3;
    }
    cloudState.globalTop3ByJob[jobId] = res.globalTop3;
  } catch {
    // ignore
  }
}

// ---------- 「強者共」管理 ----------

export async function saveVeteranToSlot(params: {
  slotIndex: number;
  state: BattleState;
  titleName: string;
  totalScore: number;
  comment: string;
  isMarked: boolean;
}): Promise<void> {
  const yakuSummary: Record<string, number> = {};
  for (const y of params.state.yakuHistory ?? []) {
    yakuSummary[y.name] = (yakuSummary[y.name] ?? 0) + 1;
  }

  if (!cloudState.user) {
    const existing = cloudState.veterans.find((v) => v.slotIndex === params.slotIndex);
    if (existing && existing.isMarked) {
      throw new Error('このスロットは保護マークが付いているため上書きできません');
    }
    const now = Date.now();
    const record: VeteranCharacter = {
      id: existing?.id ?? `guest-vet-${now}-${params.slotIndex}`,
      userId: 'guest',
      slotIndex: params.slotIndex,
      jobId: params.state.job,
      difficulty: params.state.difficulty,
      titleName: params.titleName,
      maxHp: params.state.player.maxHp,
      bonusTileAtk: { ...params.state.bonusTileAtk },
      equipments: [...params.state.equipments],
      yakuSummary,
      totalScore: params.totalScore,
      isMarked: params.isMarked,
      comment: params.comment.trim().slice(0, 20),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    cloudState.veterans = [
      ...cloudState.veterans.filter((v) => v.slotIndex !== params.slotIndex),
      record,
    ].sort((a, b) => a.slotIndex - b.slotIndex);
    saveGuestStore();
    return;
  }

  const res = await apiFetch<{ veterans: VeteranCharacter[] }>('/api/game/veterans', {
    method: 'POST',
    body: JSON.stringify({
      slotIndex: params.slotIndex,
      jobId: params.state.job,
      difficulty: params.state.difficulty,
      titleName: params.titleName,
      maxHp: params.state.player.maxHp,
      bonusTileAtk: params.state.bonusTileAtk,
      equipments: params.state.equipments,
      yakuSummary,
      totalScore: params.totalScore,
      comment: params.comment,
      isMarked: params.isMarked,
    }),
  });
  cloudState.veterans = res.veterans;
}

export async function updateVeteranMeta(
  id: string,
  patch: { isMarked?: boolean; comment?: string },
): Promise<void> {
  if (!cloudState.user) {
    const target = cloudState.veterans.find((v) => v.id === id);
    if (!target) throw new Error('対象データが見つかりません');
    if (patch.isMarked !== undefined) target.isMarked = patch.isMarked;
    if (patch.comment !== undefined) target.comment = patch.comment.trim().slice(0, 20);
    target.updatedAt = Date.now();
    saveGuestStore();
    return;
  }
  const res = await apiFetch<{ veterans: VeteranCharacter[] }>(`/api/game/veterans/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  cloudState.veterans = res.veterans;
}

export async function deleteVeteranById(id: string): Promise<void> {
  if (!cloudState.user) {
    const target = cloudState.veterans.find((v) => v.id === id);
    if (target?.isMarked) {
      throw new Error('保護マークが付いているため削除できません');
    }
    cloudState.veterans = cloudState.veterans.filter((v) => v.id !== id);
    saveGuestStore();
    return;
  }
  const res = await apiFetch<{ veterans: VeteranCharacter[] }>(`/api/game/veterans/${id}`, {
    method: 'DELETE',
  });
  cloudState.veterans = res.veterans;
}

export async function fetchPvpCandidates(): Promise<void> {
  try {
    const res = await apiFetch<{ candidates: VeteranCharacter[] }>('/api/game/pvp-candidates');
    cloudState.pvpCandidates = res.candidates;
  } catch {
    // ignore
  }
}

// ---------- Admin ユーザー管理 ----------

export async function fetchAdminUsers(): Promise<void> {
  const res = await apiFetch<{ users: AdminUserEntry[] }>('/api/admin/users');
  cloudState.adminUsers = res.users;
}

export async function adminUpdateUser(
  userId: string,
  patch: {
    newPassword?: string;
    isSuspended?: boolean;
    nickname?: string;
    comment?: string;
    clearAvatar?: boolean;
  },
): Promise<void> {
  await apiFetch(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  await fetchAdminUsers();
}

export async function adminDeleteUser(userId: string): Promise<void> {
  await apiFetch(`/api/admin/users/${userId}`, {
    method: 'DELETE',
  });
  await fetchAdminUsers();
}

