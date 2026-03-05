CREATE TABLE IF NOT EXISTS oauth_tokens (
  account_id UUID PRIMARY KEY,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT NULL,
  expiry_at TIMESTAMPTZ NULL,
  scope TEXT NULL,
  token_type TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_oauth_tokens_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expiry_at
  ON oauth_tokens(expiry_at);
