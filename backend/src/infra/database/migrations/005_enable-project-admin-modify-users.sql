-- Migration: 005 - Enable project admin modify any users.

DO $$
BEGIN
    -- Create policy to allow project_admin to update any user
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'users' 
        AND policyname = 'Allow project_admin to update any user'
    ) THEN
        CREATE POLICY "Allow project_admin to update any user" ON users
            FOR UPDATE
            TO project_admin
            USING (true)
            WITH CHECK (true);  -- Ensure project_admin always can update
    END IF;

    -- Grant necessary permissions
    GRANT SELECT, UPDATE ON users TO project_admin;
    
    -- Notify PostgREST to reload schema after policy changes
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reload_postgrest_schema') THEN
        PERFORM reload_postgrest_schema();
        RAISE NOTICE 'PostgREST schema reload requested after migration';
    ELSE
        RAISE WARNING 'PostgREST reload function not found - please restart PostgREST manually';
    END IF;
    
    RAISE NOTICE 'Migration project-admin-update-users completed successfully';
END $$;