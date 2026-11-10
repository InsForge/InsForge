-- init.sql
-- Create role for anonymous user
CREATE ROLE anon NOLOGIN;

-- Create role for authenticator
CREATE ROLE authenticated NOLOGIN;

-- Create project admin role for admin users
CREATE ROLE project_admin NOLOGIN;

GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO project_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO project_admin;

-- Grant permissions to roles
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated, project_admin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, project_admin;
CREATE SCHEMA IF NOT EXISTS system;

-- Create function to automatically enable RLS on newly created tables in schema public
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
    IF cmd.schema_name = 'public' AND (cmd.in_extension IS NULL OR NOT cmd.in_extension) THEN
      SELECT c.relname
      INTO v_relname
      FROM pg_catalog.pg_class c
      WHERE c.oid = cmd.objid
        AND c.relkind IN ('r', 'p')
        AND c.relpersistence <> 't'
        AND NOT c.relrowsecurity;

      IF v_relname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', cmd.schema_name, v_relname);
      END IF;
    END IF;
  END LOOP;
END;
$$;

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
