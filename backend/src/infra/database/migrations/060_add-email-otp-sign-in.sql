-- Migration 060: Add email OTP sign-in support.
--
-- Numeric OTP attempts must be persisted with the challenge so brute-force
-- protection survives process restarts. The request-otp template is used by
-- custom SMTP; managed cloud email already provides the same template type.

ALTER TABLE auth.email_otps
  ADD COLUMN IF NOT EXISTS attempts_count INTEGER NOT NULL DEFAULT 0;

-- Numeric codes (bcrypt) and hash-link tokens (SHA-256) share auth.email_otps
-- under the same (email, purpose) key. Persisting the delivery type lets the
-- numeric-code verify path filter to NUMERIC_CODE rows only, so a wrong 6-digit
-- guess can never consume a live link token for the same (email, purpose).
ALTER TABLE auth.email_otps
  ADD COLUMN IF NOT EXISTS otp_type TEXT NOT NULL DEFAULT 'NUMERIC_CODE';

-- Backfill existing rows: bcrypt hashes begin with '$2'; SHA-256 hex tokens do not.
UPDATE auth.email_otps
  SET otp_type = 'HASH_TOKEN'
  WHERE otp_hash NOT LIKE '$2%';

-- OTP sign-in looks up users case-insensitively (auth.users.email may be stored
-- mixed-case for OAuth accounts), so serve the WHERE lower(email) = $1 FOR UPDATE
-- lookup with a matching functional index instead of a sequential scan.
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON auth.users (lower(email));

INSERT INTO email.templates (template_type, subject, body_html)
VALUES (
  'request-otp',
  '{{ token }} is your verification code',
  '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:-apple-system,BlinkMacSystemFont,''Segoe UI'',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;color:#1a1a1a;"><div style="text-align:center;padding:32px;background:#f9fafb;border-radius:12px;border:1px solid #e5e7eb;"><h2 style="margin:0 0 8px;font-size:20px;font-weight:600;">Your sign-in code</h2><p style="margin:0 0 24px;color:#6b7280;font-size:14px;">Enter this code to sign in to your account</p><div style="background:#ffffff;border:2px solid #e5e7eb;border-radius:8px;padding:16px 32px;display:inline-block;margin-bottom:24px;"><span style="font-size:32px;font-weight:700;letter-spacing:8px;color:#111827;">{{ token }}</span></div><p style="margin:0;color:#9ca3af;font-size:12px;">This code expires in 5 minutes</p></div></body></html>'
)
ON CONFLICT (template_type) DO NOTHING;
