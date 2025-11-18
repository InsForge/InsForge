-- Migration: 004 - add reload_postgrest_schema function.

DO $$
BEGIN
    -- Create a function to reload PostgREST schema
    CREATE OR REPLACE FUNCTION reload_postgrest_schema()
    RETURNS void
    LANGUAGE plpgsql
    AS $reload_function$
    BEGIN
        -- Method 1: Use NOTIFY to signal PostgREST to reload schema
        -- PostgREST listens to 'pgrst' channel for schema changes
        NOTIFY pgrst, 'reload schema';
        
        RAISE NOTICE 'PostgREST schema reload notification sent';
    END
    $reload_function$;

    -- Grant execute permission to project_admin and authenticated users
    GRANT EXECUTE ON FUNCTION reload_postgrest_schema() TO project_admin;
    GRANT EXECUTE ON FUNCTION reload_postgrest_schema() TO authenticated;
    
    RAISE NOTICE 'PostgREST schema reload function created successfully';
END $$;