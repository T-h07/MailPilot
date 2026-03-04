CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  email TEXT NOT NULL,
  display_name TEXT NULL,
  status TEXT NOT NULL DEFAULT 'CONNECTED',
  token_encrypted TEXT NULL,
  refresh_token_encrypted TEXT NULL,
  last_sync_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_accounts_provider_email UNIQUE (provider, email)
);

CREATE TABLE IF NOT EXISTS threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  provider_thread_id TEXT NOT NULL,
  subject TEXT NULL,
  last_message_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_threads_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT uq_threads_account_provider_thread UNIQUE (account_id, provider_thread_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  thread_id UUID NULL,
  provider_message_id TEXT NOT NULL,
  message_rfc822_id TEXT NULL,
  sender_name TEXT NULL,
  sender_email TEXT NOT NULL,
  sender_domain TEXT NOT NULL,
  subject TEXT NULL,
  snippet TEXT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  has_attachments BOOLEAN NOT NULL DEFAULT false,
  body_cache TEXT NULL,
  body_cache_mime TEXT NULL,
  body_cached_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_messages_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_messages_thread
    FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE SET NULL,
  CONSTRAINT uq_messages_account_provider_message UNIQUE (account_id, provider_message_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL,
  provider_attachment_id TEXT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_attachments_message
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  priority INT NOT NULL DEFAULT 3,
  sort_order INT NOT NULL DEFAULT 0,
  icon TEXT NULL,
  accounts_scope TEXT NOT NULL DEFAULT 'ALL',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_views_name UNIQUE (name),
  CONSTRAINT chk_views_priority_range CHECK (priority BETWEEN 1 AND 5),
  CONSTRAINT chk_views_accounts_scope CHECK (accounts_scope IN ('ALL', 'SELECTED'))
);

CREATE TABLE IF NOT EXISTS view_accounts (
  view_id UUID NOT NULL,
  account_id UUID NOT NULL,
  PRIMARY KEY (view_id, account_id),
  CONSTRAINT fk_view_accounts_view
    FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE,
  CONSTRAINT fk_view_accounts_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS view_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  view_id UUID NOT NULL,
  rule_type TEXT NOT NULL,
  rule_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_view_rules_view
    FOREIGN KEY (view_id) REFERENCES views(id) ON DELETE CASCADE,
  CONSTRAINT uq_view_rules_unique_rule UNIQUE (view_id, rule_type, rule_value),
  CONSTRAINT chk_view_rules_type CHECK (rule_type IN ('DOMAIN', 'SENDER_EMAIL', 'KEYWORD'))
);

CREATE TABLE IF NOT EXISTS sender_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_type TEXT NOT NULL,
  match_value TEXT NOT NULL,
  label TEXT NOT NULL,
  accent TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_sender_rules_match UNIQUE (match_type, match_value),
  CONSTRAINT chk_sender_rules_match_type CHECK (match_type IN ('EMAIL', 'DOMAIN'))
);

CREATE TABLE IF NOT EXISTS followups (
  message_id UUID PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'OPEN',
  needs_reply BOOLEAN NOT NULL DEFAULT false,
  due_at TIMESTAMPTZ NULL,
  snoozed_until TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_followups_message
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT chk_followups_status CHECK (status IN ('OPEN', 'DONE'))
);

CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_tags_name UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS message_tags (
  message_id UUID NOT NULL,
  tag_id UUID NOT NULL,
  PRIMARY KEY (message_id, tag_id),
  CONSTRAINT fk_message_tags_message
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_tags_tag
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_received_at
  ON messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_account_received
  ON messages(account_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read_received
  ON messages(is_read, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_sender_domain
  ON messages(sender_domain);
CREATE INDEX IF NOT EXISTS idx_messages_sender_email
  ON messages(sender_email);

CREATE INDEX IF NOT EXISTS idx_followups_status
  ON followups(status);
CREATE INDEX IF NOT EXISTS idx_followups_needs_reply
  ON followups(needs_reply) WHERE needs_reply = true;
CREATE INDEX IF NOT EXISTS idx_followups_due_at
  ON followups(due_at);
CREATE INDEX IF NOT EXISTS idx_followups_snoozed_until
  ON followups(snoozed_until);

CREATE INDEX IF NOT EXISTS idx_threads_account_last_message
  ON threads(account_id, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_sender_rules_email
  ON sender_rules(match_type, match_value);

CREATE INDEX IF NOT EXISTS idx_views_sort_order
  ON views(sort_order);
