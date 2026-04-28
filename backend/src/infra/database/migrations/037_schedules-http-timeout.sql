-- Migration 036: Bound execute_job's HTTP timeout
--
-- Sets a per-call timeout (5min end-to-end, 5s connect) on the synchronous
-- http() invocation inside schedules.execute_job() so a hung downstream
-- target cannot pin a pg_cron worker indefinitely.
--
-- The 5-minute end-to-end ceiling gives long-running scheduled jobs (daily
-- reports, ETL, etc.) the headroom they need while still bounding the
-- worst case for the pg_cron worker pool. Sub-minute schedules pointed at
-- slow targets remain at risk of pool saturation; that's a target-design
-- problem, not a timeout problem.
--
-- The 5-second connect ceiling is unchanged from typical curl defaults and
-- catches DNS/SYN failures fast.
--
-- Idempotent: CREATE OR REPLACE FUNCTION.

CREATE OR REPLACE FUNCTION schedules.execute_job(p_job_id UUID)
RETURNS void AS $$
DECLARE
  v_job RECORD;
  v_http_request http_request;
  v_http_response http_response;
  v_success BOOLEAN;
  v_status INT;
  v_body TEXT;
  v_decrypted_headers JSONB;
  v_final_body JSONB;
  v_start_time TIMESTAMP := clock_timestamp();
  v_end_time TIMESTAMP;
  v_duration_ms BIGINT;
  v_error_message TEXT;
BEGIN
  -- Bound the per-call HTTP timeout. http_set_curlopt is per-session;
  -- pg_cron may reuse a session across ticks but the values are stable so
  -- repeated calls are harmless.
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

  BEGIN
    -- Decrypt headers
    v_decrypted_headers := schedules.decrypt_headers(v_job.encrypted_headers);

    -- Build the final request body
    v_final_body := COALESCE(v_job.body, '{}'::JSONB);

    -- Construct HTTP request
    v_http_request := (
      v_job.http_method::http_method,
      v_job.function_url,
      schedules.build_http_headers(v_decrypted_headers),
      'application/json',
      v_final_body::TEXT
    );
    v_start_time := clock_timestamp();
    -- Execute HTTP call (synchronous; bounded by curl timeouts set above)
    v_http_response := http(v_http_request);
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    v_status := v_http_response.status;
    v_body := v_http_response.content;
    v_success := v_status BETWEEN 200 AND 299;

    -- Log execution
    v_error_message := CASE WHEN v_success THEN 'Success' ELSE 'HTTP ' || v_status END;
    PERFORM schedules.log_job_execution(v_job.id, v_job.name, v_success, v_status, v_duration_ms, v_error_message);

  EXCEPTION WHEN OTHERS THEN
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    PERFORM schedules.log_job_execution(v_job.id, v_job.name, FALSE, 500, v_duration_ms, SQLERRM);
  END;
END;
$$ LANGUAGE plpgsql;
