-- Migration: 049 - Move project admins out of auth.users
--
-- Project admins are control-plane principals, not application users. Keep
-- application identities in auth.users and store dashboard/admin principals in
-- auth.project_admins. This migration preserves existing admin refresh-token
-- subjects by reusing old auth.users.id values during backfill.

CREATE TABLE IF NOT EXISTS auth.project_admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_project_admin'
  ) THEN
    INSERT INTO auth.project_admins (id, email, created_at, updated_at)
    SELECT
      id,
      email,
      COALESCE(created_at, NOW()),
      COALESCE(updated_at, NOW())
    FROM auth.users
    WHERE is_project_admin = true
    ON CONFLICT (email) DO UPDATE SET
      id = EXCLUDED.id,
      updated_at = NOW();

    DELETE FROM auth.users
    WHERE is_project_admin = true;

    ALTER TABLE auth.users DROP COLUMN is_project_admin;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.project_admins TO project_admin;
  END IF;
END $$;
