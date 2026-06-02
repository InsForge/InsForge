-- Migration: 049 - Move platform admin and anon identities out of auth.users
-- Transitional compatibility (strategy 2): introduce system.administrators and
-- provide a compatibility view auth.users_compat that mimics legacy flags.

-- Ensure system schema exists (some fresh installs may not have it yet)
CREATE SCHEMA IF NOT EXISTS system;

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
-- We only run the backfill if BOTH legacy columns exist (avoid partial-column runtime errors)
DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name IN ('is_project_admin','is_anonymous')
  ) = 2 THEN
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
-- Only delete if BOTH legacy columns exist to avoid partial-schema runtime errors.
DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name IN ('is_project_admin','is_anonymous')
  ) = 2 THEN
    -- Legacy FK-safe approach:
    -- Avoid deleting legacy admin/anon UUIDs (they may be referenced by other rows).
    -- Instead, clear the legacy flags so auth.uid()-based / auth.users-based logic
    -- cannot treat them as user-like principals anymore.
    UPDATE auth.users
    SET is_project_admin = false,
        is_anonymous = false
    WHERE (is_project_admin = true) OR (is_anonymous = true);
  END IF;
END $$;

-- 5) Compatibility view for legacy code/policies.
-- Exposes a legacy-shaped recordset with is_project_admin/is_anonymous.
-- WARNING: Deprecated. Remove in next major.
--
-- Important: this view must be created even on fresh installs where legacy columns
-- may not exist. We therefore add missing legacy columns with safe defaults
-- BEFORE creating the view.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_project_admin'
  ) THEN
    ALTER TABLE auth.users ADD COLUMN is_project_admin BOOLEAN NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_anonymous'
  ) THEN
    ALTER TABLE auth.users ADD COLUMN is_anonymous BOOLEAN NOT NULL DEFAULT false;
  END IF;
END $$;

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
GRANT SELECT ON auth.users_compat TO PUBLIC;

