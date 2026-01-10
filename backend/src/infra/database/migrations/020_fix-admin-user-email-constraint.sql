-- Migration: 020 - Fix admin and regular user email conflict

-- This migration changes the UNIQUE constraint from just email to (email, is_project_admin)
-- allowing admin users and regular users to share the same email address.
--
-- Problem: Admin users are managers of apps, not users within apps.
-- When admin email is set, we can't have a user with the same email due to the UNIQUE constraint.
--
-- Solution: Use composite UNIQUE constraint on (email, is_project_admin) tuple.

-- 1. Drop the existing UNIQUE constraint on email
-- The constraint was created implicitly in migration 000 with "email TEXT UNIQUE NOT NULL"
-- We need to find and drop it by querying the constraint name
DO $$
DECLARE
  constraint_name_var TEXT;
BEGIN
  -- Find the constraint name for the UNIQUE constraint on auth.users.email
  SELECT tc.constraint_name INTO constraint_name_var
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.table_schema
  WHERE tc.table_schema = 'auth'
    AND tc.table_name = 'users'
    AND tc.constraint_type = 'UNIQUE'
    AND ccu.column_name = 'email';

  -- Drop the constraint if found
  IF constraint_name_var IS NOT NULL THEN
    EXECUTE format('ALTER TABLE auth.users DROP CONSTRAINT %I', constraint_name_var);
    RAISE NOTICE 'Dropped UNIQUE constraint % on auth.users.email', constraint_name_var;
  ELSE
    RAISE NOTICE 'No UNIQUE constraint found on auth.users.email';
  END IF;
END $$;

-- 2. Add new composite UNIQUE constraint on (email, is_project_admin)
-- This allows the same email to exist twice:
--   - Once with is_project_admin = true (admin/manager)
--   - Once with is_project_admin = false (regular user)
ALTER TABLE auth.users
ADD CONSTRAINT users_email_is_project_admin_key
UNIQUE (email, is_project_admin);

-- Note: This constraint ensures:
-- - An admin (is_project_admin=true) can have email "admin@example.com"
-- - A regular user (is_project_admin=false) can have email "admin@example.com"
-- - But you can't have TWO admins with the same email
-- - And you can't have TWO regular users with the same email
