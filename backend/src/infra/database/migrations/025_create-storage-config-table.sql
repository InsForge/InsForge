-- Migration: 025 - Create storage configuration table
-- This migration creates storage.configs (singleton) to persist
-- storage settings such as the maximum upload file size.

CREATE TABLE IF NOT EXISTS storage.configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  max_file_size_mb INTEGER DEFAULT 50 NOT NULL CHECK (max_file_size_mb >= 1 AND max_file_size_mb <= 5120),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Ensure only one row exists (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_configs_singleton ON storage.configs ((1));

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update_storage_configs_updated_at ON storage.configs;
CREATE TRIGGER update_storage_configs_updated_at
  BEFORE UPDATE ON storage.configs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Insert the default config row (50 MB default)
INSERT INTO storage.configs (max_file_size_mb)
VALUES (50)
ON CONFLICT DO NOTHING;
