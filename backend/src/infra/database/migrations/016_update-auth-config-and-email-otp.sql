-- Migration 016: Update _email_otps and _auth_configs tables
--
-- Changes:
-- 1. _email_otps table:
--    - Remove attempts_count column (brute force protection moved to API rate limiter)
-- 2. _auth_configs table:
--    - Remove verify_email_redirect_to and reset_password_redirect_to columns
--    - Add verify_email_method and reset_password_method columns (code or link)
--    - Add sign_in_redirect_to column

-- Update _email_otps: Remove attempts_count column
ALTER TABLE _email_otps DROP COLUMN IF EXISTS attempts_count;

-- Update _auth_configs: Remove old redirect columns
ALTER TABLE _auth_configs
  DROP COLUMN IF EXISTS verify_email_redirect_to,
  DROP COLUMN IF EXISTS reset_password_redirect_to;

-- Add new columns to _auth_configs
-- Note: DEFAULT 'code' NOT NULL ensures existing rows automatically get 'code' value
ALTER TABLE _auth_configs
  ADD COLUMN IF NOT EXISTS verify_email_method TEXT DEFAULT 'code' NOT NULL CHECK (verify_email_method IN ('code', 'link')),
  ADD COLUMN IF NOT EXISTS reset_password_method TEXT DEFAULT 'code' NOT NULL CHECK (reset_password_method IN ('code', 'link')),
  ADD COLUMN IF NOT EXISTS sign_in_redirect_to TEXT;
