-- Additive, optional manual migration. Runtime creates the same isolated table.
-- Existing document revisions, paid drafts, business jobs and Google tables are unchanged.
CREATE TABLE IF NOT EXISTS editorial_reviews (
 project_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 digest TEXT NOT NULL,
 checks_json TEXT NOT NULL,
 reviewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(project_id,revision)
);
