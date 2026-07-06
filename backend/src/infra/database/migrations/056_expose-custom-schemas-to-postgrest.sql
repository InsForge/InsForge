-- Migration: 056 - Expose developer-created schemas to PostgREST (deny-list model)
--
-- PostgREST only serves schemas listed in its `db-schemas` config, and that
-- list is loaded once at boot (compose pins `PGRST_DB_SCHEMA: public`). There
-- is no wildcard, so any schema a developer creates at runtime is invisible to
-- the data API (`/api/database/records/*`) even though the proxy already
-- forwards `Accept-Profile`/`Content-Profile`.
--
-- This migration makes the exposed set dynamic with an OPT-OUT (deny-list)
-- policy: every schema is exposed to the data API EXCEPT Postgres internals,
-- InsForge's own internal schemas, and extension-owned schemas. New schemas
-- become reachable automatically via a DDL event trigger -- including those
-- created through raw SQL or migrations, not just the table API.
--
-- Mechanism:
--   1. The live allowlist is stored in the connecting role's in-database config
--      (`pgrst.db_schemas`), which overrides the static env default and can
--      change without restarting the PostgREST container.
--   2. On CREATE/ALTER/DROP SCHEMA, an event trigger recomputes the allowlist
--      and signals PostgREST with BOTH `reload config` (re-read db_schemas) and
--      `reload schema` (re-introspect objects). Both are required -- today's
--      code only ever sends `reload schema`, which cannot pick up a new schema.
--
-- This migration handles EXPOSURE (making a schema routable) only -- not
-- ACCESS. Privileges are the developer's responsibility, exactly as on any
-- Postgres schema:
--   * Objects created through the dashboard / table API / raw SQL run as
--     project_admin (see withAdminContext), so project_admin owns them and has
--     full access automatically.
--   * To reach a schema as anon/authenticated, grant it explicitly -- e.g. in
--     the same migration that creates the schema:
--       GRANT USAGE ON SCHEMA my_schema TO anon, authenticated;
--       GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA my_schema TO anon, authenticated;
--     Row visibility is then gated by RLS as usual. A schema is therefore
--     routable as soon as it exists, but unreachable until granted.

-- UP migration

-- Deny-list predicate: which schemas are exposed to the data API. Keeps
-- `public`, excludes Postgres internals, InsForge internal schemas, and any
-- schema owned by an extension (e.g. pg_cron's `cron`, PostGIS's `tiger`).
-- STABLE rather than IMMUTABLE because it reads catalogs and the
-- `insforge.internal_schemas` GUC.
--
-- The InsForge-internal deny-list is sourced from the `insforge.internal_schemas`
-- setting (defined in postgresql.conf, alongside `insforge.policy_grant_tables`)
-- so it has a single source of truth and can be updated without a migration.
-- The literal below is only a fallback for deployments where the GUC is unset.
CREATE OR REPLACE FUNCTION system.is_exposed_schema(p_schema text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT
    p_schema IS NOT NULL
    AND p_schema NOT LIKE 'pg\_%'
    AND p_schema <> 'information_schema'
    AND p_schema <> ALL (
      -- Comma-separated GUC; strip any incidental whitespace before splitting.
      string_to_array(
        regexp_replace(
          coalesce(
            nullif(current_setting('insforge.internal_schemas', true), ''),
            'ai,auth,compute,deployments,email,functions,memory,payments,realtime,schedules,storage,system'
          ),
          '\s', '', 'g'
        ),
        ','
      )
    )
    -- Extension-managed schemas are infrastructure, not developer data.
    AND NOT EXISTS (
      SELECT 1
      FROM pg_depend d
      JOIN pg_namespace n ON n.oid = d.objid
      WHERE d.classid = 'pg_namespace'::regclass
        AND d.refclassid = 'pg_extension'::regclass
        AND d.deptype = 'e'
        AND n.nspname = p_schema
    );
$fn$;

-- Recompute the exposed-schema allowlist, write it to the connecting role's
-- in-database config, and signal PostgREST to reload.
--
-- SECURITY DEFINER so it runs with the migration owner's privileges when fired
-- from a developer's CREATE SCHEMA. `current_user` inside a SECURITY DEFINER
-- function is the function owner -- i.e. the role the migration ran as, which
-- is the same role PostgREST connects as (`PGRST_DB_URI` uses `POSTGRES_USER`).
-- So `ALTER ROLE CURRENT_USER` always targets the right role with no config.
CREATE OR REPLACE FUNCTION system.sync_postgrest_exposed_schemas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_list text;
BEGIN
  -- `public` sorts first so it stays the default profile (no Accept-Profile).
  SELECT string_agg(n.nspname, ', ' ORDER BY (n.nspname <> 'public'), n.nspname)
  INTO v_list
  FROM pg_namespace n
  WHERE system.is_exposed_schema(n.nspname);

  v_list := coalesce(v_list, 'public');

  EXECUTE format('ALTER ROLE CURRENT_USER SET pgrst.db_schemas = %L', v_list);

  -- Order matters: re-read config (new db_schemas) before re-introspecting.
  PERFORM pg_notify('pgrst', 'reload config');
  PERFORM pg_notify('pgrst', 'reload schema');
END;
$fn$;

-- Event-trigger handler: keep PostgREST's exposed-schema set in sync as schemas
-- come and go. Recompute + reload regardless of CREATE/ALTER/DROP (a DROP has
-- already removed the schema from the catalog by ddl_command_end).
CREATE OR REPLACE FUNCTION system.on_schema_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  PERFORM system.sync_postgrest_exposed_schemas();
END;
$fn$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    GRANT EXECUTE ON FUNCTION system.sync_postgrest_exposed_schemas() TO project_admin;
  END IF;
END $$;

DROP EVENT TRIGGER IF EXISTS insforge_sync_postgrest_schemas;
CREATE EVENT TRIGGER insforge_sync_postgrest_schemas
  ON ddl_command_end
  WHEN TAG IN ('CREATE SCHEMA', 'ALTER SCHEMA', 'DROP SCHEMA')
  EXECUTE FUNCTION system.on_schema_ddl();

-- Backfill: seed the allowlist from schemas that already exist.
SELECT system.sync_postgrest_exposed_schemas();

-- DOWN migration

DROP EVENT TRIGGER IF EXISTS insforge_sync_postgrest_schemas;

-- Reset the data API back to public-only before tearing down the helpers.
DO $$
BEGIN
  EXECUTE format('ALTER ROLE CURRENT_USER SET pgrst.db_schemas = %L', 'public');
  PERFORM pg_notify('pgrst', 'reload config');
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;

DROP FUNCTION IF EXISTS system.on_schema_ddl() CASCADE;
DROP FUNCTION IF EXISTS system.sync_postgrest_exposed_schemas();
DROP FUNCTION IF EXISTS system.is_exposed_schema(text);
