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
-- `public` is intentionally excluded: it is the developer data surface and
-- already receives ALL default privileges in migration 045.
--
-- Idempotent: GRANT / ALTER DEFAULT PRIVILEGES re-runs are no-ops, and each
-- schema is guarded so fresh or partially-migrated databases do not fail.

-- UP migration
DO $$
DECLARE
  target_schema text;
  internal_schemas text[] := ARRAY[
    'auth', 'ai', 'compute', 'deployments', 'email', 'functions',
    'memory', 'payments', 'realtime', 'schedules', 'storage', 'system'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    RETURN;
  END IF;

  FOREACH target_schema IN ARRAY internal_schemas LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = target_schema) THEN
      -- Backfill SELECT on tables that already exist (catches any missed grants,
      -- e.g. memory.memories from migration 050).
      EXECUTE format(
        'GRANT SELECT ON ALL TABLES IN SCHEMA %I TO project_admin',
        target_schema
      );
      -- Future-proof: tables created later by the migration runner inherit SELECT.
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO project_admin',
        target_schema
      );
    END IF;
  END LOOP;
END $$;

-- DOWN migration
-- Only remove the default-privilege rule. Existing table-level SELECT grants are
-- left in place because they match the intended access model established in
-- migration 045; revoking them here would regress that migration.
DO $$
DECLARE
  target_schema text;
  internal_schemas text[] := ARRAY[
    'auth', 'ai', 'compute', 'deployments', 'email', 'functions',
    'memory', 'payments', 'realtime', 'schedules', 'storage', 'system'
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    RETURN;
  END IF;

  FOREACH target_schema IN ARRAY internal_schemas LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = target_schema) THEN
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE SELECT ON TABLES FROM project_admin',
        target_schema
      );
    END IF;
  END LOOP;
END $$;
