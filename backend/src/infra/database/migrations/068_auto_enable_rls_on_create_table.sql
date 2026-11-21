-- Migration: 068 - Automatically enable Row Level Security on newly created public tables
--
-- Tables created via raw DDL (such as the SQL Editor, migrations, or raw SQL endpoints)
-- default to having Row Level Security (RLS) disabled in PostgreSQL. Combined with
-- default DML privileges granted to the `anon` and `authenticated` roles in schema public
-- for PostgREST, unprotected tables allow unauthenticated public clients to perform
-- unrestricted SELECT, INSERT, UPDATE, and DELETE operations.
--
-- This migration installs an event trigger on `ddl_command_end` that automatically
-- executes `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` whenever a table is created
-- in schema `public`.

CREATE SCHEMA IF NOT EXISTS system;

CREATE OR REPLACE FUNCTION system.auto_enable_rls()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  cmd record;
  v_relname text;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  LOOP
    -- Only auto-enable for tables in schema 'public'.
    -- Temporary tables reside in pg_temp_* schemas and are safely skipped.
    -- Extension-internal tables and non-public schemas are skipped.
    IF cmd.schema_name = 'public' AND (cmd.in_extension IS NULL OR NOT cmd.in_extension) THEN
      SELECT c.relname
      INTO v_relname
      FROM pg_catalog.pg_class c
      WHERE c.oid = cmd.objid
        AND c.relkind IN ('r', 'p')        -- ordinary or partitioned tables
        AND c.relpersistence <> 't'         -- exclude temporary tables
        AND NOT c.relrowsecurity;           -- idempotent: only if not already enabled

      IF v_relname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', cmd.schema_name, v_relname);
      END IF;
    END IF;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION system.auto_enable_rls() IS
  'Event trigger function to automatically enable RLS on newly created tables in schema public';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    GRANT EXECUTE ON FUNCTION system.auto_enable_rls() TO project_admin;
  END IF;
END $$;

DROP EVENT TRIGGER IF EXISTS auto_enable_rls_on_create_table;

CREATE EVENT TRIGGER auto_enable_rls_on_create_table
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION system.auto_enable_rls();

