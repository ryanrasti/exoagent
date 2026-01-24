-- Migration number: 0001 	 2026-01-23T22:00:00.000Z
-- Sessions database - separate from bounty database

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  turnstile_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_turnstile_id ON sessions(turnstile_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);

