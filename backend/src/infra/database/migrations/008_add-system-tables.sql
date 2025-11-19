-- Migration: 008 - Create new system tables and rename OAuth connections table

-- 1. Create _secrets table for storing application secrets
CREATE TABLE IF NOT EXISTS _secrets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  value_ciphertext TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create _oauth_configs table for OAuth provider configurations
CREATE TABLE IF NOT EXISTS _oauth_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  provider TEXT UNIQUE NOT NULL,
  client_id TEXT,
  secret_id UUID REFERENCES _secrets(id) ON DELETE RESTRICT,
  scopes TEXT[],
  redirect_uri TEXT,
  use_shared_key BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create _audit_logs table for storing admin operation logs
CREATE TABLE IF NOT EXISTS _audit_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  module TEXT NOT NULL,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Rename _oauth_connections to _account_providers
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables
              WHERE table_name = '_oauth_connections' AND table_schema = 'public') THEN
        IF EXISTS (SELECT FROM information_schema.tables
                  WHERE table_name = '_account_providers' AND table_schema = 'public') THEN
            -- _account_providers already exists, just drop _oauth_connections
            DROP TABLE _oauth_connections CASCADE;
        ELSE
            -- _account_providers doesn't exist, rename _oauth_connections to _account_providers
            ALTER TABLE _oauth_connections RENAME TO _account_providers;
        END IF;
    END IF;
END $$;

-- 5. Drop the old _config system table
DROP TABLE IF EXISTS _config CASCADE;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_secrets_name ON _secrets(name);
CREATE INDEX IF NOT EXISTS idx_oauth_configs_provider ON _oauth_configs(provider);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON _audit_logs(actor);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON _audit_logs(module);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON _audit_logs(created_at DESC);

-- Add triggers for updated_at
DROP TRIGGER IF EXISTS update__secrets_updated_at ON _secrets;
CREATE TRIGGER update__secrets_updated_at BEFORE UPDATE ON _secrets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update__oauth_configs_updated_at ON _oauth_configs;
CREATE TRIGGER update__oauth_configs_updated_at BEFORE UPDATE ON _oauth_configs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update__audit_logs_updated_at ON _audit_logs;
CREATE TRIGGER update__audit_logs_updated_at BEFORE UPDATE ON _audit_logs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();