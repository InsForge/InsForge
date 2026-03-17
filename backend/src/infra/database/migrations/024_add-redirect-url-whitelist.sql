-- Migration 024: Add redirect_url_whitelist to auth.configs
--
-- Adds a text array column to store the admin-managed list of allowed redirect
-- URLs for auth flows (OAuth, email verification, password reset).
-- An empty array (the default) preserves the current permissive behaviour.

ALTER TABLE auth.configs
  ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] NOT NULL DEFAULT '{}';
