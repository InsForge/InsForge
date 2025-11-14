-- Migration 017: Enable email verification by default
--
-- Changes:
-- Update default value for require_email_verification column to TRUE
-- This ensures new projects have email verification enabled by default

-- Update the default value for new rows (affects future inserts only)
ALTER TABLE _auth_configs 
  ALTER COLUMN require_email_verification SET DEFAULT TRUE;

-- Update existing configuration row to enable email verification
-- This will affect the singleton config row if it exists
UPDATE _auth_configs 
SET require_email_verification = TRUE
WHERE require_email_verification = FALSE;

