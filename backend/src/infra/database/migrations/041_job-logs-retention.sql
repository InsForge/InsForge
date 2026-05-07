-- Migration 041: Add retention policy for schedules.job_logs
--
-- schedules.job_logs grows unbounded — every schedule fire inserts a row and
-- nothing ever deletes them.  A 2-second schedule accumulates ~15.8 M rows
-- (~3.3 GB) per year.  This migration adds a pg_cron job that runs hourly to
-- delete rows older than the configured retention period.
--
-- The retention interval is configurable through the dashboard via schedules.config.
-- Default is 7 days if not configured.
--
-- Dependencies: pg_cron (already enabled in migration 021)

-- ============================================================================
-- CONFIGURATION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS schedules.config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retention_days INTEGER DEFAULT 7 CHECK (retention_days IS NULL OR retention_days > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one row exists (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_schedules_config_singleton ON schedules.config ((1));

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_schedules_config_updated_at ON schedules.config;
CREATE TRIGGER update_schedules_config_updated_at
  BEFORE UPDATE ON schedules.config
  FOR EACH ROW
  EXECUTE FUNCTION system.update_updated_at();

-- ============================================================================
-- CLEANUP FUNCTION
-- ============================================================================
-- Deletes job_logs older than the configured retention period.
-- Default retention is 7 days if not set in schedules.config.

CREATE OR REPLACE FUNCTION schedules.cleanup_job_logs(p_batch_size INT DEFAULT 1000)
RETURNS INT AS $$
DECLARE
  v_retention_days INT;
  v_cutoff TIMESTAMPTZ;
  v_deleted_count INT := 0;
  v_total_deleted INT := 0;
BEGIN
  -- Get retention days from schedules.config
  SELECT retention_days INTO v_retention_days
  FROM schedules.config LIMIT 1;
  
  -- Handle "Never" (e.g. NULL or < 0)
  IF v_retention_days IS NULL OR v_retention_days < 0 THEN
    RETURN 0;
  END IF;
  
  -- Calculate cutoff time
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
    
    -- Exit loop if no rows deleted or batch not full
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
-- Insert default retention period (7 days)

INSERT INTO schedules.config (retention_days)
SELECT 7
WHERE NOT EXISTS (SELECT 1 FROM schedules.config);

-- ============================================================================
-- SCHEDULE CLEANUP
-- ============================================================================
-- Schedule the cleanup function to run hourly using pg_cron.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'schedules-job-logs-retention') THEN
    PERFORM cron.schedule(
      'schedules-job-logs-retention',
      '0 * * * *',  -- hourly at minute 0
      'SELECT schedules.cleanup_job_logs()'
    );
  END IF;
END $$;
