ALTER TABLE system.custom_migrations DROP CONSTRAINT IF EXISTS custom_migrations_version_check;
ALTER TABLE system.custom_migrations ADD CONSTRAINT custom_migrations_version_check CHECK (version ~ '^[0-9]{1,64}$');
