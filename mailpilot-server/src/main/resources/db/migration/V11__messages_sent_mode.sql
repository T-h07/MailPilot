ALTER TABLE messages
ADD COLUMN IF NOT EXISTS is_sent BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_messages_is_sent_received
  ON messages(is_sent, received_at DESC);
