-- Migration: 011 - Drop function secrets table and update main secrets table
-- This migration is part of the refactoring to unify all secrets management

-- 1. Drop the _function_secrets table (replaced by main _secrets table)
DROP TRIGGER IF EXISTS update__function_secrets_updated_at ON _function_secrets;
DROP INDEX IF EXISTS idx_function_secrets_key;
DROP TABLE IF EXISTS _function_secrets;

-- 2. Add is_reserved column to _secrets table
ALTER TABLE _secrets 
ADD COLUMN IF NOT EXISTS is_reserved BOOLEAN DEFAULT FALSE;

-- 3. Rename name column to key
ALTER TABLE _secrets 
RENAME COLUMN name TO key;
