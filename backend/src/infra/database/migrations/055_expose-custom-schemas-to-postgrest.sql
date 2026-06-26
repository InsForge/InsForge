-- Migration: 055 - Expose developer-created schemas to PostgREST (deny-list model)
--
-- PostgREST only serves schemas listed in its `db-schemas` config, and that
-- list is loaded once at boot (compose pins `PGRST_DB_SCHEMA: public`). There
-- is no wildcard, so any schema a developer creates at runtime is invisible to
-- the data API (`/api/database/records/*`) even though the proxy already
-- forwards `Accept-Profile`/`Content-Profile`.
--
-- This migration makes the exposed set dynamic with an OPT-OUT (deny-list)
-- policy: every schema is exposed to the data API EXCEPT Postgres internals,
-- InsForge's own internal schemas, and any schema whose name begins with `_`
-- (the "keep private" convention). New schemas become reachable automatically
-- via a DDL event trigger -- including those created through raw SQL or
-- migrations, not just the table API.
--
-- Mechanism:
--   1. The live allowlist is stored in the authenticator role's in-database
--      config (`pgrst.db_schemas`), which overrides the static env default and
--      can change without restarting the PostgREST container.
--   2. On CREATE/ALTER/DROP SCHEMA, an event trigger recomputes the allowlist,
--      grants the API roles access on newly-exposed schemas, then signals
--      PostgREST with BOTH `reload config` (re-read db_schemas) and
--      `reload schema` (re-introspect objects). Both are required -- today's
--      code only ever sends `reload schema`, which cannot pick up a new schema.
--
-- Security note: a schema that is not denied is exposed to anon/authenticated
-- with the same CRUD surface as `public` today; row visibility is still gated
-- by RLS. Tables created WITHOUT RLS are reachable by anon exactly as they are
-- in `public` now -- this is intentionally consistent with the existing model.

-- UP migration

-- Authenticator role name (the role PostgREST connects as). Defaults to
-- 'postgres' to match `PGRST_DB_URI`; deployments that use a dedicated
-- authenticator can override with:
--   ALTER DATABASE <db> SET insforge.authenticator_role = '<role>';
CREATE OR REPLACE FUNCTION system.postgrest_authenticator_role()
RETURNS text
LANGUAGE sql
STABLE
AS $fn$
  SELECT coalesce(nullif(current_setting('insforge.authenticator_role', true), ''), 'postgres');
$fn$;

-- Deny-list predicate: which schemas are exposed to the data API. Keeps
-- `public`, excludes Postgres internals, InsForge internal schemas, any
-- `_`-prefixed schema (the "keep private" convention), and any schema owned by
-- an extension (e.g. pg_cron's `cron`, PostGIS's `tiger`). STABLE rather than
-- IMMUTABLE because it reads catalogs and the `insforge.internal_schemas` GUC.
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
    AND p_schema NOT LIKE '\_%'
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

-- Grant the API roles access on a schema, mirroring the `public` model (see
-- migrations 045 and 047). SECURITY DEFINER so it runs with the migration
-- owner's privileges when fired from a developer's CREATE SCHEMA. Idempotent.
CREATE OR REPLACE FUNCTION system.grant_api_access_on_schema(p_schema text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
BEGIN
  IF p_schema IS NULL OR NOT system.is_exposed_schema(p_schema) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = p_schema) THEN
    RETURN;
  END IF;

  -- anon / authenticated: same CRUD surface as public, gated by RLS.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO anon, authenticated', p_schema);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO anon, authenticated', p_schema);
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO anon, authenticated', p_schema);

    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated', p_schema);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated', p_schema);

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE project_admin IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated', p_schema);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE project_admin IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated', p_schema);
    END IF;
  END IF;

  -- project_admin: full access (BYPASSRLS is set on the role globally in 045).
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    EXECUTE format('GRANT ALL ON SCHEMA %I TO project_admin', p_schema);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I TO project_admin', p_schema);
    EXECUTE format('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I TO project_admin', p_schema);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA %I TO project_admin', p_schema);

    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL PRIVILEGES ON TABLES TO project_admin', p_schema);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL PRIVILEGES ON SEQUENCES TO project_admin', p_schema);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT EXECUTE ON FUNCTIONS TO project_admin', p_schema);
  END IF;
END;
$fn$;

-- Recompute the exposed-schema allowlist, write it to the authenticator role's
-- in-database config, and signal PostgREST to reload.
CREATE OR REPLACE FUNCTION system.sync_postgrest_exposed_schemas()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_list text;
  v_role text;
BEGIN
  -- `public` sorts first so it stays the default profile (no Accept-Profile).
  SELECT string_agg(n.nspname, ', ' ORDER BY (n.nspname <> 'public'), n.nspname)
  INTO v_list
  FROM pg_namespace n
  WHERE system.is_exposed_schema(n.nspname);

  v_list := coalesce(v_list, 'public');
  v_role := system.postgrest_authenticator_role();

  EXECUTE format('ALTER ROLE %I SET pgrst.db_schemas = %L', v_role, v_list);

  -- Order matters: re-read config (new db_schemas) before re-introspecting.
  PERFORM pg_notify('pgrst', 'reload config');
  PERFORM pg_notify('pgrst', 'reload schema');
END;
$fn$;

-- Event-trigger handler: keep PostgREST in sync as schemas come and go.
CREATE OR REPLACE FUNCTION system.on_schema_ddl()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  obj record;
  v_schema text;
BEGIN
  -- Grant access on any newly created/altered schema that is exposed.
  FOR obj IN
    SELECT object_identity
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE SCHEMA', 'ALTER SCHEMA')
  LOOP
    v_schema := trim(both '"' from obj.object_identity);
    PERFORM system.grant_api_access_on_schema(v_schema);
  END LOOP;

  -- Recompute + reload regardless of CREATE/ALTER/DROP (a DROP has already
  -- removed the schema from the catalog by ddl_command_end).
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

-- Backfill: grant access on existing exposed schemas and seed the allowlist.
DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN SELECT nspname FROM pg_namespace WHERE system.is_exposed_schema(nspname)
  LOOP
    PERFORM system.grant_api_access_on_schema(rec.nspname);
  END LOOP;

  PERFORM system.sync_postgrest_exposed_schemas();
END $$;

-- DOWN migration

DROP EVENT TRIGGER IF EXISTS insforge_sync_postgrest_schemas;

-- Reset the data API back to public-only before tearing down the helpers.
DO $$
DECLARE
  v_role text;
BEGIN
  v_role := coalesce(nullif(current_setting('insforge.authenticator_role', true), ''), 'postgres');
  EXECUTE format('ALTER ROLE %I SET pgrst.db_schemas = %L', v_role, 'public');
  PERFORM pg_notify('pgrst', 'reload config');
  PERFORM pg_notify('pgrst', 'reload schema');
END $$;

DROP FUNCTION IF EXISTS system.on_schema_ddl() CASCADE;
DROP FUNCTION IF EXISTS system.sync_postgrest_exposed_schemas();
DROP FUNCTION IF EXISTS system.grant_api_access_on_schema(text);
DROP FUNCTION IF EXISTS system.is_exposed_schema(text);
DROP FUNCTION IF EXISTS system.postgrest_authenticator_role();
