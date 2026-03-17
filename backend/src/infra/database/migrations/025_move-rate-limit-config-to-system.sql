-- Migration: 025 - Move and extend persisted rate-limit configuration into system schema
--
-- Introduces phase-2 global API limiter settings and stores all rate-limit
-- controls in system.rate_limit_configs as a singleton row.

CREATE TABLE IF NOT EXISTS system.rate_limit_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  api_global_max_requests INTEGER NOT NULL DEFAULT 3000 CHECK (api_global_max_requests >= 100 AND api_global_max_requests <= 100000),
  api_global_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (api_global_window_minutes >= 1 AND api_global_window_minutes <= 1440),
  send_email_otp_max_requests INTEGER NOT NULL DEFAULT 5 CHECK (send_email_otp_max_requests >= 1 AND send_email_otp_max_requests <= 100),
  send_email_otp_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (send_email_otp_window_minutes >= 1 AND send_email_otp_window_minutes <= 1440),
  verify_otp_max_attempts INTEGER NOT NULL DEFAULT 10 CHECK (verify_otp_max_attempts >= 1 AND verify_otp_max_attempts <= 100),
  verify_otp_window_minutes INTEGER NOT NULL DEFAULT 15 CHECK (verify_otp_window_minutes >= 1 AND verify_otp_window_minutes <= 1440),
  email_cooldown_seconds INTEGER NOT NULL DEFAULT 60 CHECK (email_cooldown_seconds >= 5 AND email_cooldown_seconds <= 3600),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enforce singleton-row model.
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_rate_limit_configs_singleton ON system.rate_limit_configs ((1));

-- Keep updated_at in sync.
DROP TRIGGER IF EXISTS update_system_rate_limit_configs_updated_at ON system.rate_limit_configs;
CREATE TRIGGER update_system_rate_limit_configs_updated_at
BEFORE UPDATE ON system.rate_limit_configs
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Migrate existing auth schema values if present.
INSERT INTO system.rate_limit_configs (
  api_global_max_requests,
  api_global_window_minutes,
  send_email_otp_max_requests,
  send_email_otp_window_minutes,
  verify_otp_max_attempts,
  verify_otp_window_minutes,
  email_cooldown_seconds
)
SELECT
  3000,
  15,
  send_email_otp_max_requests,
  send_email_otp_window_minutes,
  verify_otp_max_attempts,
  verify_otp_window_minutes,
  email_cooldown_seconds
FROM auth.rate_limit_configs
LIMIT 1
ON CONFLICT DO NOTHING;

-- Seed defaults once if still missing.
INSERT INTO system.rate_limit_configs DEFAULT VALUES
ON CONFLICT DO NOTHING;
