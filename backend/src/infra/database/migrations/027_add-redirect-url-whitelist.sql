-- Rename auth.configs to auth.config, add allowed_redirect_urls,
-- and persist per-request redirect targets for email OTP flows.
ALTER TABLE IF EXISTS auth.configs RENAME TO config;

-- Keep the trigger name aligned with the renamed auth.config table.
DROP TRIGGER IF EXISTS update_configs_updated_at ON auth.config;
CREATE TRIGGER update_config_updated_at
BEFORE UPDATE ON auth.config
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Add allowed_redirect_urls column to auth.config
-- Default is an empty array to maintain permissive fallback
ALTER TABLE auth.config
ADD COLUMN IF NOT EXISTS allowed_redirect_urls TEXT[] DEFAULT '{}'::TEXT[];

-- Migrate existing values
UPDATE auth.config
SET allowed_redirect_urls = ARRAY[sign_in_redirect_to]
WHERE sign_in_redirect_to IS NOT NULL AND sign_in_redirect_to != '';

-- Drop original column
ALTER TABLE auth.config DROP COLUMN IF EXISTS sign_in_redirect_to;

-- Store the validated redirect target alongside email OTP records so
-- backend-owned action links can complete auth flows before redirecting.
ALTER TABLE auth.email_otps
ADD COLUMN IF NOT EXISTS redirect_to TEXT;
