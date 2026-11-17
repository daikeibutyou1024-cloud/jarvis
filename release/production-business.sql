-- PRODUCTION ONLY, pending explicit owner approval. New tables only.

-- Source: 0004_generation_metadata.sql
-- Additive metadata only. Existing business_jobs schema and status CHECK remain.
-- The authenticated API also initializes this table lazily for existing installs.
CREATE TABLE business_job_generations (
  job_id TEXT PRIMARY KEY,
  generation_json TEXT NOT NULL
);

-- Source: 0005_stability.sql
-- Additive only. Existing business_jobs / paid_content_drafts / Google tables are unchanged.
-- Runtime also creates these isolated tables on authenticated access.
CREATE TABLE document_revisions (
 project_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 write_id TEXT NOT NULL UNIQUE,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,revision)
);
CREATE TABLE ai_operations (
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
CREATE INDEX idx_ai_operations_month ON ai_operations(month);

-- Source: 0006_editorial_reviews.sql
-- Additive, optional manual migration. Runtime creates the same isolated table.
-- Existing document revisions, paid drafts, business jobs and Google tables are unchanged.
CREATE TABLE editorial_reviews (
 project_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 digest TEXT NOT NULL,
 checks_json TEXT NOT NULL,
 reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,revision)
);

-- Source: 0008_business_records.sql
-- Additive only. Existing drafts, reports, jobs and legacy browser data are unchanged.
CREATE TABLE business_records (id TEXT PRIMARY KEY, version INTEGER NOT NULL, kind TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX idx_business_records_kind_project ON business_records(kind,project_id);
CREATE TABLE business_record_history (record_id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY(record_id,version));
CREATE TABLE business_imports (id TEXT PRIMARY KEY, result_json TEXT NOT NULL, recorded_at INTEGER NOT NULL);
CREATE TABLE business_write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));

-- Source: 0009_ai_reconciliations.sql
-- Additive audit only. Existing usage and historical reconciliation data stay intact.
CREATE TABLE ai_reconciliations (operation_id TEXT PRIMARY KEY, prior_state TEXT NOT NULL, prior_charged_micro INTEGER NOT NULL, prior_usage_json TEXT, charged_micro INTEGER NOT NULL, note TEXT NOT NULL, recorded_at INTEGER NOT NULL, valid INTEGER NOT NULL CHECK(valid=1));

CREATE TABLE paid_content_drafts (id TEXT PRIMARY KEY, topic TEXT NOT NULL, output TEXT NOT NULL, generation_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
