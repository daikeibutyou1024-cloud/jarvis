-- PREVIEW ONLY. Prepared, NOT applied. Never run the full historical migrations folder.
-- Verify exact DB ID, current free-plan usage and preserve existing table hashes first.
CREATE TABLE autonomous_projects (
 owner_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL, source_key TEXT NOT NULL, last_write TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,project_id), UNIQUE(owner_id,source_key), CHECK(revision>=0)
);
CREATE TABLE autonomous_jobs (
 owner_id TEXT NOT NULL, job_id TEXT NOT NULL, data_json TEXT NOT NULL DEFAULT '{}',
 lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0, fence INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL, PRIMARY KEY(owner_id,job_id)
);
CREATE TABLE autonomous_sources (
 owner_id TEXT NOT NULL, project_id TEXT NOT NULL, source_json TEXT NOT NULL, content_hash TEXT NOT NULL,
 PRIMARY KEY(owner_id,project_id), FOREIGN KEY(owner_id,project_id) REFERENCES autonomous_projects(owner_id,project_id)
);
CREATE TABLE autonomous_documents (
 owner_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, pack_json TEXT NOT NULL,
 content_hash TEXT NOT NULL, mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,project_id,revision), UNIQUE(owner_id,mutation_id),
 FOREIGN KEY(owner_id,project_id) REFERENCES autonomous_projects(owner_id,project_id)
);
CREATE TABLE autonomous_reviews (
 owner_id TEXT NOT NULL, project_id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL,
 instruction TEXT NOT NULL, content_hash TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,project_id,revision),
 FOREIGN KEY(owner_id,project_id,revision) REFERENCES autonomous_documents(owner_id,project_id,revision)
);
CREATE TABLE autonomous_reports (
 owner_id TEXT NOT NULL, report_day TEXT NOT NULL, report_json TEXT NOT NULL DEFAULT '{}',
 request_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,report_day)
);
CREATE INDEX idx_autonomous_projects_updated ON autonomous_projects(owner_id,updated_at);
CREATE INDEX idx_autonomous_jobs_updated ON autonomous_jobs(owner_id,updated_at);
CREATE INDEX idx_autonomous_reviews_time ON autonomous_reviews(owner_id,created_at);
CREATE INDEX idx_autonomous_reports_day ON autonomous_reports(owner_id,report_day);
-- Reserved marker prevents this code from using an uninitialized/wrong binding.
INSERT INTO autonomous_reports(owner_id,report_day,report_json,updated_at)
VALUES('__binding__','jarvis-preview','{"databaseId":"5ec09d38-2ed8-4c7a-ba67-bfd9c2ed32d0","schema":1}','2026-11-17T00:00:00Z');
-- Publications/budget tables are intentionally not created: those integrations remain disconnected.
