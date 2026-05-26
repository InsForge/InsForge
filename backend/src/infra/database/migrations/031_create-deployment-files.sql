-- Migration: 031 - Move deployment tables into a dedicated schema and track direct-upload files

CREATE SCHEMA IF NOT EXISTS deployments;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'system' AND table_name = 'deployments'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'deployments' AND table_name = 'deployments'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'deployments' AND table_name = 'runs'
  ) THEN
    ALTER TABLE system.deployments SET SCHEMA deployments;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'deployments' AND table_name = 'deployments'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'deployments' AND table_name = 'runs'
  ) THEN
    ALTER TABLE deployments.deployments RENAME TO runs;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments.runs(status);
CREATE INDEX IF NOT EXISTS idx_deployments_provider ON deployments.runs(provider);
CREATE INDEX IF NOT EXISTS idx_deployments_created_at ON deployments.runs(created_at DESC);

DROP TRIGGER IF EXISTS update_system_deployments_updated_at ON deployments.runs;
DROP TRIGGER IF EXISTS update_deployments_updated_at ON deployments.runs;
DROP TRIGGER IF EXISTS update_runs_updated_at ON deployments.runs;
CREATE TRIGGER update_runs_updated_at BEFORE UPDATE ON deployments.runs
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE TABLE IF NOT EXISTS deployments.files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  deployment_id UUID NOT NULL REFERENCES deployments.runs(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  sha TEXT NOT NULL CHECK (sha ~ '^[a-f0-9]{40}$'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  uploaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (deployment_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_deployment_files_deployment_id
  ON deployments.files(deployment_id);

CREATE INDEX IF NOT EXISTS idx_deployment_files_uploaded_at
  ON deployments.files(deployment_id, uploaded_at);

DROP TRIGGER IF EXISTS update_system_deployment_files_updated_at ON deployments.files;
DROP TRIGGER IF EXISTS update_deployment_files_updated_at ON deployments.files;
DROP TRIGGER IF EXISTS update_files_updated_at ON deployments.files;
CREATE TRIGGER update_files_updated_at BEFORE UPDATE ON deployments.files
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
