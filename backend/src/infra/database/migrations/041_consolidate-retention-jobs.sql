-- Migration 041: Consolidate retention jobs
--
-- Keep retention settings and cleanup functions in their feature schemas while
-- normalizing the underlying pg_cron jobs.
--
-- Dependencies:
--   - migration 021 (pg_cron + schedules schema)
--   - migration 024 (realtime message retention function/config)

-- ============================================================================
-- SCHEDULES CONFIGURATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS schedules.config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retention_days INTEGER DEFAULT 7 CHECK (retention_days IS NULL OR retention_days > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_config_singleton ON schedules.config ((1));

DROP TRIGGER IF EXISTS update_schedules_config_updated_at ON schedules.config;
CREATE TRIGGER update_schedules_config_updated_at
  BEFORE UPDATE ON schedules.config
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- ============================================================================
-- SCHEDULES CLEANUP FUNCTION
-- ============================================================================
-- Default retention is 7 days unless configured.
-- Deletes in batches to prevent performance impact.

CREATE OR REPLACE FUNCTION schedules.cleanup_job_logs(p_batch_size INT DEFAULT 1000)
RETURNS INT AS $$
DECLARE
  v_retention_days INT;
  v_cutoff TIMESTAMPTZ;
  v_deleted_count INT := 0;
  v_total_deleted INT := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE WARNING 'schedules.cleanup_job_logs received invalid batch size: %', p_batch_size;
    RETURN 0;
  END IF;

  SELECT retention_days INTO v_retention_days
  FROM schedules.config LIMIT 1;
  
  IF v_retention_days IS NULL OR v_retention_days <= 0 THEN
    RETURN 0;
  END IF;
  
  v_cutoff := NOW() - (v_retention_days || ' days')::INTERVAL;
  
  LOOP
    WITH deleted AS (
      DELETE FROM schedules.job_logs
      WHERE id IN (
        SELECT id FROM schedules.job_logs
        WHERE executed_at < v_cutoff
        ORDER BY executed_at ASC
        LIMIT p_batch_size
      )
      RETURNING id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;
    
    v_total_deleted := v_total_deleted + v_deleted_count;
    
    EXIT WHEN v_deleted_count < p_batch_size;
  END LOOP;
  
  RETURN v_total_deleted;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedules.cleanup_job_logs failed: %', SQLERRM;
  RETURN v_total_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public, only superuser/backend can call this
REVOKE ALL ON FUNCTION schedules.cleanup_job_logs FROM PUBLIC;

-- ============================================================================
-- SEED CONFIGURATION
-- ============================================================================

INSERT INTO schedules.config (retention_days)
SELECT 7
WHERE NOT EXISTS (SELECT 1 FROM schedules.config);

-- ============================================================================
-- REALTIME MESSAGE RETENTION JOB
-- ============================================================================
-- Replace any legacy realtime retention job with a named pg_cron entry.

DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  FOR v_existing_job_id IN
    SELECT DISTINCT existing_jobs.jobid
    FROM (
      SELECT jobid
      FROM cron.job
      WHERE command = 'SELECT realtime.cleanup_messages()'
         OR jobname = 'realtime-message-retention'
    ) AS existing_jobs
  LOOP
    PERFORM cron.unschedule(v_existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'realtime-message-retention',
    '0 0 * * *',
    'SELECT realtime.cleanup_messages()'
  );
END $$;

-- ============================================================================
-- SCHEDULES JOB LOG RETENTION JOB
-- ============================================================================
-- Replace any legacy schedules retention job with a named pg_cron entry.

DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  FOR v_existing_job_id IN
    SELECT DISTINCT existing_jobs.jobid
    FROM (
      SELECT jobid
      FROM cron.job
      WHERE command = 'SELECT schedules.cleanup_job_logs()'
         OR jobname = 'schedules-job-logs-retention'
    ) AS existing_jobs
  LOOP
    PERFORM cron.unschedule(v_existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'schedules-job-logs-retention',
    '0 * * * *',
    'SELECT schedules.cleanup_job_logs()'
  );
END $$;
