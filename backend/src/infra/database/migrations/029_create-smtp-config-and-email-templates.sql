-- Migration: Create SMTP configuration and email templates tables
-- These tables support custom SMTP email delivery as an alternative to InsForge cloud

CREATE SCHEMA IF NOT EXISTS email;

-- ============================================================================
-- SMTP Configuration (singleton)
-- ============================================================================

CREATE TABLE IF NOT EXISTS email.config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  host TEXT NOT NULL DEFAULT '',
  port INTEGER NOT NULL DEFAULT 465,
  username TEXT NOT NULL DEFAULT '',
  password_encrypted TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  sender_name TEXT NOT NULL DEFAULT '',
  min_interval_seconds INTEGER NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton constraint: only one row allowed
CREATE UNIQUE INDEX IF NOT EXISTS email_config_singleton_idx ON email.config ((1));

-- Insert default row (disabled)
INSERT INTO email.config (enabled)
VALUES (FALSE)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- Email Templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS email.templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT email_templates_type_unique UNIQUE (template_type)
);

-- Seed default templates
INSERT INTO email.templates (template_type, subject, body_html) VALUES
(
  'email-verification-code',
  'Verify your email',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Verify your email</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to verify your email address</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ token }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 15 minutes</p></div></body></html>'
),
(
  'email-verification-link',
  'Verify your email',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Verify your email</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Click the button below to verify your email address</p><a href="{{ link }}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:500;">Verify Email</a><p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This link expires in 24 hours</p></div></body></html>'
),
(
  'reset-password-code',
  'Reset your password',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Reset your password</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to reset your password</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ token }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 15 minutes</p></div></body></html>'
),
(
  'reset-password-link',
  'Reset your password',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Reset your password</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Click the button below to reset your password</p><a href="{{ link }}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 32px;border-radius:6px;font-size:14px;font-weight:500;">Reset Password</a><p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">This link expires in 24 hours</p></div></body></html>'
)
ON CONFLICT (template_type) DO NOTHING;
