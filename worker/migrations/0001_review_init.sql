CREATE TABLE IF NOT EXISTS access_codes (
  code_hash TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 1,
  uses_remaining INTEGER,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT,
  email TEXT,
  job_title TEXT,
  institution TEXT,
  latest_degree TEXT,
  years_experience INTEGER,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS review_sessions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL,
  baseline_version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(participant_id, baseline_version)
);

CREATE TABLE IF NOT EXISTS review_changes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  component TEXT NOT NULL,
  path_json TEXT NOT NULL,
  target_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('add','replace','remove','restore','revoke')),
  old_value_json TEXT,
  new_value_json TEXT,
  comment TEXT,
  timestamp_utc TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_review_changes_session ON review_changes(session_id, timestamp_utc);
CREATE INDEX IF NOT EXISTS idx_review_changes_component ON review_changes(component);

CREATE TABLE IF NOT EXISTS review_feedback (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  component TEXT NOT NULL,
  path_json TEXT NOT NULL,
  feedback TEXT NOT NULL,
  timestamp_utc TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_review_feedback_session ON review_feedback(session_id, component);

CREATE TABLE IF NOT EXISTS review_snapshots (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  baseline_version TEXT NOT NULL,
  data_json TEXT NOT NULL,
  change_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_review_snapshots_session_created ON review_snapshots(session_id, created_at DESC);
