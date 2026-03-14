-- Migration 024: Add configurable retention and scheduled cleanup for realtime messages
--
-- Adds:
-- 1. realtime.configs singleton table for retention settings
-- 2. realtime.cleanup_messages() for ordered batch pruning
-- 3. realtime.sync_message_cleanup_schedule() to keep pg_cron in sync with config

-- ============================================================================
-- CONFIG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS realtime.configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton BOOLEAN NOT NULL DEFAULT TRUE UNIQUE CHECK (singleton = TRUE),
  cleanup_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  message_retention_days INTEGER NOT NULL DEFAULT 30 CHECK (message_retention_days >= 1),
  cleanup_batch_size INTEGER NOT NULL DEFAULT 1000 CHECK (cleanup_batch_size >= 100),
  cleanup_schedule TEXT NOT NULL DEFAULT '*/15 * * * *',
  cron_job_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_realtime_configs_updated_at ON realtime.configs;
CREATE TRIGGER update_realtime_configs_updated_at
  BEFORE UPDATE ON realtime.configs
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

INSERT INTO realtime.configs (
  singleton,
  cleanup_enabled,
  message_retention_days,
  cleanup_batch_size,
  cleanup_schedule
)
VALUES (
  TRUE,
  TRUE,
  30,
  1000,
  '*/15 * * * *'
)
ON CONFLICT (singleton) DO NOTHING;

-- ============================================================================
-- CLEANUP FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION realtime.cleanup_messages(p_batch_size INTEGER DEFAULT NULL)
RETURNS INTEGER AS $$
DECLARE
  v_cleanup_enabled BOOLEAN;
  v_retention_days INTEGER;
  v_effective_batch_size INTEGER;
  v_deleted_count INTEGER := 0;
BEGIN
  SELECT
    cleanup_enabled,
    message_retention_days,
    cleanup_batch_size
  INTO
    v_cleanup_enabled,
    v_retention_days,
    v_effective_batch_size
  FROM realtime.configs
  WHERE singleton = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_cleanup_enabled IS FALSE THEN
    RETURN 0;
  END IF;

  v_effective_batch_size := COALESCE(p_batch_size, v_effective_batch_size, 1000);

  WITH candidates AS (
    SELECT id
    FROM realtime.messages
    WHERE created_at < NOW() - make_interval(days => v_retention_days)
    ORDER BY created_at ASC, id ASC
    LIMIT v_effective_batch_size
  )
  DELETE FROM realtime.messages AS messages
  USING candidates
  WHERE messages.id = candidates.id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- SCHEDULE SYNC FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION realtime.sync_message_cleanup_schedule()
RETURNS BIGINT AS $$
DECLARE
  v_config RECORD;
  v_existing_job RECORD;
  v_new_job_id BIGINT;
BEGIN
  SELECT
    cleanup_enabled,
    cleanup_schedule
  INTO v_config
  FROM realtime.configs
  WHERE singleton = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOR v_existing_job IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'insforge_realtime_message_cleanup'
  LOOP
    PERFORM cron.unschedule(v_existing_job.jobid);
  END LOOP;

  UPDATE realtime.configs
  SET cron_job_id = NULL
  WHERE singleton = TRUE;

  IF v_config.cleanup_enabled IS FALSE THEN
    RETURN NULL;
  END IF;

  SELECT cron.schedule(
    'insforge_realtime_message_cleanup',
    v_config.cleanup_schedule,
    'SELECT realtime.cleanup_messages();'
  ) INTO v_new_job_id;

  UPDATE realtime.configs
  SET cron_job_id = v_new_job_id
  WHERE singleton = TRUE;

  RETURN v_new_job_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

SELECT realtime.sync_message_cleanup_schedule();
