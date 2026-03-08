ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS is_inline BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS part_id TEXT NULL;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS content_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_attachments_message_part_id
  ON attachments (message_id, part_id);
