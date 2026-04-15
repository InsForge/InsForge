-- Migration: 031 - Track direct-upload deployment files

CREATE TABLE IF NOT EXISTS system.deployment_files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deployment_id UUID NOT NULL REFERENCES system.deployments(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  sha TEXT NOT NULL CHECK (sha ~ '^[a-f0-9]{40}$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (deployment_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_deployment_files_deployment_id
  ON system.deployment_files(deployment_id);

CREATE INDEX IF NOT EXISTS idx_deployment_files_uploaded_at
  ON system.deployment_files(deployment_id, uploaded_at);

DROP TRIGGER IF EXISTS update_system_deployment_files_updated_at ON system.deployment_files;
CREATE TRIGGER update_system_deployment_files_updated_at BEFORE UPDATE ON system.deployment_files
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
