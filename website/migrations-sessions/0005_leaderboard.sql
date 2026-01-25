-- Migration number: 0005 	 2026-01-24T00:00:00.000Z
-- Add leaderboard columns - claimed_at/claimed_by for voluntary leaderboard entry

ALTER TABLE chat_threads ADD COLUMN claimed_at DATETIME;
ALTER TABLE chat_threads ADD COLUMN claimed_by TEXT;
