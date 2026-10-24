-- Migration 067: Retention for cron.job_run_details
--
-- pg_cron writes one row to cron.job_run_details for every job run
-- (cron.log_run = on) and never deletes them. Projects with per-minute
-- schedules pile up hundreds of thousands of rows (one project had 241k rows /
-- 50 MB, twice its app data). schedules.job_logs already has retention (041);
-- this applies the same retention window, schedules.config.retention_days
-- (default 7 days), to cron.job_run_details.
--
-- The cleanup deletes in batches of p_batch_size rows and stops after
-- p_max_batches batches, so the first run on a large backlog doesn't delete
-- everything in one long transaction on a small instance. The job runs hourly,
-- so a large backlog drains over a few runs and then stays small.
--
-- The job is named 'cron-job-run-details-retention'. Some instances already
-- have a manually created job with that name; it is unscheduled and replaced,
-- so there is never more than one.
--
-- Dependencies:
--   - migration 021 (pg_cron + schedules schema)
--   - migration 041 (schedules.config.retention_days)

-- ============================================================================
-- CLEANUP FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.cleanup_cron_job_run_details(
  p_batch_size INT DEFAULT 1000,
  p_max_batches INT DEFAULT 100
)
RETURNS INT AS $$
DECLARE
  v_retention_days INT;
  v_cutoff TIMESTAMPTZ;
  v_last_runid BIGINT := 0;
  v_batch_max_runid BIGINT;
  v_deleted_count INT := 0;
  v_total_deleted INT := 0;
  v_batches INT := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0
     OR p_max_batches IS NULL OR p_max_batches <= 0 THEN
    RAISE WARNING 'schedules.cleanup_cron_job_run_details received invalid arguments: batch_size=%, max_batches=%',
      p_batch_size, p_max_batches;
    RETURN 0;
  END IF;

  IF to_regclass('cron.job_run_details') IS NULL THEN
    RETURN 0;
  END IF;

  SELECT retention_days INTO v_retention_days
  FROM schedules.config LIMIT 1;

  IF v_retention_days IS NULL OR v_retention_days <= 0 THEN
    RETURN 0;
  END IF;

  v_cutoff := NOW() - (v_retention_days || ' days')::INTERVAL;

  -- Walk the runid primary key upwards so each batch starts where the last
  -- one stopped instead of rescanning the rows already deleted. Rows still
  -- running (end_time IS NULL) are never deleted.
  LOOP
    WITH deleted AS (
      DELETE FROM cron.job_run_details
      WHERE runid IN (
        SELECT runid FROM cron.job_run_details
        WHERE runid > v_last_runid
          AND end_time < v_cutoff
        ORDER BY runid ASC
        LIMIT p_batch_size
      )
      RETURNING runid
    )
    SELECT COUNT(*), MAX(runid) INTO v_deleted_count, v_batch_max_runid FROM deleted;

    v_total_deleted := v_total_deleted + v_deleted_count;
    v_batches := v_batches + 1;

    EXIT WHEN v_deleted_count < p_batch_size OR v_batches >= p_max_batches;

    v_last_runid := v_batch_max_runid;
  END LOOP;

  RETURN v_total_deleted;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedules.cleanup_cron_job_run_details failed: %', SQLERRM;
  RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp;

-- Revoke execute from public, only superuser/backend can call this
REVOKE ALL ON FUNCTION schedules.cleanup_cron_job_run_details(INT, INT) FROM PUBLIC;

-- ============================================================================
-- RETENTION JOB
-- ============================================================================
-- Replace any existing job with this name (including manually created ones)
-- or with this command, then schedule it hourly at minute 30 so it doesn't
-- run at the same time as schedules-job-logs-retention (minute 0).

DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  FOR v_existing_job_id IN
    SELECT DISTINCT existing_jobs.jobid
    FROM (
      SELECT jobid
      FROM cron.job
      WHERE command = 'SELECT schedules.cleanup_cron_job_run_details()'
         OR jobname = 'cron-job-run-details-retention'
    ) AS existing_jobs
  LOOP
    PERFORM cron.unschedule(v_existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'cron-job-run-details-retention',
    '30 * * * *',
    'SELECT schedules.cleanup_cron_job_run_details()'
  );
END $$;
