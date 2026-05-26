-- Migration: 046 - Transfer existing public object ownership to project_admin
--
-- Raw SQL and custom migrations now execute as project_admin, so new public
-- objects are naturally owned by that role. Existing public objects may have
-- been created by the old root execution path; transfer non-extension-owned
-- public objects so old and new developer objects behave the same.

DO $$
DECLARE
  object_record record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    FOR object_record IN
      SELECT
        CASE c.relkind
          WHEN 'r' THEN 'TABLE'
          WHEN 'p' THEN 'TABLE'
          WHEN 'v' THEN 'VIEW'
          WHEN 'm' THEN 'MATERIALIZED VIEW'
          WHEN 'S' THEN 'SEQUENCE'
          WHEN 'f' THEN 'FOREIGN TABLE'
        END AS object_type,
        n.nspname AS schema_name,
        c.relname AS object_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
        AND pg_get_userbyid(c.relowner) <> 'project_admin'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend d
          WHERE d.objid = c.oid
            AND d.deptype = 'e'
        )
    LOOP
      EXECUTE format(
        'ALTER %s %I.%I OWNER TO project_admin',
        object_record.object_type,
        object_record.schema_name,
        object_record.object_name
      );
    END LOOP;

    FOR object_record IN
      SELECT
        CASE p.prokind
          WHEN 'p' THEN 'PROCEDURE'
          WHEN 'a' THEN 'AGGREGATE'
          ELSE 'FUNCTION'
        END AS object_type,
        n.nspname AS schema_name,
        p.proname AS object_name,
        pg_get_function_identity_arguments(p.oid) AS arguments
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND pg_get_userbyid(p.proowner) <> 'project_admin'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend d
          WHERE d.objid = p.oid
            AND d.deptype = 'e'
        )
    LOOP
      EXECUTE format(
        'ALTER %s %I.%I(%s) OWNER TO project_admin',
        object_record.object_type,
        object_record.schema_name,
        object_record.object_name,
        object_record.arguments
      );
    END LOOP;

    FOR object_record IN
      SELECT
        n.nspname AS schema_name,
        t.typname AS object_name
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typtype IN ('c', 'd', 'e', 'm', 'r')
        AND pg_get_userbyid(t.typowner) <> 'project_admin'
        AND NOT EXISTS (
          SELECT 1
          FROM pg_depend d
          WHERE d.objid = t.oid
            AND d.deptype = 'e'
        )
    LOOP
      EXECUTE format(
        'ALTER TYPE %I.%I OWNER TO project_admin',
        object_record.schema_name,
        object_record.object_name
      );
    END LOOP;
  END IF;
END $$;
