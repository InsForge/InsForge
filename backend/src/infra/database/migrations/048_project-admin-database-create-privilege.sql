-- Migration: 048 - Allow project_admin to create database-scoped developer objects
--
-- PostgreSQL uses the database-level CREATE privilege for creating schemas and
-- publications. Grant it to project_admin so dashboard/custom migration DDL can
-- rely on the role's native permissions instead of root-owned backdoors.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    EXECUTE format('GRANT CREATE ON DATABASE %I TO project_admin', current_database());
  END IF;
END $$;
