-- UP migration
DO $$
BEGIN
  -- Grant SELECT on existing table
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'system' AND tablename = 'database_backups')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    EXECUTE 'GRANT SELECT ON TABLE system.database_backups TO project_admin';
  END IF;

  -- Future-proof: set default privileges only for postgres
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA system GRANT SELECT ON TABLES TO project_admin';
  END IF;
END $$;

-- DOWN migration
DO $$
BEGIN
  -- Revoke SELECT on table if present
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'system' AND tablename = 'database_backups')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    EXECUTE 'REVOKE SELECT ON TABLE system.database_backups FROM project_admin';
  END IF;

  -- Revoke default privileges for postgres
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'system')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA system REVOKE SELECT ON TABLES FROM project_admin';
  END IF;
END $$;