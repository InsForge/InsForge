-- Migration: 049 - Remove project admin rows from auth.users
-- Project admins are env/cloud token sessions and are no longer stored as users.

DO $$
DECLARE
  has_is_project_admin BOOLEAN;
  has_is_anonymous BOOLEAN;
BEGIN
  IF to_regclass('auth.project_admins') IS NOT NULL THEN
    DROP TABLE auth.project_admins;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'auth'
      AND table_name = 'users'
      AND column_name = 'is_project_admin'
  ) INTO has_is_project_admin;

  IF NOT has_is_project_admin THEN
    RETURN;
  END IF;

  BEGIN
    DELETE FROM auth.users WHERE is_project_admin = true;
  EXCEPTION WHEN foreign_key_violation THEN
    -- User-defined tables may have restrictive foreign keys to auth.users(id).
    -- Keep those references valid, but make legacy project-admin rows unusable
    -- as regular authenticated users before dropping the marker column.
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'auth'
        AND table_name = 'users'
        AND column_name = 'is_anonymous'
    ) INTO has_is_anonymous;

    IF has_is_anonymous THEN
      UPDATE auth.users
      SET email = 'deleted-project-admin-' || id::text || '@insforge.local',
          password = NULL,
          email_verified = false,
          is_anonymous = true,
          updated_at = NOW()
      WHERE is_project_admin = true;
    ELSE
      UPDATE auth.users
      SET email = 'deleted-project-admin-' || id::text || '@insforge.local',
          password = NULL,
          email_verified = false,
          updated_at = NOW()
      WHERE is_project_admin = true;
    END IF;

    RAISE WARNING 'Legacy project admin rows were referenced by foreign keys, so they were disabled instead of deleted.';
  END;

  ALTER TABLE auth.users DROP COLUMN is_project_admin;
END $$;
