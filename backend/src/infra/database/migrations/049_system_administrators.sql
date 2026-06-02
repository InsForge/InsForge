-- Migration: 049 - Move platform admin and anon identities out of auth.users
-- Transitional compatibility (strategy 2): introduce system.administrators and
-- provide a compatibility view auth.users_compat that mimics legacy flags.

-- 1) Create system.administrators table
CREATE TABLE IF NOT EXISTS system.administrators (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  email_verified BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2) Backfill from legacy auth.users rows (admin)
-- Legacy admin row: id = '00000000-0000-0000-0000-000000000001' and is_project_admin=true
DO $$
BEGIN
  -- If legacy columns exist, copy them.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name IN ('is_project_admin','is_anonymous')
  ) THEN
    INSERT INTO system.administrators (id, email, password_hash, profile, email_verified)
    SELECT
      u.id,
      u.email,
      u.password,
      COALESCE(u.profile, '{}'::jsonb),
      COALESCE(u.email_verified, TRUE)
    FROM auth.users u
    WHERE u.is_project_admin = true
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- 3) Backfill system admin email/password not required for anon; we intentionally
-- do NOT create a system row for anon. Absence of auth is the anon notion.

-- 4) Delete legacy admin/anon rows from auth.users (transitional cleanup)
-- Keep data migrations safe: delete only if legacy flags columns exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name IN ('is_project_admin','is_anonymous')
  ) THEN
    -- Delete both admin and anon rows from auth.users
    DELETE FROM auth.users
    WHERE (is_project_admin = true) OR (is_anonymous = true);
  END IF;
END $$;

-- 5) Compatibility view for legacy code/policies.
-- Exposes a legacy-shaped recordset with is_project_admin/is_anonymous.
-- WARNING: Deprecated. Remove in next major.
CREATE OR REPLACE VIEW auth.users_compat AS
SELECT
  u.id,
  u.email,
  u.password,
  u.profile,
  u.email_verified,
  u.is_project_admin,
  u.is_anonymous,
  u.created_at,
  u.updated_at
FROM auth.users u

UNION ALL

SELECT
  a.id,
  a.email,
  a.password_hash AS password,
  a.profile,
  a.email_verified,
  true  AS is_project_admin,
  false AS is_anonymous,
  a.created_at,
  a.updated_at
FROM system.administrators a;

-- For anon, legacy behavior expects a special row. We provide an empty set for anon.
-- auth.uid() should be NULL for unauthenticated requests, so policies should not rely on anon rows.

-- 6) Preserve RLS/policies behavior during transition:
-- Grant read-only on the compat view to public as needed by existing code.
GRANT SELECT ON auth.users_compat TO PUBLIC;

