import { generateId, hashSecret } from './crypto.ts';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  exec(query: string): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login_id TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    birth_date_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    is_suspended INTEGER NOT NULL DEFAULT 0,
    nickname TEXT NOT NULL,
    avatar_data TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    reset_fail_count INTEGER NOT NULL DEFAULT 0,
    reset_locked_until INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_login_id ON users(login_id)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
  `CREATE TABLE IF NOT EXISTS active_saves (
    user_id TEXT PRIMARY KEY,
    battle_state_json TEXT NOT NULL,
    stage INTEGER NOT NULL,
    job_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS user_job_stats (
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    play_count INTEGER NOT NULL DEFAULT 0,
    clear_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, job_id, difficulty)
  )`,
  `CREATE TABLE IF NOT EXISTS user_collections (
    user_id TEXT PRIMARY KEY,
    equip_counts_json TEXT NOT NULL DEFAULT '{}',
    yaku_counts_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS job_scores (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    total_score INTEGER NOT NULL,
    stages_cleared INTEGER NOT NULL,
    is_won INTEGER NOT NULL DEFAULT 0,
    breakdown_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_job_scores_user_job ON job_scores(user_id, job_id, total_score DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_job_scores_global_job ON job_scores(job_id, total_score DESC)`,
  `CREATE TABLE IF NOT EXISTS veterans (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    slot_index INTEGER NOT NULL,
    job_id TEXT NOT NULL,
    difficulty TEXT NOT NULL,
    title_name TEXT NOT NULL,
    max_hp INTEGER NOT NULL,
    bonus_tile_atk_json TEXT NOT NULL,
    equipments_json TEXT NOT NULL,
    yaku_summary_json TEXT NOT NULL DEFAULT '{}',
    total_score INTEGER NOT NULL,
    is_marked INTEGER NOT NULL DEFAULT 0,
    comment TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (user_id, slot_index)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_veterans_user ON veterans(user_id, slot_index)`,
  `CREATE INDEX IF NOT EXISTS idx_veterans_score ON veterans(total_score DESC)`,
];

const initializedDbs = new WeakSet<D1Database>();

export async function ensureDatabaseInitialized(db: D1Database): Promise<void> {
  if (initializedDbs.has(db)) return;

  for (const stmt of SCHEMA_STATEMENTS) {
    await db.prepare(stmt).run();
  }

  // Adminユーザー（ID: d-mukai, Pass: 6k1dJAN@30）の配備確認
  const adminLoginId = 'd-mukai';
  const existingAdmin = await db
    .prepare('SELECT id, role FROM users WHERE login_id = ?')
    .bind(adminLoginId)
    .first<{ id: string; role: string }>();

  const now = Date.now();
  if (!existingAdmin) {
    const adminId = generateId();
    const passHash = await hashSecret('6k1dJAN@30');
    const birthHash = await hashSecret('1990-01-01');
    await db
      .prepare(
        `INSERT INTO users (
          id, login_id, password_hash, birth_date_hash, role, is_suspended,
          nickname, avatar_data, comment, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'admin', 0, ?, '', ?, ?, ?)`,
      )
      .bind(adminId, adminLoginId, passHash, birthHash, 'd-mukai (Admin)', 'システム管理者', now, now)
      .run();
  } else if (existingAdmin.role !== 'admin') {
    await db
      .prepare(`UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`)
      .bind(now, existingAdmin.id)
      .run();
  }

  initializedDbs.add(db);
}
