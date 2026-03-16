-- Migration: 024 - Add redirect URL whitelist to auth configs
-- This migration adds a redirect_url_whitelist column to the auth.configs table
-- to store an array of allowed redirect URLs for enhanced security

-- Add redirect_url_whitelist column to auth.configs table
ALTER TABLE auth.configs
  ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] DEFAULT '{}' NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN auth.configs.redirect_url_whitelist IS 'Array of allowed redirect URLs for auth flows. Empty array allows all URLs for development convenience.';