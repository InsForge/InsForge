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
-- Create function to automatically create RLS policies for new tables
CREATE OR REPLACE FUNCTION public.create_default_policies()
RETURNS event_trigger AS $$
DECLARE
  obj record;
  table_schema text;
  table_name text;
  has_rls boolean;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'CREATE TABLE'
  LOOP
    -- Extract schema and table name from object_identity
    -- Handle quoted identifiers by removing quotes
    SELECT INTO table_schema, table_name
      split_part(obj.object_identity, '.', 1),
      trim(both '"' from split_part(obj.object_identity, '.', 2));
    -- Check if RLS is enabled on the table
    SELECT INTO has_rls
      rowsecurity
    FROM pg_tables
    WHERE schemaname = table_schema
      AND tablename = table_name;
    -- Only create policies if RLS is enabled
    IF has_rls THEN
      -- Create policy for project_admin role only
      -- Users must define their own policies for anon and authenticated roles
      EXECUTE format('CREATE POLICY "project_admin_policy" ON %s FOR ALL TO project_admin USING (true) WITH CHECK (true)', obj.object_identity);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create event trigger to run the function when new tables are created
CREATE EVENT TRIGGER create_policies_on_table_create
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE')
  EXECUTE FUNCTION public.create_default_policies();

-- Create function to handle RLS enablement
CREATE OR REPLACE FUNCTION public.create_policies_after_rls()
RETURNS event_trigger AS $$
DECLARE
  obj record;
  table_schema text;
  table_name text;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands() WHERE command_tag = 'ALTER TABLE'
  LOOP
    -- Extract schema and table name
    -- Handle quoted identifiers by removing quotes
    SELECT INTO table_schema, table_name
      split_part(obj.object_identity, '.', 1),
      trim(both '"' from split_part(obj.object_identity, '.', 2));
    -- Check if table has RLS enabled and no policies yet
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = table_schema
        AND tablename = table_name
        AND rowsecurity = true
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = table_schema
        AND tablename = table_name
    ) THEN
      -- Create policy for project_admin role only
      -- Users must define their own policies for anon and authenticated roles
      EXECUTE format('CREATE POLICY "project_admin_policy" ON %s FOR ALL TO project_admin USING (true) WITH CHECK (true)', obj.object_identity);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Create event trigger for ALTER TABLE commands
CREATE EVENT TRIGGER create_policies_on_rls_enable
  ON ddl_command_end
  WHEN TAG IN ('ALTER TABLE')
  EXECUTE FUNCTION public.create_policies_after_rls();
