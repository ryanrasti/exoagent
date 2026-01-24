-- Migration number: 0003 	 2026-01-24T00:00:00.000Z
-- Chat threads table - stores conversation history per session

CREATE TABLE IF NOT EXISTS chat_threads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('exoagent', 'raw_sql')),
  history TEXT NOT NULL DEFAULT '[]',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE UNIQUE INDEX idx_chat_threads_session_type ON chat_threads(session_id, type);
CREATE INDEX idx_chat_threads_updated_at ON chat_threads(updated_at);
