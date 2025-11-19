-- Migration: 000 - Create base system tables
-- This migration creates all the initial tables that the application needs

-- System configuration
CREATE TABLE IF NOT EXISTS _config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- App metadata
CREATE TABLE IF NOT EXISTS _metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Storage buckets table to track bucket-level settings
CREATE TABLE IF NOT EXISTS _storage_buckets (
  name TEXT PRIMARY KEY,
  public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Storage files table
CREATE TABLE IF NOT EXISTS _storage (
  bucket TEXT NOT NULL,
  key TEXT NOT NULL,
  size INTEGER NOT NULL,
  mime_type TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (bucket, key),
  FOREIGN KEY (bucket) REFERENCES _storage_buckets(name) ON DELETE CASCADE
);

-- MCP usage tracking table
CREATE TABLE IF NOT EXISTS _mcp_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name VARCHAR(255) NOT NULL,
  success BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- AI configurations table
CREATE TABLE IF NOT EXISTS _ai_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  modality VARCHAR(255) NOT NULL,
  provider VARCHAR(255) NOT NULL,
  model_id VARCHAR(255) UNIQUE NOT NULL,
  system_prompt TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _ai_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  config_id UUID NOT NULL,
  input_tokens INT,
  output_tokens INT,
  image_count INT,
  image_resolution TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  FOREIGN KEY (config_id) REFERENCES _ai_configs(id) ON DELETE NO ACTION
);

-- Indexes for AI tables
CREATE INDEX IF NOT EXISTS idx_ai_usage_config_id ON _ai_usage(config_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at ON _ai_usage(created_at DESC);

-- Index for efficient date range queries
CREATE INDEX IF NOT EXISTS idx_mcp_usage_created_at ON _mcp_usage(created_at DESC);

-- Edge functions
CREATE TABLE IF NOT EXISTS _edge_functions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_at TIMESTAMPTZ
);

-- Auth Tables (2-table structure)
-- User table
CREATE TABLE IF NOT EXISTS _user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT, -- NULL for OAuth-only users
  name TEXT,
  email_verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Account table (for OAuth connections)
CREATE TABLE IF NOT EXISTS _account (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES _user(id) ON DELETE CASCADE,
  provider TEXT NOT NULL, -- OAuth provider name: 'google', 'github', etc.
  provider_account_id TEXT NOT NULL, -- User's unique ID on the provider's system
  access_token TEXT, -- OAuth access token for making API calls to provider
  refresh_token TEXT, -- OAuth refresh token for renewing access
  provider_data JSONB, -- OAuth provider's user profile
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider, provider_account_id)
);

-- Create update timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update__config_updated_at ON _config;
CREATE TRIGGER update__config_updated_at BEFORE UPDATE ON _config
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update__metadata_updated_at ON _metadata;
CREATE TRIGGER update__metadata_updated_at BEFORE UPDATE ON _metadata
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update__edge_functions_updated_at ON _edge_functions;
CREATE TRIGGER update__edge_functions_updated_at BEFORE UPDATE ON _edge_functions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial metadata
INSERT INTO _metadata (key, value) VALUES ('version', '1.0.0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO _metadata (key, value) VALUES ('created_at', NOW()::TEXT)
ON CONFLICT (key) DO NOTHING;