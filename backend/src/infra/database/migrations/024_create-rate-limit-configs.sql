-- Migration: 024 - Add persisted auth rate-limit configuration
--
-- Stores auth-sensitive rate-limit controls as a singleton row so admins can
-- tune behavior from the dashboard without code changes.

CREATE TABLE IF NOT EXISTS auth.rate_limit_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  send_email_otp_max_requests INTEGER NOT NULL DEFAULT 5 CHECK (send_email_otp_max_requests >= 1 AND send_email_otp_max_requests <= 100),
  send_email_otp_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (send_email_otp_window_minutes >= 1 AND send_email_otp_window_minutes <= 1440),
  verify_otp_max_attempts INTEGER NOT NULL DEFAULT 10 CHECK (verify_otp_max_attempts >= 1 AND verify_otp_max_attempts <= 100),
  verify_otp_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (verify_otp_window_minutes >= 1 AND verify_otp_window_minutes <= 1440),
  email_cooldown_seconds INTEGER NOT NULL DEFAULT 60 CHECK (email_cooldown_seconds >= 5 AND email_cooldown_seconds <= 3600),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce singleton-row model.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rate_limit_configs_singleton ON auth.rate_limit_configs ((1));

-- Keep updated_at in sync.
DROP TRIGGER IF EXISTS update_rate_limit_configs_updated_at ON auth.rate_limit_configs;
CREATE TRIGGER update_rate_limit_configs_updated_at
BEFORE UPDATE ON auth.rate_limit_configs
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Seed defaults once.
INSERT INTO auth.rate_limit_configs DEFAULT VALUES
ON CONFLICT DO NOTHING;
