-- Migration: 047 - Add extra_authorize_params column to oauth_configs
-- This allows custom OAuth parameters like prompt=select_account to be passed to providers

ALTER TABLE auth.oauth_configs 
ADD COLUMN IF NOT EXISTS extra_authorize_params JSONB DEFAULT NULL;

-- Add comment to document the purpose
COMMENT ON COLUMN auth.oauth_configs.extra_authorize_params IS 
'Custom OAuth authorization parameters (e.g., {"prompt": "select_account", "access_type": "offline"})';
