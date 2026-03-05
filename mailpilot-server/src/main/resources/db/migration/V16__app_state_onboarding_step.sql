ALTER TABLE app_state
  ADD COLUMN IF NOT EXISTS onboarding_step INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS onboarding_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE app_state
SET onboarding_step =
  CASE
    WHEN onboarding_complete THEN 4
    ELSE GREATEST(1, onboarding_step)
  END,
  onboarding_updated_at = now()
WHERE id = 1;
