-- Migration 024: Replace sign_in_redirect_to with redirect_url_whitelist
--
-- Adds a text array column to store the admin-managed list of allowed redirect
-- URLs for auth flows (OAuth, email verification, password reset).
-- Migrates any existing sign_in_redirect_to value as the first whitelist entry,
-- then drops the old column.

ALTER TABLE auth.configs
  ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] NOT NULL DEFAULT '{}';

-- Migrate existing sign_in_redirect_to value into the new whitelist
UPDATE auth.configs
  SET redirect_url_whitelist = ARRAY[sign_in_redirect_to]
  WHERE sign_in_redirect_to IS NOT NULL AND sign_in_redirect_to != '';

-- Drop the old column now that data is migrated
ALTER TABLE auth.configs
  DROP COLUMN IF EXISTS sign_in_redirect_to;
