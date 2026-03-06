UPDATE app_state
SET onboarding_step = 6,
    onboarding_updated_at = now(),
    updated_at = now()
WHERE onboarding_complete = true
  AND onboarding_step < 6;
