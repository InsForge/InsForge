-- Add a project-level "disable new user signups" toggle to auth.config.
-- When enabled, public registration (email + OAuth first-time signup) is rejected,
-- but project_admin-authenticated user creation continues to work.
ALTER TABLE auth.config
ADD COLUMN IF NOT EXISTS disable_signup BOOLEAN DEFAULT FALSE NOT NULL;
