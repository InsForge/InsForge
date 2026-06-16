-- UP migration
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.project_admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    last_login_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    is_root BOOLEAN DEFAULT FALSE
);

-- Indexes for better performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_admins_username_active ON auth.project_admins(username) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_project_admins_deleted_at ON auth.project_admins(deleted_at);

-- Trigger to update updated_at automatically
DROP TRIGGER IF EXISTS update_project_admins_updated_at ON auth.project_admins;
CREATE TRIGGER update_project_admins_updated_at
BEFORE UPDATE ON auth.project_admins
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Grant permissions to project_admin role if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'project_admin') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.project_admins TO project_admin;
  END IF;
END $$;

-- DOWN migration
DROP TABLE IF EXISTS auth.project_admins;