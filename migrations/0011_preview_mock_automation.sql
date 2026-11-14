-- Preview mock only. Matches the four existing jarvis-preview tables.
-- Never apply to Production. Runtime does not create or migrate tables.
CREATE TABLE IF NOT EXISTS automation_control (
 scope TEXT PRIMARY KEY, state TEXT NOT NULL, epoch INTEGER NOT NULL, version INTEGER NOT NULL,
 lease_run_id TEXT, lease_until INTEGER, clock_ms INTEGER, last_write_id TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_events (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL, run_id TEXT, kind TEXT NOT NULL,
 at INTEGER NOT NULL, diagnostic_id TEXT, reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS automation_runs (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL, day TEXT NOT NULL, step TEXT NOT NULL,
 project_id TEXT NOT NULL, state TEXT NOT NULL, epoch INTEGER NOT NULL,
 started_at INTEGER NOT NULL, deadline INTEGER NOT NULL, finished_at INTEGER,
 diagnostic_id TEXT NOT NULL, reason TEXT NOT NULL, input_json TEXT NOT NULL,
 result_json TEXT, write_token TEXT, mock_calls INTEGER NOT NULL DEFAULT 0,
 reserved_micro INTEGER NOT NULL DEFAULT 0, mock_cost_micro INTEGER NOT NULL DEFAULT 0,
 UNIQUE(scope,day,step)
);
CREATE TABLE IF NOT EXISTS automation_work_items (
 id TEXT PRIMARY KEY, scope TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL,
 version INTEGER NOT NULL, state TEXT NOT NULL, payload_json TEXT NOT NULL,
 origin_run_id TEXT NOT NULL, last_write_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_automation_events_time ON automation_events(scope,at);
CREATE INDEX IF NOT EXISTS idx_automation_runs_day ON automation_runs(scope,day,started_at);
CREATE INDEX IF NOT EXISTS idx_automation_items_day ON automation_work_items(scope,day,kind);
INSERT OR IGNORE INTO automation_control(scope,state,epoch,version,last_write_id,updated_at)
 VALUES('preview-mock','stopped',0,0,'initial',0);
