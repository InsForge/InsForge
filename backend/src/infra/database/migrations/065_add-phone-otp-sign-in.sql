-- Migration 065: Add phone (SMS) OTP sign-in support.
--
-- Phone sign-in mirrors email OTP sign-in (migration 060): the same
-- auth.email_otps machinery stores the challenge keyed on the E.164 phone
-- number, which can never collide with an email identifier. What phone
-- sign-in additionally needs is an identity column pair on auth.users and a
-- place to keep the SMS provider configuration.

-- A user must have at least one identifier, not specifically an email:
-- phone-only accounts created by SMS OTP sign-in have no email address, so
-- the historical NOT NULL on email has to go. Existing rows are unaffected
-- and email sign-up still requires an email at the API layer.
ALTER TABLE auth.users
  ALTER COLUMN email DROP NOT NULL;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS phone_number TEXT,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false;

-- Phone numbers are stored normalized (E.164), so a plain unique index mirrors
-- the email uniqueness guarantee; NULLs (email-only accounts) never conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_number ON auth.users (phone_number);

-- The API guarantees every sign-up carries an identifier; this keeps the
-- invariant where the data lives, so a direct SQL writer or a future migration
-- cannot create an account that no sign-in method can ever reach.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_email_or_phone_present' AND conrelid = 'auth.users'::regclass
  ) THEN
    ALTER TABLE auth.users
      ADD CONSTRAINT users_email_or_phone_present
      CHECK (email IS NOT NULL OR phone_number IS NOT NULL);
  END IF;
END $$;

-- SMS provider configuration, mirroring email.config (migration 029): a
-- singleton row holding the Twilio credentials with the auth token encrypted
-- at rest. `provider` selects the delivery implementation; `console` is a
-- development-only provider the backend refuses to use in production.
CREATE SCHEMA IF NOT EXISTS sms;

-- The OTP message template lives as a column rather than a templates table:
-- SMS has exactly one message type (sign-in code) with a plain-text body, so
-- the email.templates machinery (five template types, subject + HTML) would be
-- empty structure here. `{{ code }}` is substituted at send time, matching the
-- `{{ token }}` placeholder convention of email templates.
CREATE TABLE IF NOT EXISTS sms.config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  provider TEXT NOT NULL DEFAULT 'twilio',
  account_sid TEXT NOT NULL DEFAULT '',
  auth_token_encrypted TEXT NOT NULL DEFAULT '',
  from_number TEXT NOT NULL DEFAULT '',
  messaging_service_sid TEXT NOT NULL DEFAULT '',
  min_interval_seconds INTEGER NOT NULL DEFAULT 60,
  otp_message_template TEXT NOT NULL DEFAULT 'Your verification code is {{ code }}. It expires in 5 minutes.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton constraint: only one row allowed
CREATE UNIQUE INDEX IF NOT EXISTS sms_config_singleton_idx ON sms.config ((1));

-- Insert default row (disabled)
INSERT INTO sms.config (enabled)
VALUES (FALSE)
ON CONFLICT DO NOTHING;

-- Same posture as the email schema (migration 045): project_admin may read,
-- but provider config writes must go through the API so validation and
-- credential encryption are preserved.
GRANT USAGE ON SCHEMA sms TO project_admin;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA sms FROM project_admin;
GRANT SELECT ON ALL TABLES IN SCHEMA sms TO project_admin;

-- The sms schema is InsForge-internal and must never surface through the
-- PostgREST data API. The deny-list lives in the insforge.internal_schemas GUC
-- (postgresql.conf, updated alongside this migration) with a literal fallback
-- inside system.is_exposed_schema (migration 056); redefine the fallback here
-- so deployments without the GUC also hide sms, then resync so the CREATE
-- SCHEMA above (which already fired the exposure event trigger) is corrected
-- within this same migration.
CREATE OR REPLACE FUNCTION system.is_exposed_schema(p_schema text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT
    p_schema IS NOT NULL
    AND p_schema NOT LIKE 'pg\_%'
    AND p_schema <> 'information_schema'
    AND p_schema <> ALL (
      -- Comma-separated GUC; strip any incidental whitespace before splitting.
      string_to_array(
        regexp_replace(
          coalesce(
            nullif(current_setting('insforge.internal_schemas', true), ''),
            'ai,auth,compute,deployments,email,functions,memory,payments,realtime,schedules,sms,storage,system'
          ),
          '\s', '', 'g'
        ),
        ','
      )
    )
    -- Extension-managed schemas are infrastructure, not developer data.
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      JOIN pg_namespace n ON n.oid = d.objid
      WHERE d.classid = 'pg_namespace'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND d.deptype = 'e'
        AND n.nspname = p_schema
    );
$fn$;

SELECT system.sync_postgrest_exposed_schemas();
