-- Migration: 024 - Add redirect URL whitelist to auth configs
-- This migration adds a redirect_url_whitelist column to the _auth_configs table
-- to store an array of allowed redirect URLs for enhanced security

-- Add redirect_url_whitelist column to _auth_configs table
ALTER TABLE _auth_configs
  ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] DEFAULT '{}' NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN _auth_configs.redirect_url_whitelist IS 'Array of allowed redirect URLs for auth flows. Empty array allows all URLs for development convenience.';