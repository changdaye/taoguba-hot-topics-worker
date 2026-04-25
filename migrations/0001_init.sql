CREATE TABLE IF NOT EXISTS digest_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL,
  candidate_count INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  ai_analysis INTEGER NOT NULL,
  message_text TEXT NOT NULL,
  analysis_text TEXT,
  detailed_report_url TEXT,
  source_items_json TEXT NOT NULL,
  feishu_push_ok INTEGER NOT NULL DEFAULT 0,
  push_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_digest_runs_created_at
  ON digest_runs(created_at DESC);

CREATE TABLE IF NOT EXISTS post_push_state (
  post_id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL,
  last_title TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  last_pushed_at TEXT,
  content_fingerprint TEXT NOT NULL,
  last_run_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_post_push_state_last_seen_at
  ON post_push_state(last_seen_at DESC);
