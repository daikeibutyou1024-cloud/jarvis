-- Additive only. Existing business_jobs / paid_content_drafts / Google tables are unchanged.
-- Runtime also creates these isolated tables on authenticated access.
CREATE TABLE IF NOT EXISTS document_revisions (
 project_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 write_id TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,revision)
);
CREATE TABLE IF NOT EXISTS ai_operations (
 id TEXT PRIMARY KEY,
 purpose TEXT NOT NULL,
 job_id TEXT,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 month TEXT NOT NULL,
 state TEXT NOT NULL,
 reserved_micro INTEGER NOT NULL,
 charged_micro INTEGER NOT NULL,
 input_rate REAL NOT NULL,
 output_rate REAL NOT NULL,
 started_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 finished_at INTEGER,
 usage_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_operations_month ON ai_operations(month);
