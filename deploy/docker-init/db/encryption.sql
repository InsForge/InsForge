\set encryption_key `echo "${ENCRYPTION_KEY:-${JWT_SECRET:-}}"` 

-- Only set the GUC if a key is available (non-empty).
-- This mirrors the jwt.sql pattern for app.settings.jwt_secret.
SELECT CASE
  WHEN :'encryption_key' <> '' THEN
    (SELECT set_config('app.encryption_key', :'encryption_key', false))
  ELSE NULL
END;

ALTER DATABASE postgres SET "app.encryption_key" TO :'encryption_key';
