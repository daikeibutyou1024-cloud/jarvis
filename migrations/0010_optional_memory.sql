-- Optional. Do not apply to Preview/Production without separate approval.
-- JARVIS_MEMORY_ENABLED is disabled by default. This migration never runs automatically.
CREATE TABLE IF NOT EXISTS jarvis_memories(id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL,bytes INTEGER NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,version INTEGER NOT NULL);
