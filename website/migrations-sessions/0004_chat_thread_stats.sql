-- Migration number: 0004 	 2026-01-24T00:00:00.000Z
-- Add stats columns to chat_threads for efficient aggregation

ALTER TABLE chat_threads ADD COLUMN is_solved BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE chat_threads ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0;
