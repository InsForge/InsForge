-- NOTE: This migration file intentionally shares the '033' sequence prefix with
-- '033_create-s3-access-keys.sql'. This duplicate prefix is a known legacy anomaly,
-- but MUST be preserved exactly as-is to maintain backward compatibility with 
-- existing customer production deployments that have already run this migration.
-- DO NOT rename or renumber this file, as doing so will break tracking and rollback
-- systems in deployed databases.

ALTER TABLE system.custom_migrations DROP CONSTRAINT IF EXISTS custom_migrations_version_check;
ALTER TABLE system.custom_migrations ADD CONSTRAINT custom_migrations_version_check CHECK (version ~ '^[0-9]{1,64}$');

