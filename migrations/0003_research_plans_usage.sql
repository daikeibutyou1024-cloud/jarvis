-- Isolated tables, also initialized lazily by authenticated API calls.
-- Existing business_jobs, research_cache and authentication bindings are preserved.
CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created ON ai_usage(created_at);
CREATE TABLE IF NOT EXISTS research_plans (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
