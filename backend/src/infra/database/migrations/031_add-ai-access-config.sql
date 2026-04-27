-- Migration 031: Add AI access configuration table
--
-- Creates ai.config (singleton) to persist per-project AI access settings.
-- The allow_anon_ai_access flag controls whether anonymous (API-key) tokens
-- can access AI endpoints.  Defaults to TRUE so existing projects are
-- unaffected by the migration.

-- ============================================================================
-- CONFIGURATION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai.config (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  allow_anon_ai_access  BOOLEAN     DEFAULT TRUE NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at            TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure only one row exists (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_config_singleton ON ai.config ((1));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_ai_config_updated_at ON ai.config;
CREATE TRIGGER update_ai_config_updated_at
  BEFORE UPDATE ON ai.config
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ============================================================================
-- SEED DEFAULT ROW
-- ============================================================================
-- Insert the default config row (anon AI access enabled by default)
INSERT INTO ai.config (allow_anon_ai_access)
VALUES (TRUE)
ON CONFLICT DO NOTHING;
