-- Migration: 055 - Auto-grant SELECT on internal-schema tables to project_admin
--
-- project_admin (the HTTP/API-key admin role) needs read access to every table
-- in our managed internal schemas. Migration 045 enumerated those grants by
-- hand, so any table added to an internal schema afterwards had to remember its
-- own GRANT SELECT -- which was easy to miss (memory.memories in migration 050
-- shipped without one, and without schema USAGE, so it is unreadable by
-- project_admin today).
--
-- Migration 054 fixed this for the `system` schema with ALTER DEFAULT
-- PRIVILEGES; this migration extends the same rule to the other internal
-- schemas. ALTER DEFAULT PRIVILEGES with no FOR ROLE applies to objects created
-- by the role running the migration (postgres, the migration runner), so every
-- future table created by a migration in these schemas grants SELECT to
-- project_admin automatically. Per-table writes stay enumerated where a schema
-- needs them.
--
-- Each GRANT ON ALL TABLES backfills SELECT on tables that already exist
-- (catching missed grants such as memory.memories); each ALTER DEFAULT
-- PRIVILEGES covers tables created later.
--
-- The `system` schema is excluded: migration 054 already set its default
-- privilege. `public` is excluded too -- it is the developer data surface and
-- already receives ALL default privileges in migration 045.
--
-- Schemas are not individually existence-guarded: all of these are created by
-- earlier migrations and exist by the time 055 runs, matching migration 045's
-- role-only guard. Forward-only: there is no down migration -- the grants are
-- the intended steady state and reverting them would regress migration 045.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    -- memory was created after migration 045, so it never received the schema
    -- USAGE grant the other internal schemas have. Without it the table-level
    -- SELECT below is unusable.
    GRANT USAGE ON SCHEMA memory TO project_admin;

    GRANT SELECT ON ALL TABLES IN SCHEMA auth TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO project_admin;

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
  END IF;
END $$;

-- Drop the deprecated, empty `ai` schema while we are cleaning up internal-schema
-- privileges. Its tables (ai.configs, ai.usage) were removed in migration 043;
-- the schema was left behind, is referenced nowhere in application code, and
-- still surfaces in the dashboard schema list. No CASCADE, so an unexpected
-- leftover object fails loudly instead of being silently dropped.
DROP SCHEMA IF EXISTS ai;
