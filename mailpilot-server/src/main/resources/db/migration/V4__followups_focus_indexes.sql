CREATE INDEX IF NOT EXISTS idx_followups_open_needs_reply
  ON followups(needs_reply)
  WHERE status = 'OPEN' AND needs_reply = true;

CREATE INDEX IF NOT EXISTS idx_followups_open_due_at
  ON followups(due_at)
  WHERE status = 'OPEN' AND due_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_followups_open_snoozed_until
  ON followups(snoozed_until)
  WHERE status = 'OPEN' AND snoozed_until IS NOT NULL;
