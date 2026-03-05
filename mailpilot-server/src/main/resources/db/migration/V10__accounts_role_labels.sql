ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'SECONDARY';

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS custom_label TEXT NULL;

ALTER TABLE accounts
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE accounts
SET role = 'SECONDARY'
WHERE role IS NULL OR role NOT IN ('PRIMARY', 'SECONDARY', 'CUSTOM');

UPDATE accounts
SET custom_label = NULL
WHERE role <> 'CUSTOM';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_accounts_role'
  ) THEN
    ALTER TABLE accounts
    ADD CONSTRAINT chk_accounts_role
    CHECK (role IN ('PRIMARY', 'SECONDARY', 'CUSTOM'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_single_primary
  ON accounts (role)
  WHERE role = 'PRIMARY';
