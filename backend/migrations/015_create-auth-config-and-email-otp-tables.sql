-- Migration: 015 - Create email OTP verification table and email auth configs
-- This migration creates:
-- 1. _email_otps: Stores one-time tokens for email verification purposes
--    - Supports both short numeric codes (6 digits) for manual entry
--    - Supports long cryptographic tokens (64 chars) for magic links
--    - Uses dual hashing strategy:
--      * NUMERIC_CODE (6 digits): Bcrypt hash (slow, defense against brute force)
--      * LINK_TOKEN (64 hex chars): SHA-256 hash (fast, enables direct O(1) lookup)
-- 2. _auth_configs: Stores email authentication configuration (single-row table)

-- 1. Create email OTP verification table
CREATE TABLE IF NOT EXISTS _email_otps (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  otp_hash TEXT NOT NULL, -- Hash of OTP: bcrypt for NUMERIC_CODE, SHA-256 for LINK_TOKEN
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts_count INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (email, purpose) -- Only one active token per email/purpose combination
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_email_otps_email_purpose ON _email_otps(email, purpose);
CREATE INDEX IF NOT EXISTS idx_email_otps_expires_at ON _email_otps(expires_at);
CREATE INDEX IF NOT EXISTS idx_email_otps_otp_hash ON _email_otps(otp_hash); -- For direct LINK_TOKEN lookup

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update__email_otps_updated_at ON _email_otps;
CREATE TRIGGER update__email_otps_updated_at
BEFORE UPDATE ON _email_otps
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Create email authentication configuration table (single-row design)
-- This table stores global email authentication settings for the project
CREATE TABLE IF NOT EXISTS _auth_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  require_email_verification BOOLEAN DEFAULT FALSE NOT NULL,
  password_min_length INTEGER DEFAULT 6 NOT NULL CHECK (password_min_length >= 4 AND password_min_length <= 128),
  require_number BOOLEAN DEFAULT FALSE NOT NULL,
  require_lowercase BOOLEAN DEFAULT FALSE NOT NULL,
  require_uppercase BOOLEAN DEFAULT FALSE NOT NULL,
  require_special_char BOOLEAN DEFAULT FALSE NOT NULL,
  verify_email_redirect_to TEXT, -- Custom URL to redirect after successful email verification (defaults to no redirect if NULL)
  reset_password_redirect_to TEXT, -- Custom URL to redirect after successful password reset (defaults to no redirect if NULL)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one row exists (singleton pattern)
-- This constraint prevents multiple configuration rows
CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_configs_singleton ON _auth_configs ((1));

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update__auth_configs_updated_at ON _auth_configs;
CREATE TRIGGER update__auth_configs_updated_at
BEFORE UPDATE ON _auth_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default configuration row if it doesn't exist
INSERT INTO _auth_configs (
  require_email_verification,
  password_min_length,
  require_number,
  require_lowercase,
  require_uppercase,
  require_special_char,
  verify_email_redirect_to,
  reset_password_redirect_to
) VALUES (
  FALSE,  -- require_email_verification
  6,      -- password_min_length
  FALSE,  -- require_number
  FALSE,  -- require_lowercase
  FALSE,  -- require_uppercase
  FALSE,  -- require_special_char
  NULL,   -- verify_email_redirect_to (NULL = no redirect after verification)
  NULL    -- reset_password_redirect_to (NULL = no redirect after reset)
) ON CONFLICT DO NOTHING;
