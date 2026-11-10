-- Isolated RESEARCH 2.0 infrastructure. The authenticated endpoint also creates
-- these tables lazily; existing business_jobs and Google tables are untouched.
CREATE TABLE IF NOT EXISTS research_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS research_requests (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_requests_time ON research_requests(attempted_at);
