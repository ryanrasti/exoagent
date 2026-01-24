-- Migration number: 0002 	 2026-01-23T23:00:00.000Z
-- Add unique constraint on turnstile_id to prevent token reuse
-- Add ip_hash column for abuse detection

DROP INDEX IF EXISTS idx_sessions_turnstile_id;
CREATE UNIQUE INDEX idx_sessions_turnstile_id ON sessions(turnstile_id);

ALTER TABLE sessions ADD COLUMN ip_hash TEXT;
CREATE INDEX idx_sessions_ip_hash ON sessions(ip_hash);
