-- Migration: 024 - Create dedicated custom OAuth configs table
--
-- Stores custom (non-built-in) OAuth/OIDC provider configurations.
-- Uses discovery endpoint for automatic endpoint resolution.
-- PKCE is always enabled for custom providers.

CREATE TABLE IF NOT EXISTS auth.custom_oauth_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  discovery_endpoint TEXT NOT NULL,
  client_id TEXT NOT NULL,
  secret_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_oauth_configs_key_format_check CHECK (key ~ '^[a-z0-9_-]+$')
);

ALTER TABLE auth.custom_oauth_configs
DROP CONSTRAINT IF EXISTS custom_oauth_configs_secret_id_fkey;

ALTER TABLE auth.custom_oauth_configs
ADD CONSTRAINT custom_oauth_configs_secret_id_fkey
FOREIGN KEY (secret_id) REFERENCES system.secrets(id) ON DELETE RESTRICT;

DROP TRIGGER IF EXISTS update_custom_oauth_configs_updated_at ON auth.custom_oauth_configs;
CREATE TRIGGER update_custom_oauth_configs_updated_at
  BEFORE UPDATE ON auth.custom_oauth_configs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
