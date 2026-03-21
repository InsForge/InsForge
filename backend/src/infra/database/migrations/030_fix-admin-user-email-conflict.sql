-- Migration: 024 - Fix admin user email conflict with regular users
-- Issue: #668 - Admin user will conflict with regular user if using same email
--
-- Problem: The auth.users table has a simple UNIQUE constraint on email.
-- When the admin email is set, a regular app user cannot register with the
-- same email because they share the same uniqueness namespace.
--
-- Solution: Replace the single UNIQUE(email) constraint with partial unique
-- indexes scoped by user type. This allows an admin and a regular user to
-- share the same email without conflict, while still preventing duplicate
-- emails within each user type.

-- Step 1: Find and drop the existing unique constraint on email
-- The constraint name may vary depending on how it was created, so we
-- dynamically look it up.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  -- Find the unique constraint on the email column
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
    AND tc.table_schema = ccu.table_schema
  WHERE tc.table_schema = 'auth'
    AND tc.table_name = 'users'
    AND tc.constraint_type = 'UNIQUE'
    AND ccu.column_name = 'email';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE auth.users DROP CONSTRAINT %I', constraint_name);
    RAISE NOTICE 'Dropped unique constraint: %', constraint_name;
  END IF;
END $$;

-- Also drop any standalone unique index on email (in case it was created as an index, not a constraint)
DROP INDEX IF EXISTS auth.users_email_key;
DROP INDEX IF EXISTS auth._accounts_email_key;

-- Step 2: Create partial unique indexes scoped by user type

-- Regular users: email must be unique among non-admin, non-anonymous users
CREATE UNIQUE INDEX IF NOT EXISTS users_email_regular_unique
  ON auth.users (email)
  WHERE is_project_admin = false AND is_anonymous = false;

-- Admin users: email must be unique among admin users
CREATE UNIQUE INDEX IF NOT EXISTS users_email_admin_unique
  ON auth.users (email)
  WHERE is_project_admin = true;

-- Anonymous users: email must be unique among anonymous users
CREATE UNIQUE INDEX IF NOT EXISTS users_email_anon_unique
  ON auth.users (email)
  WHERE is_anonymous = true;
