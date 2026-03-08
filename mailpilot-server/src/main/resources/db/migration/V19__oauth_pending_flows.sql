CREATE TABLE IF NOT EXISTS oauth_pending_flows (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'GMAIL',
  mode TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  context TEXT NULL,
  account_hint TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  message TEXT NULL,
  result_account_id UUID NULL,
  result_email TEXT NULL,
  error TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_pending_flows_expires
  ON oauth_pending_flows(expires_at);
