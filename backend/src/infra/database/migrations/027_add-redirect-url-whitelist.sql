-- Add redirect_url_whitelist column to auth.configs
-- Default is an empty array to maintain permissive fallback
ALTER TABLE auth.configs 
ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] DEFAULT '{}'::TEXT[];

-- Migrate existing values
UPDATE auth.configs
SET redirect_url_whitelist = ARRAY[sign_in_redirect_to]
WHERE sign_in_redirect_to IS NOT NULL AND sign_in_redirect_to != '';

-- Drop original column
ALTER TABLE auth.configs DROP COLUMN IF EXISTS sign_in_redirect_to;
