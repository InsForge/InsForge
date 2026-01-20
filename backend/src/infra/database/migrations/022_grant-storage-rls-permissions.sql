-- Grant storage schema and table access to roles for RLS
GRANT USAGE ON SCHEMA storage TO anon, authenticated, project_admin;
GRANT SELECT, INSERT, DELETE ON storage.objects TO anon, authenticated, project_admin;
