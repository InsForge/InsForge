-- Migration: 050 - Add O(1) trigger-backed row counters for table metadata
--
-- This migration:
-- 1. Creates system.table_metadata_counters table to store O(1) table row counts.
-- 2. Creates the system.maintain_table_row_count trigger function.
-- 3. Creates system.enable_table_counter utility function to initialize counters and attach triggers.
-- 4. Automatically registers all existing public base tables to initialize their counters.

-- 1. Create the counter table
CREATE TABLE IF NOT EXISTS system.table_metadata_counters (
  table_name TEXT PRIMARY KEY,
  row_count BIGINT DEFAULT 0 NOT NULL
);

-- Grant appropriate permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON system.table_metadata_counters TO project_admin;

-- 2. Create the trigger function
CREATE OR REPLACE FUNCTION system.maintain_table_row_count()
RETURNS TRIGGER AS $$
DECLARE
  v_table_name TEXT;
BEGIN
  v_table_name := TG_TABLE_NAME;

  IF TG_OP = 'INSERT' THEN
    UPDATE system.table_metadata_counters
    SET row_count = row_count + 1
    WHERE table_name = v_table_name;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE system.table_metadata_counters
    SET row_count = row_count - 1
    WHERE table_name = v_table_name;
  ELSIF TG_OP = 'TRUNCATE' THEN
    UPDATE system.table_metadata_counters
    SET row_count = 0
    WHERE table_name = v_table_name;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Create the enablement utility function
CREATE OR REPLACE FUNCTION system.enable_table_counter(target_schema TEXT, target_table TEXT)
RETURNS VOID AS $$
DECLARE
  v_initial_count BIGINT;
  v_sql TEXT;
BEGIN
  -- Verify the table exists in the schema
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = target_schema AND table_name = target_table
  ) THEN
    RAISE EXCEPTION 'Table %.% does not exist', target_schema, target_table;
  END IF;

  -- 1. Initialize counter with a one-time COUNT(*)
  EXECUTE format('SELECT COUNT(*) FROM %I.%I', target_schema, target_table) INTO v_initial_count;

  -- Insert or update the counter value in our table
  INSERT INTO system.table_metadata_counters (table_name, row_count)
  VALUES (target_table, v_initial_count)
  ON CONFLICT (table_name) 
  DO UPDATE SET row_count = EXCLUDED.row_count;

  -- 2. Attach row-level trigger (INSERT and DELETE)
  v_sql := format('DROP TRIGGER IF EXISTS trg_maintain_row_count ON %I.%I', target_schema, target_table);
  EXECUTE v_sql;

  v_sql := format('
    CREATE TRIGGER trg_maintain_row_count
    AFTER INSERT OR DELETE ON %I.%I
    FOR EACH ROW
    EXECUTE FUNCTION system.maintain_table_row_count();
  ', target_schema, target_table);
  EXECUTE v_sql;

  -- 3. Attach statement-level trigger (TRUNCATE) to reset count to 0
  v_sql := format('DROP TRIGGER IF EXISTS trg_maintain_row_count_truncate ON %I.%I', target_schema, target_table);
  EXECUTE v_sql;

  v_sql := format('
    CREATE TRIGGER trg_maintain_row_count_truncate
    AFTER TRUNCATE ON %I.%I
    FOR EACH STATEMENT
    EXECUTE FUNCTION system.maintain_table_row_count();
  ', target_schema, target_table);
  EXECUTE v_sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Automatically register all existing tables in the 'public' schema
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
  LOOP
    BEGIN
      PERFORM system.enable_table_counter('public', r.table_name);
    EXCEPTION WHEN OTHERS THEN
      -- Log warning and continue to prevent migration failure if a table is locked
      RAISE WARNING 'Failed to enable counter for table public.%, error: %', r.table_name, SQLERRM;
    END;
  END LOOP;
END $$;
