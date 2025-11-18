-- Migration: 009 - Create function secrets table for edge functions environment variables
-- This table stores encrypted secrets that are injected into edge functions as Deno.env variables

CREATE TABLE IF NOT EXISTS _function_secrets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR(255) UNIQUE NOT NULL,
  value_ciphertext TEXT NOT NULL,      -- Encrypted value using AES-256-GCM
  is_reserved BOOLEAN DEFAULT FALSE,   -- System-reserved keys that can't be modified/deleted
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster key lookups
CREATE INDEX IF NOT EXISTS idx_function_secrets_key ON _function_secrets(key);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS update__function_secrets_updated_at ON _function_secrets;
CREATE TRIGGER update__function_secrets_updated_at BEFORE UPDATE ON _function_secrets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Note: Reserved system secrets will be initialized by the application on startup

-- Rename _edge_functions table to functions
ALTER TABLE IF EXISTS _edge_functions RENAME TO _functions;