-- Migration: 044 - Create project admins table
--
-- Replaces the single env-backed admin credential (ADMIN_EMAIL / ADMIN_PASSWORD)
-- with a database-backed auth.project_admins table. The root admin is identified
-- by username matching the ROOT_ADMIN_USERNAME env var at runtime - no explicit
-- column needed. Non-root admins can change their own password only root can
-- create or delete other admins.

CREATE TABLE IF NOT EXISTS auth.project_admins (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  created_by     UUID        REFERENCES auth.project_admins(id) ON DELETE SET NULL,
  last_login_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_admins_username
  ON auth.project_admins (username);

DROP TRIGGER IF EXISTS update_project_admins_updated_at ON auth.project_admins;
CREATE TRIGGER update_project_admins_updated_at
  BEFORE UPDATE ON auth.project_admins
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();