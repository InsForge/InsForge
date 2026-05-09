-- Migration 042: Add configurable token expiry to auth config
--
-- Adds per-purpose, per-type expiry settings so projects can tune OTP/link
-- lifetimes independently for email verification vs password reset.
--
-- All values stored in minutes for consistency (1 min – 7 days range).
-- Defaults align with OWASP/NIST guidance:
--   verify_email_code: 15 min (unchanged)
--   verify_email_link: 1440 min / 24h (unchanged)
--   reset_password_code: 10 min (tightened from 15)
--   reset_password_link: 60 min / 1h (tightened from 24h)

ALTER TABLE auth.config
  ADD COLUMN IF NOT EXISTS verify_email_code_expiry_minutes INTEGER DEFAULT 15 NOT NULL
    CHECK (verify_email_code_expiry_minutes >= 1 AND verify_email_code_expiry_minutes <= 10080),
  ADD COLUMN IF NOT EXISTS verify_email_link_expiry_minutes INTEGER DEFAULT 1440 NOT NULL
    CHECK (verify_email_link_expiry_minutes >= 1 AND verify_email_link_expiry_minutes <= 10080),
  ADD COLUMN IF NOT EXISTS reset_password_code_expiry_minutes INTEGER DEFAULT 10 NOT NULL
    CHECK (reset_password_code_expiry_minutes >= 1 AND reset_password_code_expiry_minutes <= 10080),
  ADD COLUMN IF NOT EXISTS reset_password_link_expiry_minutes INTEGER DEFAULT 60 NOT NULL
    CHECK (reset_password_link_expiry_minutes >= 1 AND reset_password_link_expiry_minutes <= 10080);
