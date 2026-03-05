ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS gmail_label_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS is_inbox BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_draft BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gmail_internal_date_ms BIGINT NULL;

ALTER TABLE messages
  ALTER COLUMN is_sent SET DEFAULT false;

UPDATE messages
SET
  is_inbox = CASE WHEN is_sent THEN false ELSE true END,
  is_draft = false
WHERE gmail_label_ids = '{}'::text[];

UPDATE messages
SET gmail_internal_date_ms = (EXTRACT(EPOCH FROM received_at) * 1000)::BIGINT
WHERE gmail_internal_date_ms IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_is_inbox
  ON messages(is_inbox);

CREATE INDEX IF NOT EXISTS idx_messages_is_sent
  ON messages(is_sent);

CREATE INDEX IF NOT EXISTS idx_messages_is_draft
  ON messages(is_draft);

CREATE INDEX IF NOT EXISTS idx_messages_received_at
  ON messages(received_at DESC);
