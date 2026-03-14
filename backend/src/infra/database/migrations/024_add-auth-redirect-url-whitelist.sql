-- Migration 024: Add redirect URL whitelist to auth config
--
-- Adds a normalized allowlist for auth redirect targets. When configured,
-- auth flows should only use exact URL matches from this list.

ALTER TABLE auth.configs
  ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] DEFAULT ARRAY[]::TEXT[] NOT NULL;

UPDATE auth.configs
SET redirect_url_whitelist = ARRAY[]::TEXT[]
WHERE redirect_url_whitelist IS NULL;
