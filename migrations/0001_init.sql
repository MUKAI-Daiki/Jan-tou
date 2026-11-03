-- 雀闘 (Jantou) Cloudflare D1 初期スキーマ
CREATE TABLE IF NOT EXISTS users (
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
);

CREATE INDEX IF NOT EXISTS idx_users_login_id ON users(login_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);

CREATE TABLE IF NOT EXISTS active_saves (
  user_id TEXT PRIMARY KEY,
  battle_state_json TEXT NOT NULL,
  stage INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_job_stats (
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 0,
  clear_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, job_id, difficulty),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_collections (
  user_id TEXT PRIMARY KEY,
  equip_counts_json TEXT NOT NULL DEFAULT '{}',
  yaku_counts_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_scores (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  total_score INTEGER NOT NULL,
  stages_cleared INTEGER NOT NULL,
  is_won INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_scores_user_job ON job_scores(user_id, job_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_job_scores_global_job ON job_scores(job_id, total_score DESC);

CREATE TABLE IF NOT EXISTS veterans (
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
  UNIQUE (user_id, slot_index),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_veterans_user ON veterans(user_id, slot_index);
CREATE INDEX IF NOT EXISTS idx_veterans_score ON veterans(total_score DESC);

