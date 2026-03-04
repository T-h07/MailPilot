ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS gmail_history_id TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_provider_status
  ON accounts(provider, status);

CREATE INDEX IF NOT EXISTS idx_attachments_message_provider_attachment
  ON attachments(message_id, provider_attachment_id);

CREATE INDEX IF NOT EXISTS idx_attachments_message_filename_size
  ON attachments(message_id, filename, size_bytes);
