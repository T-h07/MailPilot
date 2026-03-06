ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS seen_in_app boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seen_in_app_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_messages_seen_in_app
  ON messages (seen_in_app);
