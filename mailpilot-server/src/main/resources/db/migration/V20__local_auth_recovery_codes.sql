CREATE TABLE IF NOT EXISTS local_auth_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NULL,
  request_ip TEXT NULL,
  context TEXT NOT NULL DEFAULT 'LOCAL_APP_PASSWORD',
  status TEXT NOT NULL DEFAULT 'ACTIVE'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_local_auth_recovery_status'
  ) THEN
    ALTER TABLE local_auth_recovery_codes
    ADD CONSTRAINT chk_local_auth_recovery_status
    CHECK (status IN ('ACTIVE', 'EXPIRED', 'CONSUMED', 'CANCELLED'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_local_auth_recovery_codes_email_status
  ON local_auth_recovery_codes(target_email, status);

CREATE INDEX IF NOT EXISTS idx_local_auth_recovery_codes_expires
  ON local_auth_recovery_codes(expires_at);
