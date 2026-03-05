ALTER TABLE views
ADD COLUMN IF NOT EXISTS unread_only BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_view_rules_view
  ON view_rules(view_id);

CREATE INDEX IF NOT EXISTS idx_view_accounts_view
  ON view_accounts(view_id);
