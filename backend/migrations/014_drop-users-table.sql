-- Migration: 014 - Drop users table (for benchmark testing)
-- WARNING: This migration removes the users table and all associated data
-- This is intended for benchmark testing environments only

DO $$
BEGIN
    -- Drop the users table if it exists
    -- CASCADE will automatically drop dependent objects like policies, constraints, etc.
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = 'users'
    ) THEN
        DROP TABLE users CASCADE;
        RAISE NOTICE 'Users table dropped successfully';
    ELSE
        RAISE NOTICE 'Users table does not exist, skipping drop';
    END IF;

    -- Notify PostgREST to reload schema after table drop
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reload_postgrest_schema') THEN
        PERFORM reload_postgrest_schema();
        RAISE NOTICE 'PostgREST schema reload requested after migration';
    ELSE
        RAISE WARNING 'PostgREST reload function not found - please restart PostgREST manually';
    END IF;

    RAISE NOTICE 'Migration drop-users-table completed successfully';
END $$;
