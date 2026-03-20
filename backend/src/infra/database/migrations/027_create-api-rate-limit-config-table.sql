-- Migration: 027 - Create API rate limit configuration table
-- This migration creates system.api_rate_limit_config (singleton) to persist
-- editable auth-sensitive API rate-limit settings.

CREATE TABLE IF NOT EXISTS system.api_rate_limit_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  send_email_otp_max_requests INTEGER DEFAULT 5 NOT NULL
    CHECK (send_email_otp_max_requests >= 1 AND send_email_otp_max_requests <= 100),
  send_email_otp_window_minutes INTEGER DEFAULT 15 NOT NULL
    CHECK (send_email_otp_window_minutes >= 1 AND send_email_otp_window_minutes <= 1440),
  verify_otp_max_requests INTEGER DEFAULT 10 NOT NULL
    CHECK (verify_otp_max_requests >= 1 AND verify_otp_max_requests <= 100),
  verify_otp_window_minutes INTEGER DEFAULT 15 NOT NULL
    CHECK (verify_otp_window_minutes >= 1 AND verify_otp_window_minutes <= 1440),
  email_cooldown_seconds INTEGER DEFAULT 60 NOT NULL
    CHECK (email_cooldown_seconds >= 0 AND email_cooldown_seconds <= 3600),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_rate_limit_config_singleton
  ON system.api_rate_limit_config ((1));

DROP TRIGGER IF EXISTS update_api_rate_limit_config_updated_at ON system.api_rate_limit_config;
CREATE TRIGGER update_api_rate_limit_config_updated_at
  BEFORE UPDATE ON system.api_rate_limit_config
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

INSERT INTO system.api_rate_limit_config (
  send_email_otp_max_requests,
  send_email_otp_window_minutes,
  verify_otp_max_requests,
  verify_otp_window_minutes,
  email_cooldown_seconds
)
VALUES (5, 15, 10, 15, 60)
ON CONFLICT DO NOTHING;
