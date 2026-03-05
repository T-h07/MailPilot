CREATE TABLE IF NOT EXISTS drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  to_text TEXT NOT NULL DEFAULT '',
  cc_text TEXT NOT NULL DEFAULT '',
  bcc_text TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_text TEXT NOT NULL DEFAULT '',
  body_html TEXT NULL,
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_drafts_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT chk_drafts_status
    CHECK (status = 'DRAFT')
);

CREATE INDEX IF NOT EXISTS idx_drafts_account_updated
  ON drafts(account_id, updated_at DESC);
