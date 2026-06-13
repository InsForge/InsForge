-- Database Backups: metadata for self-hosted pg_dump backups.
-- Backup archives are persisted through the storage provider (local STORAGE_DIR
-- or S3 when AWS_S3_BUCKET is configured); this table only tracks metadata.

CREATE TABLE IF NOT EXISTS system.database_backups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT,
  trigger_source  TEXT NOT NULL DEFAULT 'manual'
                  CHECK (trigger_source IN ('manual', 'scheduled')),
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed')),
  storage_key     TEXT,
  size_bytes      BIGINT,
  error_message   TEXT,
  created_by      TEXT,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_database_backups_name
  ON system.database_backups(name)
  WHERE name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_database_backups_status ON system.database_backups(status);

DROP TRIGGER IF EXISTS update_database_backups_updated_at ON system.database_backups;
CREATE TRIGGER update_database_backups_updated_at
  BEFORE UPDATE ON system.database_backups
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
