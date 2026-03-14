-- Migration 025: Ensure auth config singleton row exists
--
-- Some environments created the auth.configs table without inserting its
-- default singleton row. Backfill that row so admin settings remain editable.

INSERT INTO auth.configs (
  require_email_verification,
  password_min_length,
  require_number,
  require_lowercase,
  require_uppercase,
  require_special_char,
  verify_email_method,
  reset_password_method,
  sign_in_redirect_to,
  redirect_url_whitelist
)
SELECT
  false,
  6,
  false,
  false,
  false,
  false,
  'code',
  'code',
  null,
  ARRAY[]::TEXT[]
WHERE NOT EXISTS (
  SELECT 1
  FROM auth.configs
);
