-- Migration 063: Add outbound URL guards for scheduled HTTP jobs
--
-- The backend performs DNS-aware validation before creating or updating jobs.
-- This database-side guard provides defense in depth for direct SQL callers and
-- rejects unsafe literal destinations before pg_cron can persist them.

CREATE OR REPLACE FUNCTION schedules.is_safe_url(p_url TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_authority TEXT;
  v_host TEXT;
BEGIN
  IF p_url IS NULL OR p_url !~* '^https?://[^/?#]+([/?#].*)?$' THEN
    RETURN FALSE;
  END IF;

  -- Credentials in a scheduled URL would be exposed to database metadata and logs.
  v_authority := substring(p_url FROM '^https?://([^/?#]+)');
  IF v_authority ~ '@' THEN
    RETURN FALSE;
  END IF;

  v_host := lower(regexp_replace(v_authority, ':([0-9]+)$', ''));

  IF v_host IN ('localhost', 'localhost.') OR
     v_host ~ '(^|\.)localhost$' OR
     v_host ~ '^127\.' OR
     v_host ~ '^10\.' OR
     v_host ~ '^0\.' OR
     v_host ~ '^192\.168\.' OR
     v_host ~ '^169\.254\.' OR
     v_host ~ '^172\.(1[6-9]|2[0-9]|3[0-1])\.' OR
     v_host ~ '^224\.' OR
     v_host ~ '^255\.' OR
     v_host ~ '^\[::1\]$' OR
     v_host ~ '^\[fc' OR
     v_host ~ '^\[fd' OR
     v_host ~ '^\[fe80:' OR
     v_host ~ '^\[ff' THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION schedules.execute_job(p_job_id UUID)
RETURNS void AS $$
DECLARE
  v_job RECORD;
  v_http_request http_request;
  v_http_response http_response;
  v_success BOOLEAN;
  v_status INT;
  v_decrypted_headers JSONB;
  v_final_body JSONB;
  v_start_time TIMESTAMP := clock_timestamp();
  v_end_time TIMESTAMP;
  v_duration_ms BIGINT;
  v_error_message TEXT;
BEGIN
  PERFORM http_set_curlopt('CURLOPT_TIMEOUT_MS', '300000');
  PERFORM http_set_curlopt('CURLOPT_CONNECTTIMEOUT_MS', '5000');

  SELECT
    j.id,
    j.name,
    j.function_url,
    j.http_method,
    j.body,
    j.encrypted_headers
  INTO v_job
  FROM schedules.jobs AS j
  WHERE j.id = p_job_id;

  IF NOT FOUND THEN
    PERFORM schedules.log_job_execution(p_job_id, 'unknown', FALSE, 404, 0, 'Job not found');
    RETURN;
  END IF;

  IF NOT schedules.is_safe_url(v_job.function_url) THEN
    PERFORM schedules.log_job_execution(
      v_job.id,
      v_job.name,
      FALSE,
      400,
      0,
      'Scheduled URL rejected by outbound URL policy'
    );
    RETURN;
  END IF;

  BEGIN
    v_decrypted_headers := schedules.decrypt_headers(v_job.encrypted_headers);
    v_final_body := COALESCE(v_job.body, '{}'::JSONB);
    v_http_request := (
      v_job.http_method::http_method,
      v_job.function_url,
      schedules.build_http_headers(v_decrypted_headers),
      'application/json',
      v_final_body::TEXT
    );
    v_start_time := clock_timestamp();
    v_http_response := http(v_http_request);
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    v_status := v_http_response.status;
    v_success := v_status BETWEEN 200 AND 299;
    v_error_message := CASE WHEN v_success THEN 'Success' ELSE 'HTTP ' || v_status END;
    PERFORM schedules.log_job_execution(
      v_job.id,
      v_job.name,
      v_success,
      v_status,
      v_duration_ms,
      v_error_message
    );
  EXCEPTION WHEN OTHERS THEN
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    PERFORM schedules.log_job_execution(v_job.id, v_job.name, FALSE, 500, v_duration_ms, SQLERRM);
  END;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE schedules.jobs
  DROP CONSTRAINT IF EXISTS schedules_jobs_function_url_safe;

ALTER TABLE schedules.jobs
  ADD CONSTRAINT schedules_jobs_function_url_safe
  CHECK (schedules.is_safe_url(function_url)) NOT VALID;

DO $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT id, cron_job_id
    FROM schedules.jobs
    WHERE NOT schedules.is_safe_url(function_url)
  LOOP
    IF v_job.cron_job_id IS NOT NULL THEN
      PERFORM cron.unschedule(v_job.cron_job_id);
    END IF;
    UPDATE schedules.jobs
    SET is_active = FALSE,
        cron_job_id = NULL,
        updated_at = NOW()
    WHERE id = v_job.id;
  END LOOP;
END;
$$;
