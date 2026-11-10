-- Additive metadata only. Existing business_jobs schema and status CHECK remain.
-- The authenticated API also initializes this table lazily for existing installs.
CREATE TABLE IF NOT EXISTS business_job_generations (
  job_id TEXT PRIMARY KEY,
  generation_json TEXT NOT NULL
);
