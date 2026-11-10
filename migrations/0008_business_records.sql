-- Additive only. Existing drafts, reports, jobs and legacy browser data are unchanged.
CREATE TABLE IF NOT EXISTS business_records (id TEXT PRIMARY KEY, version INTEGER NOT NULL, kind TEXT NOT NULL, project_id TEXT NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_business_records_kind_project ON business_records(kind,project_id);
CREATE TABLE IF NOT EXISTS business_record_history (record_id TEXT NOT NULL, version INTEGER NOT NULL, payload_json TEXT NOT NULL, state TEXT NOT NULL, recorded_at INTEGER NOT NULL, PRIMARY KEY(record_id,version));
CREATE TABLE IF NOT EXISTS business_imports (id TEXT PRIMARY KEY, result_json TEXT NOT NULL, recorded_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS business_write_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
