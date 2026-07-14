-- Migration 060: Add per-user AI usage tracking and quota enforcement
-- Supports: usage logging, per-user quotas, rate limiting, and admin reports.

-- Ensure the ai schema exists (it was created earlier but emptied in 043).
CREATE SCHEMA IF NOT EXISTS ai;

-- ============================================================================
-- ai.usage_log — one row per AI gateway request
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai.usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  user_role TEXT NOT NULL DEFAULT 'authenticated',
  model TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  prompt_tokens INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  total_tokens INT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 8) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient per-user and time-range queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created
  ON ai.usage_log (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created
  ON ai.usage_log (created_at DESC);

-- ============================================================================
-- ai.quota_configs — per-user or global default quota configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai.quota_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL user_id means this is the global default config.
  -- NULLS NOT DISTINCT ensures only one NULL row can exist (Postgres 15+).
  user_id TEXT UNIQUE NULLS NOT DISTINCT,
  max_requests_per_day INT,
  max_tokens_per_day INT,
  max_tokens_per_month INT,
  max_spend_usd_per_month NUMERIC(10, 2),
  allowed_models TEXT[],
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to auto-update updated_at
CREATE TRIGGER update_ai_quota_configs_updated_at
  BEFORE UPDATE ON ai.quota_configs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Insert global default row (no limits by default — admins opt in)
INSERT INTO ai.quota_configs (user_id, is_enabled)
VALUES (NULL, true)
ON CONFLICT DO NOTHING;
