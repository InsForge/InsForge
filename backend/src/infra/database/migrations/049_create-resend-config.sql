-- Migration: Create Resend email provider configuration table
-- Supports Resend as a first-class email provider alternative to SMTP and InsForge cloud

CREATE SCHEMA IF NOT EXISTS email;

CREATE TABLE IF NOT EXISTS email.resend_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  api_key_encrypted TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT resend_config_enabled_requires_values CHECK (
    NOT enabled OR (
      api_key_encrypted <> '' AND
      sender_email <> '' AND
      sender_name <> ''
    )
  )
);

-- Singleton constraint: only one row allowed
CREATE UNIQUE INDEX IF NOT EXISTS email_resend_config_singleton_idx ON email.resend_config ((1));

-- Insert default row (disabled)
INSERT INTO email.resend_config (enabled)
VALUES (FALSE)
ON CONFLICT DO NOTHING;
