-- Migration: 015 - Add verification and reset code columns to _accounts table
-- Adds email verification, password reset, and OTP code columns

-- Add new columns for verification codes
ALTER TABLE _accounts
ADD COLUMN verify_email_code VARCHAR(8) UNIQUE,
ADD COLUMN reset_password_code VARCHAR(8) UNIQUE,
ADD COLUMN otp_code VARCHAR(8) UNIQUE,
ADD COLUMN verify_email_code_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN reset_password_code_expires_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN otp_code_expires_at TIMESTAMP WITH TIME ZONE;

-- Add check constraints to ensure code length is between 4-8 characters
ALTER TABLE _accounts
ADD CONSTRAINT verify_email_code_length CHECK (
  verify_email_code IS NULL OR
  (LENGTH(verify_email_code) >= 4 AND LENGTH(verify_email_code) <= 8)
);

ALTER TABLE _accounts
ADD CONSTRAINT reset_password_code_length CHECK (
  reset_password_code IS NULL OR
  (LENGTH(reset_password_code) >= 4 AND LENGTH(reset_password_code) <= 8)
);

ALTER TABLE _accounts
ADD CONSTRAINT otp_code_length CHECK (
  otp_code IS NULL OR
  (LENGTH(otp_code) >= 4 AND LENGTH(otp_code) <= 8)
);

-- Create indexes for faster lookups on these codes
CREATE INDEX IF NOT EXISTS idx_accounts_verify_email_code ON _accounts(verify_email_code) WHERE verify_email_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_reset_password_code ON _accounts(reset_password_code) WHERE reset_password_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_accounts_otp_code ON _accounts(otp_code) WHERE otp_code IS NOT NULL;

-- Rollback: Remove verification and reset code columns from _accounts table
ALTER TABLE _accounts
DROP COLUMN IF EXISTS verify_email_code,
DROP COLUMN IF EXISTS reset_password_code,
DROP COLUMN IF EXISTS otp_code,
DROP COLUMN IF EXISTS verify_email_code_expires_at,
DROP COLUMN IF EXISTS reset_password_code_expires_at,
DROP COLUMN IF EXISTS otp_code_expires_at;

-- Rollback: Remove check constraints from _accounts table
ALTER TABLE _accounts
DROP CONSTRAINT IF EXISTS verify_email_code_length,
DROP CONSTRAINT IF EXISTS reset_password_code_length,
DROP CONSTRAINT IF EXISTS otp_code_length;

-- Rollback: Drop indexes for verification codes
DROP INDEX IF EXISTS idx_accounts_verify_email_code;
DROP INDEX IF EXISTS idx_accounts_reset_password_code;
DROP INDEX IF EXISTS idx_accounts_otp_code;
