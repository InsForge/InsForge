-- Migration 041: Add retention policy for schedules.job_logs
--
-- schedules.job_logs grows unbounded — every schedule fire inserts a row and
-- nothing ever deletes them.  A 2-second schedule accumulates ~15.8 M rows
-- (~3.3 GB) per year.  This migration adds a pg_cron job that runs hourly to
-- delete rows older than 7 days.
--
-- The retention interval (7 days) is long enough for ops to debug failures but
-- short enough to bound the table.  Could be made configurable later.
--
-- Dependencies: pg_cron (already enabled in migration 021)

-- ============================================================================
-- RETENTION CRON JOB
-- ============================================================================

-- Remove any previously-scheduled job with the same name (idempotent re-run).
-- cron.unschedule is a no-op when the job doesn't exist, but we guard with an
-- explicit check so the migration is safe even if the cron job name changes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'schedules-job-logs-retention') THEN
    PERFORM cron.unschedule(
      (SELECT jobid FROM cron.job WHERE jobname = 'schedules-job-logs-retention')
    );
  END IF;
END;
$$;

SELECT cron.schedule(
  'schedules-job-logs-retention',
  '0 * * * *',  -- hourly at minute 0
  $$DELETE FROM schedules.job_logs WHERE executed_at < now() - interval '7 days'$$
);
