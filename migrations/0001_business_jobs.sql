-- Apply manually to the existing Cloudflare D1 database JARVIS_DB after reviewing.
-- Isolated business tables; does not alter Google Calendar tables.
CREATE TABLE IF NOT EXISTS business_jobs (
 id TEXT PRIMARY KEY,
 job_type TEXT NOT NULL,
 topic TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','running','draft','failed')),
 output TEXT,
 error TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_business_jobs_created ON business_jobs(created_at DESC);
