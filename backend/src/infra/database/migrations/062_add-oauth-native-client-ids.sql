-- Migration 062: Native OAuth client IDs
--
-- Browser OAuth commonly uses a web/service client ID while native provider
-- SDKs issue ID tokens for an app-specific client ID. Keep those trusted
-- audiences in project-owned OAuth configuration instead of accepting an
-- audience selected by an unauthenticated sign-in request.

ALTER TABLE auth.oauth_configs
  ADD COLUMN IF NOT EXISTS native_client_ids TEXT[];

UPDATE auth.oauth_configs
SET native_client_ids = '{}'
WHERE native_client_ids IS NULL;

ALTER TABLE auth.oauth_configs
  ALTER COLUMN native_client_ids SET DEFAULT '{}';

ALTER TABLE auth.oauth_configs
  ALTER COLUMN native_client_ids SET NOT NULL;
