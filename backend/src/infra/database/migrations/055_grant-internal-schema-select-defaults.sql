-- Migration: 055 - Auto-grant SELECT on internal-schema tables to project_admin
--
-- project_admin (the HTTP/API-key admin role) needs read access to every table
-- in our managed internal schemas. Migration 045 enumerated those grants by
-- hand, so any table added to an internal schema afterwards had to remember its
-- own GRANT SELECT -- which was easy to miss (memory.memories in migration 050
-- shipped without one and is currently unreadable by project_admin).
--
-- Migration 054 fixed this for the `system` schema with ALTER DEFAULT
-- PRIVILEGES; this migration extends the same rule to every internal schema.
-- ALTER DEFAULT PRIVILEGES with no FOR ROLE applies to objects created by the
-- role running the migration (postgres, the migration runner), so every future
-- table created by a migration in these schemas grants SELECT to project_admin
-- automatically. Per-table writes stay enumerated where a schema needs them.
--
-- Each GRANT ON ALL TABLES backfills SELECT on tables that already exist
-- (catching missed grants such as memory.memories); each ALTER DEFAULT
-- PRIVILEGES covers tables created later.
--
-- `public` is intentionally excluded: it is the developer data surface and
-- already receives ALL default privileges in migration 045.

-- UP migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA auth TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA ai TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ai GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA compute TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA compute GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA deployments TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA deployments GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA email TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA email GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA functions TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA functions GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA memory TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA memory GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA payments TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA payments GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA realtime TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA realtime GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA schedules TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA schedules GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA storage TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA system TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA system GRANT SELECT ON TABLES TO project_admin;
  END IF;
END $$;

-- DOWN migration
-- Only remove the default-privilege rule. Existing table-level SELECT grants are
-- left in place because they match the intended access model established in
-- migration 045; revoking them here would regress that migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA ai REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA compute REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA deployments REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA email REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA functions REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA memory REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA payments REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA realtime REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA schedules REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage REVOKE SELECT ON TABLES FROM project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA system REVOKE SELECT ON TABLES FROM project_admin;
  END IF;
END $$;
