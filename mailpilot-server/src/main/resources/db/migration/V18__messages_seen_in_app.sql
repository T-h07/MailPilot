ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS seen_in_app BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seen_in_app_at TIMESTAMPTZ NULL;

UPDATE messages
SET seen_in_app = true,
    seen_in_app_at = COALESCE(seen_in_app_at, now())
WHERE seen_in_app = false;

CREATE INDEX IF NOT EXISTS idx_messages_seen_in_app
  ON messages(seen_in_app);
