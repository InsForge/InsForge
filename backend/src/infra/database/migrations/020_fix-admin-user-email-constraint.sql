-- migrate:up
-- Migration: 020 - Fix admin and regular user email conflict
--
-- This migration changes the UNIQUE constraint from just email to (email, is_project_admin)
-- allowing admin users and regular users to share the same email address.
--
-- Problem: Admin users are managers of apps, not users within apps.
-- When admin email is set, we can't have a user with the same email due to the UNIQUE constraint.
--
-- Solution: Use composite UNIQUE constraint on (email, is_project_admin) tuple.

-- 1. Drop the existing UNIQUE constraint on email
-- The constraint was created implicitly in migration 000 with "email TEXT UNIQUE NOT NULL"
-- We need to find and drop only the single-column email constraint
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  SELECT tc.constraint_name INTO constraint_name_var
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'auth'
    AND tc.table_name = 'users'
    AND tc.constraint_type = 'UNIQUE'
  GROUP BY tc.constraint_name
  HAVING SUM(CASE WHEN kcu.column_name = 'email' THEN 1 ELSE 0 END) = 1
     AND COUNT(*) = 1;

  IF constraint_name_var IS NOT NULL THEN
    EXECUTE format('ALTER TABLE auth.users DROP CONSTRAINT %I', constraint_name_var);
    RAISE NOTICE 'Dropped UNIQUE constraint % on auth.users.email', constraint_name_var;
  ELSE
    RAISE NOTICE 'No single-column UNIQUE constraint found on auth.users.email';
  END IF;
END $$;

-- 2. Pre-flight check for duplicate (email, is_project_admin) pairs
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM auth.users
    GROUP BY email, is_project_admin
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate (email, is_project_admin) pairs exist. Resolve before migration.';
  END IF;
END $$;

-- 3. Add new composite UNIQUE constraint on (email, is_project_admin)
-- This allows the same email to exist twice:
--   - Once with is_project_admin = true (admin/manager)
--   - Once with is_project_admin = false (regular user)
ALTER TABLE auth.users
  ADD CONSTRAINT users_email_is_project_admin_key
  UNIQUE (email, is_project_admin);

-- migrate:down
-- Rollback to single-column uniqueness on email
ALTER TABLE auth.users
  DROP CONSTRAINT IF EXISTS users_email_is_project_admin_key;

-- Pre-flight check: ensure no duplicate emails exist before restoring single-column constraint
DO $$
BEGIN
  IF EXISTS (
    SELECT email
    FROM auth.users
    GROUP BY email
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot downgrade: Multiple users share the same email address. Remove duplicate emails before downgrading.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'auth'
      AND tc.table_name = 'users'
      AND tc.constraint_type = 'UNIQUE'
    GROUP BY tc.constraint_name
    HAVING SUM(CASE WHEN kcu.column_name = 'email' THEN 1 ELSE 0 END) = 1
       AND COUNT(*) = 1
  ) THEN
    EXECUTE 'ALTER TABLE auth.users ADD UNIQUE (email)';
    RAISE NOTICE 'Restored single-column UNIQUE constraint on auth.users.email';
  END IF;
END $$;
