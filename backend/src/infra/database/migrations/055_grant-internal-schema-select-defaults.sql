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
-- Safety / idempotency:
--   * The role and every schema are existence-guarded, so the migration is a
--     no-op (never errors) on a database where they are absent.
--   * GRANT / ALTER DEFAULT PRIVILEGES are inherently idempotent, so re-running
--     (migrate:redo) is safe.
--   * Forward-only: there is no down migration -- the grants are the intended
--     steady state and reverting them would regress migration 045. This matches
--     the repository convention (the large majority of migrations have no down).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    RETURN;
  END IF;

  IF to_regnamespace('auth') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA auth TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('compute') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA compute TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA compute GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('deployments') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA deployments TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA deployments GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('email') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA email TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA email GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('functions') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA functions TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA functions GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('memory') IS NOT NULL THEN
    -- memory was created after migration 045, so it never received the schema
    -- USAGE grant the other internal schemas have. Without it the table-level
    -- SELECT below is unusable.
    GRANT USAGE ON SCHEMA memory TO project_admin;
    GRANT SELECT ON ALL TABLES IN SCHEMA memory TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA memory GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('payments') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA payments TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA payments GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('realtime') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA realtime TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA realtime GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('schedules') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA schedules TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA schedules GRANT SELECT ON TABLES TO project_admin;
  END IF;

  IF to_regnamespace('storage') IS NOT NULL THEN
    GRANT SELECT ON ALL TABLES IN SCHEMA storage TO project_admin;
    ALTER DEFAULT PRIVILEGES IN SCHEMA storage GRANT SELECT ON TABLES TO project_admin;
  END IF;
END $$;

-- Drop the deprecated `ai` schema while we are cleaning up internal-schema
-- privileges. Its tables (ai.configs, ai.usage) were removed in migration 043;
-- the schema was left behind, is referenced nowhere in application code, and
-- still surfaces in the dashboard schema list. Use RESTRICT semantics (no
-- CASCADE): if the schema unexpectedly still holds objects, leave it untouched
-- with a notice rather than silently destroying anything.
DO $$
BEGIN
  IF to_regnamespace('ai') IS NOT NULL THEN
    BEGIN
      EXECUTE 'DROP SCHEMA ai';
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE NOTICE 'Schema "ai" is not empty; leaving it in place instead of dropping.';
    END;
  END IF;
END $$;
