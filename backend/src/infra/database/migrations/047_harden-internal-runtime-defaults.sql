-- Migration: 047 - Harden internal runtime defaults after schema rework
--
-- The early bootstrap granted broad DML on all public tables to anon,
-- authenticated, and project_admin. Migration 018 later moved several
-- bootstrap tables out of public, and PostgreSQL preserved their ACLs during
-- ALTER TABLE ... SET SCHEMA. Remove those stale runtime grants now that the
-- tables live in internal schemas.
--
-- Also keep fresh storage installs usable by default. Migration 036 enabled
-- RLS on storage.objects even when no storage policies existed, which made a
-- reset database deny all end-user object access. Projects that already have
-- buckets or policies keep their existing RLS posture.
--
-- Anonymous storage access must be explicit. Public bucket downloads are served
-- through the backend API and do not require anon table privileges; custom anon
-- storage policies can grant the role back in project migrations.
--
-- Public schema tables remain the application data surface. Runtime roles need
-- table privileges there so project RLS policies can decide row-level access.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    -- Auth is served through the backend API, not direct runtime-role table
    -- access. Remove both the stale broad grants preserved by SET SCHEMA and
    -- the older public profile column grants.
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM PUBLIC, anon, authenticated;

    IF to_regclass('auth.users') IS NOT NULL THEN
      REVOKE SELECT (id, profile, created_at) ON auth.users FROM PUBLIC, anon, authenticated;
      REVOKE UPDATE (profile) ON auth.users FROM PUBLIC, anon, authenticated;
      DROP POLICY IF EXISTS "Public can view user profiles" ON auth.users;
      DROP POLICY IF EXISTS "Users can update own profile" ON auth.users;
      ALTER TABLE auth.users DISABLE ROW LEVEL SECURITY;
    END IF;

    -- These direct grants were ineffective without schema USAGE, but remove
    -- them so catalog output matches the intended access model.
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'system') THEN
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA system FROM anon, authenticated;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'functions') THEN
      REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA functions FROM anon, authenticated;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'storage') THEN
    REVOKE USAGE ON SCHEMA storage FROM anon;

    IF to_regclass('storage.objects') IS NOT NULL THEN
      REVOKE ALL PRIVILEGES ON TABLE storage.objects FROM anon;
    END IF;

    IF to_regclass('storage.buckets') IS NOT NULL THEN
      REVOKE ALL PRIVILEGES ON TABLE storage.buckets FROM anon;
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') THEN
    GRANT USAGE ON SCHEMA public TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon, authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
      ALTER DEFAULT PRIVILEGES FOR ROLE project_admin IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated;

      ALTER DEFAULT PRIVILEGES FOR ROLE project_admin IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
    END IF;
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_policy
       WHERE polrelid = 'storage.objects'::regclass
     ) THEN
    IF to_regclass('storage.buckets') IS NULL THEN
      ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
    ELSIF NOT EXISTS (SELECT 1 FROM storage.buckets LIMIT 1) THEN
      ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;
    END IF;
  END IF;
END $$;
