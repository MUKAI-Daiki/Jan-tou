import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  generateId,
  generateSessionToken,
  hashSecret,
  normalizeBirthDate,
  verifySecret,
} from './crypto.ts';
import { D1Database, Env, ensureDatabaseInitialized } from './db.ts';

const SESSION_COOKIE = 'jantou_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

interface DbUserRow {
  id: string;
  login_id: string;
  password_hash: string;
  birth_date_hash: string;
  role: 'user' | 'admin';
  is_suspended: number;
  nickname: string;
  avatar_data: string;
  comment: string;
  reset_fail_count: number;
  reset_locked_until: number;
  created_at: number;
  updated_at: number;
}

type Variables = {
  user: DbUserRow | null;
};

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function countChars(str: string): number {
  return [...str].length;
}

async function getAuthenticatedUser(db: D1Database, token: string | undefined): Promise<DbUserRow | null> {
  if (!token) return null;
  const now = Date.now();
  const sess = await db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?')
    .bind(token)
    .first<{ user_id: string; expires_at: number }>();
  if (!sess || sess.expires_at < now) {
    if (sess) {
      await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    }
    return null;
  }
  const user = await db
    .prepare('SELECT * FROM users WHERE id = ?')
    .bind(sess.user_id)
    .first<DbUserRow>();
  if (!user || user.is_suspended) return null;
  return user;
}

async function buildUserBootstrapPayload(db: D1Database, user: DbUserRow) {
  const activeSaveRow = await db
    .prepare('SELECT battle_state_json, stage, job_id, difficulty, updated_at FROM active_saves WHERE user_id = ?')
    .bind(user.id)
    .first<{
      battle_state_json: string;
      stage: number;
      job_id: string;
      difficulty: string;
      updated_at: number;
    }>();

  const jobStatsRows = await db
    .prepare('SELECT job_id, difficulty, play_count, clear_count FROM user_job_stats WHERE user_id = ?')
    .bind(user.id)
    .all<{ job_id: string; difficulty: string; play_count: number; clear_count: number }>();

  const colRow = await db
    .prepare('SELECT equip_counts_json, yaku_counts_json FROM user_collections WHERE user_id = ?')
    .bind(user.id)
    .first<{ equip_counts_json: string; yaku_counts_json: string }>();

  const veteranRows = await db
    .prepare('SELECT * FROM veterans WHERE user_id = ? ORDER BY slot_index ASC')
    .bind(user.id)
    .all<{
      id: string;
      user_id: string;
      slot_index: number;
      job_id: string;
      difficulty: string;
      title_name: string;
      max_hp: number;
      bonus_tile_atk_json: string;
      equipments_json: string;
      yaku_summary_json: string;
      total_score: number;
      is_marked: number;
      comment: string;
      created_at: number;
      updated_at: number;
    }>();

  const scoreRows = await db
    .prepare(
      `SELECT id, job_id, difficulty, total_score, stages_cleared, is_won, breakdown_json, created_at
       FROM job_scores WHERE user_id = ? ORDER BY total_score DESC LIMIT 100`,
    )
    .bind(user.id)
    .all<{
      id: string;
      job_id: string;
      difficulty: string;
      total_score: number;
      stages_cleared: number;
      is_won: number;
      breakdown_json: string;
      created_at: number;
    }>();

  const personalTop3ByJob: Record<string, unknown[]> = {};
  for (const r of scoreRows.results) {
    const list = personalTop3ByJob[r.job_id] ?? [];
    if (list.length < 3) {
      let breakdown = {};
      try {
        breakdown = JSON.parse(r.breakdown_json);
      } catch {
        // ignore
      }
      list.push({
        id: r.id,
        jobId: r.job_id,
        difficulty: r.difficulty,
        totalScore: r.total_score,
        stagesCleared: r.stages_cleared,
        isWon: Boolean(r.is_won),
        breakdown,
        createdAt: r.created_at,
        nickname: user.nickname,
        avatarData: user.avatar_data,
      });
      personalTop3ByJob[r.job_id] = list;
    }
  }

  let activeSave = null;
  if (activeSaveRow) {
    try {
      activeSave = {
        state: JSON.parse(activeSaveRow.battle_state_json),
        stage: activeSaveRow.stage,
        jobId: activeSaveRow.job_id,
        difficulty: activeSaveRow.difficulty,
        updatedAt: activeSaveRow.updated_at,
      };
    } catch {
      activeSave = null;
    }
  }

  let equipCounts: Record<string, number> = {};
  let yakuCounts: Record<string, number> = {};
  if (colRow) {
    try {
      equipCounts = JSON.parse(colRow.equip_counts_json);
    } catch {
      equipCounts = {};
    }
    try {
      yakuCounts = JSON.parse(colRow.yaku_counts_json);
    } catch {
      yakuCounts = {};
    }
  }

  const veterans = veteranRows.results.map((v) => ({
    id: v.id,
    userId: v.user_id,
    slotIndex: v.slot_index,
    jobId: v.job_id,
    difficulty: v.difficulty,
    titleName: v.title_name,
    maxHp: v.max_hp,
    bonusTileAtk: JSON.parse(v.bonus_tile_atk_json || '{}'),
    equipments: JSON.parse(v.equipments_json || '[]'),
    yakuSummary: JSON.parse(v.yaku_summary_json || '{}'),
    totalScore: v.total_score,
    isMarked: Boolean(v.is_marked),
    comment: v.comment,
    createdAt: v.created_at,
    updatedAt: v.updated_at,
  }));

  return {
    user: {
      id: user.id,
      loginId: user.login_id,
      role: user.role,
      nickname: user.nickname,
      avatarData: user.avatar_data,
      comment: user.comment,
      createdAt: user.created_at,
    },
    activeSave,
    jobStats: jobStatsRows.results.map((s) => ({
      jobId: s.job_id,
      difficulty: s.difficulty,
      playCount: s.play_count,
      clearCount: s.clear_count,
    })),
    collections: {
      equipCounts,
      yakuCounts,
    },
    veterans,
    personalTop3ByJob,
  };
}

// 共通ミドルウェア：DB初期化＋セッション解決
app.use('/api/*', async (c, next) => {
  await ensureDatabaseInitialized(c.env.DB);
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const cookieToken = getCookie(c, SESSION_COOKIE);
  const token = bearerToken || cookieToken;
  const user = await getAuthenticatedUser(c.env.DB, token);
  c.set('user', user);
  await next();
});

// ========================
// 1. 認証・プロフィール API
// ========================

app.get('/api/auth/me', async (c) => {
  const user = c.get('user');
  if (!user) {
    return c.json({ authenticated: false, user: null });
  }
  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ authenticated: true, ...payload });
});

app.post('/api/auth/register', async (c) => {
  const body = await c.req.json<{
    loginId?: string;
    password?: string;
    birthDate?: string;
    nickname?: string;
    avatarData?: string;
    comment?: string;
  }>();

  const loginId = (body.loginId ?? '').trim();
  const password = body.password ?? '';
  const birthDateNorm = normalizeBirthDate(body.birthDate ?? '');
  const nickname = (body.nickname ?? loginId).trim();
  const avatarData = body.avatarData ?? '';
  const comment = (body.comment ?? '').trim();

  if (!/^[a-zA-Z0-9_-]{3,24}$/.test(loginId)) {
    return c.json(
      { error: 'ユーザーIDは半角英数字・ハイフン・アンダースコア（3〜24文字）で入力してください' },
      400,
    );
  }
  if (password.length < 6 || password.length > 64) {
    return c.json({ error: 'パスワードは6文字以上64文字以内で設定してください' }, 400);
  }
  if (!birthDateNorm) {
    return c.json({ error: '生年月日を正しく入力してください（例: 2000-01-01）' }, 400);
  }
  if (countChars(nickname) < 1 || countChars(nickname) > 16) {
    return c.json({ error: 'ニックネームは1〜16文字で入力してください' }, 400);
  }
  if (countChars(comment) > 20) {
    return c.json({ error: 'コメントは全角20文字以内で入力してください' }, 400);
  }
  if (avatarData && (!avatarData.startsWith('data:image/') || avatarData.length > 200_000)) {
    return c.json({ error: 'アイコン画像データが不正かサイズが大きすぎます' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE login_id = ?')
    .bind(loginId)
    .first();
  if (existing) {
    return c.json({ error: 'このユーザーIDは既に使用されています' }, 409);
  }

  const userId = generateId();
  const passHash = await hashSecret(password);
  const birthHash = await hashSecret(birthDateNorm);
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO users (
      id, login_id, password_hash, birth_date_hash, role, is_suspended,
      nickname, avatar_data, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'user', 0, ?, ?, ?, ?, ?)`,
  )
    .bind(userId, loginId, passHash, birthHash, nickname, avatarData, comment, now, now)
    .run();

  const token = generateSessionToken();
  await c.env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, userId, now + SESSION_TTL_MS, now)
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  const newUser = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(userId)
    .first<DbUserRow>();
  const payload = await buildUserBootstrapPayload(c.env.DB, newUser!);
  return c.json({ authenticated: true, token, ...payload });
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json<{ loginId?: string; password?: string }>();
  const loginId = (body.loginId ?? '').trim();
  const password = body.password ?? '';

  if (!loginId || !password) {
    return c.json({ error: 'ユーザーIDとパスワードを入力してください' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE login_id = ?')
    .bind(loginId)
    .first<DbUserRow>();
  if (!user) {
    return c.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, 401);
  }
  if (user.is_suspended) {
    return c.json({ error: 'このアカウントは現在利用停止されています' }, 403);
  }

  const valid = await verifySecret(password, user.password_hash);
  if (!valid) {
    return c.json({ error: 'ユーザーIDまたはパスワードが正しくありません' }, 401);
  }

  const now = Date.now();
  const token = generateSessionToken();
  await c.env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, user.id, now + SESSION_TTL_MS, now)
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ authenticated: true, token, ...payload });
});

app.post('/api/auth/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
  const cookieToken = getCookie(c, SESSION_COOKIE);
  const token = bearerToken || cookieToken;
  if (token) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

app.post('/api/auth/reset-password', async (c) => {
  const body = await c.req.json<{
    loginId?: string;
    birthDate?: string;
    newPassword?: string;
  }>();

  const loginId = (body.loginId ?? '').trim();
  const birthDateNorm = normalizeBirthDate(body.birthDate ?? '');
  const newPassword = body.newPassword ?? '';

  if (!loginId || !birthDateNorm) {
    return c.json({ error: 'ユーザーIDと生年月日を正しく入力してください' }, 400);
  }
  if (newPassword.length < 6 || newPassword.length > 64) {
    return c.json({ error: '新しいパスワードは6文字以上64文字以内で入力してください' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE login_id = ?')
    .bind(loginId)
    .first<DbUserRow>();

  if (!user) {
    return c.json({ error: 'ユーザーIDまたは生年月日が一致しません' }, 401);
  }

  const now = Date.now();
  if (user.reset_locked_until > now) {
    const waitMin = Math.ceil((user.reset_locked_until - now) / 60000);
    return c.json(
      { error: `試行回数が上限に達しました。あと約${waitMin}分後に再試行してください` },
      429,
    );
  }

  const match = await verifySecret(birthDateNorm, user.birth_date_hash);
  if (!match) {
    const nextFail = (user.reset_fail_count ?? 0) + 1;
    const lockUntil = nextFail >= 5 ? now + 15 * 60 * 1000 : 0;
    await c.env.DB.prepare(
      'UPDATE users SET reset_fail_count = ?, reset_locked_until = ? WHERE id = ?',
    )
      .bind(nextFail >= 5 ? 0 : nextFail, lockUntil, user.id)
      .run();
    return c.json({ error: 'ユーザーIDまたは生年月日が一致しません' }, 401);
  }

  const newPassHash = await hashSecret(newPassword);
  await c.env.DB.prepare(
    `UPDATE users
     SET password_hash = ?, reset_fail_count = 0, reset_locked_until = 0, updated_at = ?
     WHERE id = ?`,
  )
    .bind(newPassHash, now, user.id)
    .run();

  // 既存セッションをクリアして新規ログインセッションを発行
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id).run();
  const token = generateSessionToken();
  await c.env.DB.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, user.id, now + SESSION_TTL_MS, now)
    .run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ authenticated: true, token, ...payload });
});

app.put('/api/auth/profile', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const body = await c.req.json<{
    nickname?: string;
    avatarData?: string;
    comment?: string;
  }>();

  const nickname = (body.nickname ?? user.nickname).trim();
  const avatarData = body.avatarData !== undefined ? body.avatarData : user.avatar_data;
  const comment = (body.comment !== undefined ? body.comment : user.comment).trim();

  if (countChars(nickname) < 1 || countChars(nickname) > 16) {
    return c.json({ error: 'ニックネームは1〜16文字で入力してください' }, 400);
  }
  if (countChars(comment) > 20) {
    return c.json({ error: 'コメントは全角20文字以内で入力してください' }, 400);
  }
  if (avatarData && (!avatarData.startsWith('data:image/') || avatarData.length > 200_000)) {
    return c.json({ error: 'アイコン画像データが不正かサイズが大きすぎます' }, 400);
  }

  const now = Date.now();
  await c.env.DB.prepare(
    'UPDATE users SET nickname = ?, avatar_data = ?, comment = ?, updated_at = ? WHERE id = ?',
  )
    .bind(nickname, avatarData, comment, now, user.id)
    .run();

  return c.json({
    ok: true,
    user: {
      id: user.id,
      loginId: user.login_id,
      role: user.role,
      nickname,
      avatarData,
      comment,
      createdAt: user.created_at,
    },
  });
});

// ========================
// 2. ゲームデータ・保存 API
// ========================

app.put('/api/game/autosave', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const body = await c.req.json<{
    state: {
      stage?: number;
      job?: string;
      difficulty?: string;
      status?: string;
    } | null;
  }>();

  if (!body.state || body.state.status === 'won' || body.state.status === 'lost') {
    await c.env.DB.prepare('DELETE FROM active_saves WHERE user_id = ?').bind(user.id).run();
    return c.json({ ok: true, saved: false });
  }

  const now = Date.now();
  const jsonStr = JSON.stringify(body.state);
  const stage = Number(body.state.stage ?? 1);
  const jobId = String(body.state.job ?? 'sword');
  const difficulty = String(body.state.difficulty ?? 'beginner');

  await c.env.DB.prepare(
    `INSERT INTO active_saves (user_id, battle_state_json, stage, job_id, difficulty, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       battle_state_json = excluded.battle_state_json,
       stage = excluded.stage,
       job_id = excluded.job_id,
       difficulty = excluded.difficulty,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, jsonStr, stage, jobId, difficulty, now)
    .run();

  return c.json({ ok: true, saved: true, updatedAt: now });
});

app.post('/api/game/record-play', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const body = await c.req.json<{ jobId: string; difficulty: string }>();
  const jobId = String(body.jobId || 'sword');
  const difficulty = String(body.difficulty || 'beginner');

  await c.env.DB.prepare(
    `INSERT INTO user_job_stats (user_id, job_id, difficulty, play_count, clear_count)
     VALUES (?, ?, ?, 1, 0)
     ON CONFLICT(user_id, job_id, difficulty) DO UPDATE SET
       play_count = play_count + 1`,
  )
    .bind(user.id, jobId, difficulty)
    .run();

  const statsRows = await c.env.DB.prepare(
    'SELECT job_id, difficulty, play_count, clear_count FROM user_job_stats WHERE user_id = ?',
  )
    .bind(user.id)
    .all<{ job_id: string; difficulty: string; play_count: number; clear_count: number }>();

  return c.json({
    ok: true,
    jobStats: statsRows.results.map((s) => ({
      jobId: s.job_id,
      difficulty: s.difficulty,
      playCount: s.play_count,
      clearCount: s.clear_count,
    })),
  });
});

app.post('/api/game/record-result', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const body = await c.req.json<{
    jobId: string;
    difficulty: string;
    isWon: boolean;
    stagesCleared: number;
    totalScore: number;
    breakdown: unknown;
    equipments: string[];
    yakuIds: string[];
  }>();

  const jobId = String(body.jobId || 'sword');
  const difficulty = String(body.difficulty || 'beginner');
  const isWon = Boolean(body.isWon);
  const stagesCleared = Number(body.stagesCleared ?? 0);
  const totalScore = Number(body.totalScore ?? 0);
  const now = Date.now();

  // 1. クリア数更新
  if (isWon) {
    await c.env.DB.prepare(
      `INSERT INTO user_job_stats (user_id, job_id, difficulty, play_count, clear_count)
       VALUES (?, ?, ?, 1, 1)
       ON CONFLICT(user_id, job_id, difficulty) DO UPDATE SET
         clear_count = clear_count + 1`,
    )
      .bind(user.id, jobId, difficulty)
      .run();
  }

  // 2. 装備コレクション＆役成立数の更新
  const existingCol = await c.env.DB.prepare(
    'SELECT equip_counts_json, yaku_counts_json FROM user_collections WHERE user_id = ?',
  )
    .bind(user.id)
    .first<{ equip_counts_json: string; yaku_counts_json: string }>();

  const equipCounts: Record<string, number> = existingCol
    ? JSON.parse(existingCol.equip_counts_json || '{}')
    : {};
  const yakuCounts: Record<string, number> = existingCol
    ? JSON.parse(existingCol.yaku_counts_json || '{}')
    : {};

  for (const eqId of body.equipments ?? []) {
    equipCounts[eqId] = (equipCounts[eqId] ?? 0) + 1;
  }
  for (const yId of body.yakuIds ?? []) {
    yakuCounts[yId] = (yakuCounts[yId] ?? 0) + 1;
  }

  await c.env.DB.prepare(
    `INSERT INTO user_collections (user_id, equip_counts_json, yaku_counts_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       equip_counts_json = excluded.equip_counts_json,
       yaku_counts_json = excluded.yaku_counts_json,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, JSON.stringify(equipCounts), JSON.stringify(yakuCounts), now)
    .run();

  // 3. スコア記録
  const scoreId = generateId();
  await c.env.DB.prepare(
    `INSERT INTO job_scores (
      id, user_id, job_id, difficulty, total_score, stages_cleared, is_won, breakdown_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      scoreId,
      user.id,
      jobId,
      difficulty,
      totalScore,
      stagesCleared,
      isWon ? 1 : 0,
      JSON.stringify(body.breakdown ?? {}),
      now,
    )
    .run();

  // 4. 進行中セーブデータの削除
  await c.env.DB.prepare('DELETE FROM active_saves WHERE user_id = ?').bind(user.id).run();

  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ ok: true, ...payload });
});

app.get('/api/game/job-ranking/:jobId', async (c) => {
  const jobId = c.req.param('jobId');
  const user = c.get('user');

  const globalRows = await c.env.DB.prepare(
    `SELECT s.id, s.job_id, s.difficulty, s.total_score, s.stages_cleared, s.is_won, s.breakdown_json, s.created_at,
            u.nickname, u.avatar_data
     FROM job_scores s
     JOIN users u ON u.id = s.user_id
     WHERE s.job_id = ? AND u.is_suspended = 0
     ORDER BY s.total_score DESC
     LIMIT 3`,
  )
    .bind(jobId)
    .all<{
      id: string;
      job_id: string;
      difficulty: string;
      total_score: number;
      stages_cleared: number;
      is_won: number;
      breakdown_json: string;
      created_at: number;
      nickname: string;
      avatar_data: string;
    }>();

  let personalTop3: unknown[] = [];
  if (user) {
    const personalRows = await c.env.DB.prepare(
      `SELECT id, job_id, difficulty, total_score, stages_cleared, is_won, breakdown_json, created_at
       FROM job_scores
       WHERE user_id = ? AND job_id = ?
       ORDER BY total_score DESC
       LIMIT 3`,
    )
      .bind(user.id, jobId)
      .all<{
        id: string;
        job_id: string;
        difficulty: string;
        total_score: number;
        stages_cleared: number;
        is_won: number;
        breakdown_json: string;
        created_at: number;
      }>();

    personalTop3 = personalRows.results.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      difficulty: r.difficulty,
      totalScore: r.total_score,
      stagesCleared: r.stages_cleared,
      isWon: Boolean(r.is_won),
      breakdown: JSON.parse(r.breakdown_json || '{}'),
      createdAt: r.created_at,
      nickname: user.nickname,
      avatarData: user.avatar_data,
    }));
  }

  return c.json({
    jobId,
    personalTop3,
    globalTop3: globalRows.results.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      difficulty: r.difficulty,
      totalScore: r.total_score,
      stagesCleared: r.stages_cleared,
      isWon: Boolean(r.is_won),
      breakdown: JSON.parse(r.breakdown_json || '{}'),
      createdAt: r.created_at,
      nickname: r.nickname,
      avatarData: r.avatar_data,
    })),
  });
});

// ========================
// 3. 「強者共」管理 API
// ========================

app.post('/api/game/veterans', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const body = await c.req.json<{
    slotIndex: number;
    jobId: string;
    difficulty: string;
    titleName: string;
    maxHp: number;
    bonusTileAtk: Record<string, number>;
    equipments: string[];
    yakuSummary?: Record<string, number>;
    totalScore: number;
    comment?: string;
    isMarked?: boolean;
  }>();

  const slotIndex = Number(body.slotIndex);
  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 9) {
    return c.json({ error: '保存スロットは 0〜9 の範囲で指定してください' }, 400);
  }

  const comment = (body.comment ?? '').trim();
  if (countChars(comment) > 20) {
    return c.json({ error: 'コメントは全角20文字以内で入力してください' }, 400);
  }

  const existing = await c.env.DB.prepare(
    'SELECT id, is_marked FROM veterans WHERE user_id = ? AND slot_index = ?',
  )
    .bind(user.id, slotIndex)
    .first<{ id: string; is_marked: number }>();

  if (existing && existing.is_marked) {
    return c.json(
      { error: 'このスロットは保護マークが付いているため上書きできません。先にマークを解除してください' },
      409,
    );
  }

  const now = Date.now();
  const vetId = existing?.id ?? generateId();

  await c.env.DB.prepare(
    `INSERT INTO veterans (
      id, user_id, slot_index, job_id, difficulty, title_name,
      max_hp, bonus_tile_atk_json, equipments_json, yaku_summary_json,
      total_score, is_marked, comment, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, slot_index) DO UPDATE SET
      job_id = excluded.job_id,
      difficulty = excluded.difficulty,
      title_name = excluded.title_name,
      max_hp = excluded.max_hp,
      bonus_tile_atk_json = excluded.bonus_tile_atk_json,
      equipments_json = excluded.equipments_json,
      yaku_summary_json = excluded.yaku_summary_json,
      total_score = excluded.total_score,
      is_marked = excluded.is_marked,
      comment = excluded.comment,
      updated_at = excluded.updated_at`,
  )
    .bind(
      vetId,
      user.id,
      slotIndex,
      body.jobId,
      body.difficulty,
      body.titleName,
      Number(body.maxHp ?? 300),
      JSON.stringify(body.bonusTileAtk ?? {}),
      JSON.stringify(body.equipments ?? []),
      JSON.stringify(body.yakuSummary ?? {}),
      Number(body.totalScore ?? 0),
      body.isMarked ? 1 : 0,
      comment,
      now,
      now,
    )
    .run();

  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ ok: true, veterans: payload.veterans });
});

app.patch('/api/game/veterans/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const vetId = c.req.param('id');
  const body = await c.req.json<{ isMarked?: boolean; comment?: string }>();

  const existing = await c.env.DB.prepare(
    'SELECT id, is_marked, comment FROM veterans WHERE id = ? AND user_id = ?',
  )
    .bind(vetId, user.id)
    .first<{ id: string; is_marked: number; comment: string }>();

  if (!existing) {
    return c.json({ error: '対象の強者データが見つかりません' }, 404);
  }

  const nextMarked = body.isMarked !== undefined ? (body.isMarked ? 1 : 0) : existing.is_marked;
  const nextComment = body.comment !== undefined ? body.comment.trim() : existing.comment;

  if (countChars(nextComment) > 20) {
    return c.json({ error: 'コメントは全角20文字以内で入力してください' }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE veterans SET is_marked = ?, comment = ?, updated_at = ? WHERE id = ? AND user_id = ?',
  )
    .bind(nextMarked, nextComment, Date.now(), vetId, user.id)
    .run();

  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ ok: true, veterans: payload.veterans });
});

app.delete('/api/game/veterans/:id', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ error: 'ログインが必要です' }, 401);

  const vetId = c.req.param('id');
  const existing = await c.env.DB.prepare(
    'SELECT id, is_marked FROM veterans WHERE id = ? AND user_id = ?',
  )
    .bind(vetId, user.id)
    .first<{ id: string; is_marked: number }>();

  if (!existing) {
    return c.json({ error: '対象の強者データが見つかりません' }, 404);
  }
  if (existing.is_marked) {
    return c.json(
      { error: '保護マークが付いているため削除できません。先にマークを解除してください' },
      409,
    );
  }

  await c.env.DB.prepare('DELETE FROM veterans WHERE id = ? AND user_id = ?')
    .bind(vetId, user.id)
    .run();

  const payload = await buildUserBootstrapPayload(c.env.DB, user);
  return c.json({ ok: true, veterans: payload.veterans });
});

// 対人戦（強者共アリーナ）用の公開データ取得エンドポイント
app.get('/api/game/pvp-candidates', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT v.*, u.nickname AS owner_nickname, u.avatar_data AS owner_avatar, u.comment AS owner_comment
     FROM veterans v
     JOIN users u ON u.id = v.user_id
     WHERE u.is_suspended = 0
     ORDER BY v.total_score DESC
     LIMIT 30`,
  ).all<{
    id: string;
    user_id: string;
    slot_index: number;
    job_id: string;
    difficulty: string;
    title_name: string;
    max_hp: number;
    bonus_tile_atk_json: string;
    equipments_json: string;
    yaku_summary_json: string;
    total_score: number;
    is_marked: number;
    comment: string;
    created_at: number;
    updated_at: number;
    owner_nickname: string;
    owner_avatar: string;
    owner_comment: string;
  }>();

  return c.json({
    candidates: rows.results.map((v) => ({
      id: v.id,
      userId: v.user_id,
      slotIndex: v.slot_index,
      jobId: v.job_id,
      difficulty: v.difficulty,
      titleName: v.title_name,
      maxHp: v.max_hp,
      bonusTileAtk: JSON.parse(v.bonus_tile_atk_json || '{}'),
      equipments: JSON.parse(v.equipments_json || '[]'),
      yakuSummary: JSON.parse(v.yaku_summary_json || '{}'),
      totalScore: v.total_score,
      isMarked: Boolean(v.is_marked),
      comment: v.comment,
      createdAt: v.created_at,
      updatedAt: v.updated_at,
      ownerNickname: v.owner_nickname,
      ownerAvatar: v.owner_avatar,
      ownerComment: v.owner_comment,
    })),
  });
});

// ========================
// 4. Admin ユーザー管理 API (d-mukai 等 admin 専用)
// ========================

app.use('/api/admin/*', async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return c.json({ error: '管理者権限が必要です' }, 403);
  }
  await next();
});

app.get('/api/admin/users', async (c) => {
  const usersRes = await c.env.DB.prepare(
    `SELECT u.id, u.login_id, u.role, u.is_suspended, u.nickname, u.avatar_data, u.comment, u.created_at, u.updated_at,
            (SELECT COALESCE(SUM(play_count), 0) FROM user_job_stats s WHERE s.user_id = u.id) AS total_plays,
            (SELECT COALESCE(SUM(clear_count), 0) FROM user_job_stats s WHERE s.user_id = u.id) AS total_clears,
            (SELECT COUNT(*) FROM veterans v WHERE v.user_id = u.id) AS veteran_count
     FROM users u
     ORDER BY u.created_at DESC`,
  ).all<{
    id: string;
    login_id: string;
    role: 'user' | 'admin';
    is_suspended: number;
    nickname: string;
    avatar_data: string;
    comment: string;
    created_at: number;
    updated_at: number;
    total_plays: number;
    total_clears: number;
    veteran_count: number;
  }>();

  return c.json({
    users: usersRes.results.map((u) => ({
      id: u.id,
      loginId: u.login_id,
      role: u.role,
      isSuspended: Boolean(u.is_suspended),
      nickname: u.nickname,
      avatarData: u.avatar_data,
      comment: u.comment,
      createdAt: u.created_at,
      updatedAt: u.updated_at,
      totalPlays: u.total_plays,
      totalClears: u.total_clears,
      veteranCount: u.veteran_count,
    })),
  });
});

app.patch('/api/admin/users/:id', async (c) => {
  const targetId = c.req.param('id');
  const currentAdmin = c.get('user')!;
  const body = await c.req.json<{
    newPassword?: string;
    isSuspended?: boolean;
    nickname?: string;
    comment?: string;
    clearAvatar?: boolean;
  }>();

  const target = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?')
    .bind(targetId)
    .first<DbUserRow>();
  if (!target) {
    return c.json({ error: '対象ユーザーが見つかりません' }, 404);
  }

  if (target.id === currentAdmin.id && body.isSuspended) {
    return c.json({ error: '自分自身の管理者アカウントを停止することはできません' }, 400);
  }

  const now = Date.now();
  if (body.newPassword) {
    if (body.newPassword.length < 6) {
      return c.json({ error: 'パスワードは6文字以上で指定してください' }, 400);
    }
    const passHash = await hashSecret(body.newPassword);
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, reset_fail_count = 0, reset_locked_until = 0, updated_at = ? WHERE id = ?',
    )
      .bind(passHash, now, targetId)
      .run();
  }

  const nextSuspended =
    body.isSuspended !== undefined ? (body.isSuspended ? 1 : 0) : target.is_suspended;
  const nextNickname = body.nickname !== undefined ? body.nickname.trim() : target.nickname;
  const nextComment = body.comment !== undefined ? body.comment.trim() : target.comment;
  const nextAvatar = body.clearAvatar ? '' : target.avatar_data;

  await c.env.DB.prepare(
    'UPDATE users SET is_suspended = ?, nickname = ?, comment = ?, avatar_data = ?, updated_at = ? WHERE id = ?',
  )
    .bind(nextSuspended, nextNickname, nextComment, nextAvatar, now, targetId)
    .run();

  if (nextSuspended) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
  }

  return c.json({ ok: true });
});

app.delete('/api/admin/users/:id', async (c) => {
  const targetId = c.req.param('id');
  const currentAdmin = c.get('user')!;

  const target = await c.env.DB.prepare('SELECT id, login_id FROM users WHERE id = ?')
    .bind(targetId)
    .first<{ id: string; login_id: string }>();

  if (!target) {
    return c.json({ error: '対象ユーザーが見つかりません' }, 404);
  }
  if (target.id === currentAdmin.id || target.login_id === 'd-mukai') {
    return c.json({ error: 'メインAdminアカウント（d-mukai）は削除できません' }, 400);
  }

  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM active_saves WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM user_job_stats WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM user_collections WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM job_scores WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM veterans WHERE user_id = ?').bind(targetId).run();
  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();

  return c.json({ ok: true });
});

// Cloudflare Workers エントリーポイント (API + Static Assets)
export default {
  async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return app.fetch(request, env, ctx as never);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return app.fetch(request, env, ctx as never);
  },
};
