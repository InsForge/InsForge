-- Migration: 006 - Modify AI usage table
-- This migration modifies the _ai_usage table to:
-- 1. Change foreign key constraint on config_id to SET NULL
-- 2. Make config_id nullable
-- 3. Add model_id column

-- Drop existing foreign key constraint
ALTER TABLE _ai_usage 
DROP CONSTRAINT IF EXISTS _ai_usage_config_id_fkey;

-- Make config_id nullable
ALTER TABLE _ai_usage 
ALTER COLUMN config_id DROP NOT NULL;

-- Add new foreign key constraint with SET NULL on delete
ALTER TABLE _ai_usage 
ADD CONSTRAINT _ai_usage_config_id_fkey 
FOREIGN KEY (config_id) REFERENCES _ai_configs(id) ON DELETE SET NULL;

-- Add new columns for model identification
ALTER TABLE _ai_usage 
ADD COLUMN IF NOT EXISTS model_id VARCHAR(255);

-- Create indexes for the new columns
CREATE INDEX IF NOT EXISTS idx_ai_usage_model_id ON _ai_usage(model_id);