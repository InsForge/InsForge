-- Add configurable token expiries for email verification and password reset.
-- Codes are stored in minutes; links are stored in hours to match the
-- existing semantics in AuthOTPService and the admin dashboard copy.

ALTER TABLE auth.config
ADD COLUMN IF NOT EXISTS verify_email_code_expiry_minutes INTEGER DEFAULT 15 NOT NULL,
ADD COLUMN IF NOT EXISTS verify_email_link_expiry_hours INTEGER DEFAULT 24 NOT NULL,
ADD COLUMN IF NOT EXISTS reset_password_code_expiry_minutes INTEGER DEFAULT 10 NOT NULL,
ADD COLUMN IF NOT EXISTS reset_password_link_expiry_hours INTEGER DEFAULT 1 NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_config_verify_email_code_expiry_minutes_check'
      AND conrelid = 'auth.config'::regclass
  ) THEN
    ALTER TABLE auth.config
    ADD CONSTRAINT auth_config_verify_email_code_expiry_minutes_check
    CHECK (verify_email_code_expiry_minutes BETWEEN 1 AND 10080);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_config_verify_email_link_expiry_hours_check'
      AND conrelid = 'auth.config'::regclass
  ) THEN
    ALTER TABLE auth.config
    ADD CONSTRAINT auth_config_verify_email_link_expiry_hours_check
    CHECK (verify_email_link_expiry_hours BETWEEN 1 AND 168);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_config_reset_password_code_expiry_minutes_check'
      AND conrelid = 'auth.config'::regclass
  ) THEN
    ALTER TABLE auth.config
    ADD CONSTRAINT auth_config_reset_password_code_expiry_minutes_check
    CHECK (reset_password_code_expiry_minutes BETWEEN 1 AND 10080);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'auth_config_reset_password_link_expiry_hours_check'
      AND conrelid = 'auth.config'::regclass
  ) THEN
    ALTER TABLE auth.config
    ADD CONSTRAINT auth_config_reset_password_link_expiry_hours_check
    CHECK (reset_password_link_expiry_hours BETWEEN 1 AND 168);
  END IF;
END $$;
