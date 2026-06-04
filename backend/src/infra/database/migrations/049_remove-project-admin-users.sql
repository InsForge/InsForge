-- Migration: 049 - Remove project admin rows from auth.users
-- Project admins are env/cloud token sessions and are no longer stored as users.

DO $$
BEGIN
  IF to_regclass('auth.project_admins') IS NOT NULL THEN
    DROP TABLE auth.project_admins;
  END IF;

  IF to_regclass('auth.users') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name = 'users'
        AND column_name = 'is_project_admin'
    )
  THEN
    DELETE FROM auth.users WHERE is_project_admin = true;
    ALTER TABLE auth.users DROP COLUMN is_project_admin;
  END IF;
END $$;
