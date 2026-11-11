-- Additive audit only. Existing usage and historical reconciliation data stay intact.
CREATE TABLE IF NOT EXISTS ai_reconciliations (operation_id TEXT PRIMARY KEY, prior_state TEXT NOT NULL, prior_charged_micro INTEGER NOT NULL, prior_usage_json TEXT, charged_micro INTEGER NOT NULL, note TEXT NOT NULL, recorded_at INTEGER NOT NULL, valid INTEGER NOT NULL CHECK(valid=1));
