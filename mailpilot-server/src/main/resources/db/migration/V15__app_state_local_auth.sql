CREATE TABLE IF NOT EXISTS app_state (
  id INT PRIMARY KEY,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_state (id, onboarding_complete, locked)
VALUES (1, false, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_profile (
  id INT PRIMARY KEY,
  first_name TEXT NULL,
  last_name TEXT NULL,
  field_of_work TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO user_profile (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS local_auth (
  id INT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  algo TEXT NOT NULL DEFAULT 'bcrypt',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
