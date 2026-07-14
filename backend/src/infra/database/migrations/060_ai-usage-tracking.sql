-- Create ai.usage_log table for tracking per-request AI model usage.
-- This enables per-user quota enforcement and admin cost observability.
CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.usage_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  model             TEXT NOT NULL,
  prompt_tokens     INT NOT NULL DEFAULT 0,
  completion_tokens INT NOT NULL DEFAULT 0,
  estimated_cost    NUMERIC(12,8) NOT NULL DEFAULT 0,
  endpoint          TEXT NOT NULL CHECK (endpoint IN ('chat', 'image', 'embedding')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for per-user time-window queries (the hot path for quota checks)
CREATE INDEX IF NOT EXISTS idx_usage_log_user_created
  ON ai.usage_log (user_id, created_at DESC);

-- Index for admin aggregate reports
CREATE INDEX IF NOT EXISTS idx_usage_log_created
  ON ai.usage_log (created_at DESC);

-- Index for model-level aggregation
CREATE INDEX IF NOT EXISTS idx_usage_log_model
  ON ai.usage_log (model);

-- GRANTs for the authenticated role (INSERT is needed by the service layer
-- which runs via withAdminContext; SELECT is for admin report endpoints).
GRANT USAGE ON SCHEMA ai TO authenticated;
GRANT INSERT, SELECT ON ai.usage_log TO authenticated;

-- Enable RLS on usage_log so row-level checks protect user data.
ALTER TABLE ai.usage_log ENABLE ROW LEVEL SECURITY;

-- Users can always see their own usage rows; admins see everything.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ai' AND tablename = 'usage_log' AND policyname = 'users_view_own_usage'
  ) THEN
    CREATE POLICY users_view_own_usage ON ai.usage_log
      FOR SELECT
      USING (auth.jwt() ->> 'sub' = user_id::text);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'ai' AND tablename = 'usage_log' AND policyname = 'authenticated_insert_own_usage'
  ) THEN
    CREATE POLICY authenticated_insert_own_usage ON ai.usage_log
      FOR INSERT
      WITH CHECK (auth.jwt() ->> 'sub' = user_id::text);
  END IF;
END
$$;

-- Create ai.quota_config table.
-- Project-wide default has user_id IS NULL; per-user overrides use user_id.
CREATE TABLE IF NOT EXISTS ai.quota_config (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                    UUID,
  max_requests_per_day       INT,
  max_tokens_per_day         INT,
  max_tokens_per_month       INT,
  monthly_spend_cap_usd      NUMERIC(10,4),
  model_allowlist            TEXT[],
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_quota_config_user UNIQUE (user_id),
  CONSTRAINT ck_quota_config_user_or_default CHECK (
    (user_id IS NOT NULL) OR
    (user_id IS NULL AND NOT EXISTS (
      SELECT 1 FROM ai.quota_config qc2 WHERE qc2.user_id IS NULL AND qc2.id <> ai.quota_config.id
    ))
  )
);

COMMENT ON TABLE ai.quota_config IS
  'Per-user or global-default AI usage quota limits. user_id=null row is the fallback default.';
COMMENT ON COLUMN ai.quota_config.user_id IS
  'NULL represents the project-wide default; non-NULL is a per-user override.';
COMMENT ON COLUMN ai.quota_config.model_allowlist IS
  'If non-NULL and non-empty, restricts this user to only these model IDs.';

GRANT SELECT, INSERT, UPDATE ON ai.quota_config TO authenticated;

-- Seed a global-default quota row if none exists yet.
INSERT INTO ai.quota_config (
  user_id, max_requests_per_day, max_tokens_per_day, max_tokens_per_month, monthly_spend_cap_usd
)
SELECT NULL, 1000, 2000000, 60000000, 50.00
WHERE NOT EXISTS (SELECT 1 FROM ai.quota_config WHERE user_id IS NULL);
