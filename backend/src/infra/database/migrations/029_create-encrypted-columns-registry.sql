-- Create registry table for tracking column-level encryption metadata
-- Stores which columns in which tables are encrypted, along with key version info

CREATE TABLE IF NOT EXISTS system.encrypted_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_schema TEXT NOT NULL DEFAULT 'public',
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  original_type TEXT NOT NULL,        -- original column type before encryption (e.g., 'jsonb', 'text')
  key_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (table_schema, table_name, column_name)
);

CREATE INDEX IF NOT EXISTS idx_encrypted_columns_table
  ON system.encrypted_columns (table_schema, table_name);

-- Add updated_at trigger
CREATE TRIGGER encrypted_columns_update_timestamp
  BEFORE UPDATE ON system.encrypted_columns
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
