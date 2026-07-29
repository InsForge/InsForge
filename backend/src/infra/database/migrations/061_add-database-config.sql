-- Migration 061: Database config (scheduled backups)
--
-- Singleton per-database configuration table. Backup scheduling is the first
-- tenant (backup_* columns); future database-level settings belong here too
-- rather than in new one-off tables.
--
-- The Node backend polls this config, runs pg_dump on the configured cron
-- cadence (evaluated in UTC), and persists artifacts through the storage
-- provider exactly like manual backups. Retention applies to scheduled
-- backups only; manual backups are never auto-deleted.
--
-- Dependencies:
--   - migration 051 (system.database_backups)
--   - migration 054 (default SELECT privileges in schema system cover new tables)

CREATE TABLE IF NOT EXISTS system.database_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  backup_cron_schedule TEXT NOT NULL DEFAULT '0 0 * * *',
  backup_retention_days INTEGER DEFAULT 7 CHECK (backup_retention_days IS NULL OR backup_retention_days > 0),
  -- Due-ness anchor: moves only when backup_enabled or backup_cron_schedule
  -- change, so unrelated config edits (e.g. retention) can never swallow a
  -- cron fire that has not been attempted yet. updated_at moves on every
  -- write (trigger below), which would.
  backup_schedule_anchor TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent upgrade for databases that ran an earlier revision of this
-- migration before backup_schedule_anchor existed (CREATE TABLE IF NOT EXISTS
-- is a no-op for them).
ALTER TABLE system.database_config
  ADD COLUMN IF NOT EXISTS backup_schedule_anchor TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Ensure only one row exists (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_database_config_singleton
  ON system.database_config ((1));

DROP TRIGGER IF EXISTS update_database_config_updated_at ON system.database_config;
CREATE TRIGGER update_database_config_updated_at
  BEFORE UPDATE ON system.database_config
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Seed: backups disabled until the operator opts in; daily at midnight UTC
-- with 7-day retention once enabled.
INSERT INTO system.database_config (backup_enabled)
SELECT FALSE
WHERE NOT EXISTS (SELECT 1 FROM system.database_config);

-- The scheduler's due-ness check reads MAX(created_at) of scheduled backups.
CREATE INDEX IF NOT EXISTS idx_database_backups_trigger_source_created_at
  ON system.database_backups (trigger_source, created_at DESC);
