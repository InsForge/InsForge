-- Add redirect_url_whitelist column to auth.configs
-- Default is an empty array to maintain permissive fallback
ALTER TABLE auth.configs 
ADD COLUMN IF NOT EXISTS redirect_url_whitelist TEXT[] DEFAULT '{}'::TEXT[];
