-- Migration: 047 - Add orphan cleanup for functions.deployments
--
-- functions.deployments has no FK to functions.definitions. When a function
-- is deleted, its deployment records remain orphaned permanently. This adds
-- a batched cleanup function and a pg_cron job that runs it daily at 3 AM.

CREATE INDEX IF NOT EXISTS idx_functions_deployments_status_created
  ON functions.deployments(status, created_at);

CREATE OR REPLACE FUNCTION functions.cleanup_orphan_deployments(
  p_batch_size INT DEFAULT 1000,
  p_max_age_days INT DEFAULT NULL
)
RETURNS INT AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
  v_deleted_count INT := 0;
  v_total_deleted INT := 0;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE WARNING 'functions.cleanup_orphan_deployments received invalid batch size: %', p_batch_size;
    RETURN 0;
  END IF;

  IF p_max_age_days IS NOT NULL AND p_max_age_days > 0 THEN
    v_cutoff := NOW() - (p_max_age_days || ' days')::INTERVAL;
  END IF;

  LOOP
    WITH candidate_deployments AS (
      SELECT d.id
      FROM functions.deployments d
      WHERE (v_cutoff IS NULL OR d.created_at < v_cutoff)
        AND jsonb_array_length(d.functions) > 0
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(d.functions) AS slug
          WHERE EXISTS (
            SELECT 1 FROM functions.definitions fd
            WHERE fd.slug = slug
          )
        )
      ORDER BY d.created_at ASC
      LIMIT p_batch_size
      FOR UPDATE OF d SKIP LOCKED
    ),
    deleted AS (
      DELETE FROM functions.deployments d
      WHERE d.id IN (SELECT id FROM candidate_deployments)
      RETURNING d.id
    )
    SELECT COUNT(*) INTO v_deleted_count FROM deleted;

    v_total_deleted := v_total_deleted + v_deleted_count;

    EXIT WHEN v_deleted_count < p_batch_size;
  END LOOP;

  RETURN v_total_deleted;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'functions.cleanup_orphan_deployments failed: %', SQLERRM;
  RETURN v_total_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION functions.cleanup_orphan_deployments FROM PUBLIC;

-- Schedule daily at 3 AM (staggered from realtime cleanup at midnight)
DO $$
DECLARE
  v_existing_job_id BIGINT;
BEGIN
  FOR v_existing_job_id IN
    SELECT DISTINCT existing_jobs.jobid
    FROM (
      SELECT jobid
      FROM cron.job
      WHERE command = 'SELECT functions.cleanup_orphan_deployments()'
         OR jobname = 'functions-deployment-cleanup'
    ) AS existing_jobs
  LOOP
    PERFORM cron.unschedule(v_existing_job_id);
  END LOOP;

  PERFORM cron.schedule(
    'functions-deployment-cleanup',
    '0 3 * * *',
    'SELECT functions.cleanup_orphan_deployments()'
  );
END $$;
