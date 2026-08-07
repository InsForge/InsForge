-- Migration 064: Add outbound URL guards for scheduled HTTP jobs
--
-- The backend performs DNS-aware validation before creating or updating jobs.
-- This database-side guard provides defense in depth for direct SQL callers and
-- rejects unsafe literal destinations before pg_cron can persist them.

ALTER TABLE schedules.jobs
  ADD COLUMN IF NOT EXISTS resolved_target JSONB;

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
  v_authority := substring(lower(p_url) FROM '^https?://([^/?#]+)');
  IF v_authority ~ '@' THEN
    RETURN FALSE;
  END IF;

  IF left(v_authority, 1) = '[' THEN
    v_host := lower(split_part(v_authority, ']', 1) || ']');
  ELSE
    v_host := lower(regexp_replace(v_authority, ':([0-9]+)$', ''));
  END IF;

  IF v_host ~ '^[0-9]+$' OR
     v_host ~ '^0x[0-9a-f]+$' OR
     v_host ~ '^0[0-7]+$' THEN
    RETURN FALSE;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION schedules.is_safe_address(p_address TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_ip INET;
BEGIN
  IF p_address IS NULL OR p_address ~ '^[0-9]+$' THEN
    RETURN FALSE;
  END IF;

  BEGIN
    v_ip := p_address::INET;
  EXCEPTION WHEN OTHERS THEN
    RETURN FALSE;
  END;

  RETURN NOT (
    v_ip <<= '0.0.0.0/8'::CIDR OR
    v_ip <<= '10.0.0.0/8'::CIDR OR
    v_ip <<= '100.64.0.0/10'::CIDR OR
    v_ip <<= '127.0.0.0/8'::CIDR OR
    v_ip <<= '169.254.0.0/16'::CIDR OR
    v_ip <<= '172.16.0.0/12'::CIDR OR
    v_ip <<= '192.0.0.0/24'::CIDR OR
    v_ip <<= '192.0.2.0/24'::CIDR OR
    v_ip <<= '192.88.99.0/24'::CIDR OR
    v_ip <<= '192.168.0.0/16'::CIDR OR
    v_ip <<= '198.18.0.0/15'::CIDR OR
    v_ip <<= '198.51.100.0/24'::CIDR OR
    v_ip <<= '203.0.113.0/24'::CIDR OR
    v_ip <<= '224.0.0.0/4'::CIDR OR
    v_ip <<= '240.0.0.0/4'::CIDR OR
    v_ip <<= '::/128'::CIDR OR
    v_ip <<= '::1/128'::CIDR OR
    v_ip <<= '::ffff:0:0/96'::CIDR OR
    v_ip <<= 'fc00::/7'::CIDR OR
    v_ip <<= 'fec0::/10'::CIDR OR
    v_ip <<= 'fe80::/10'::CIDR OR
    v_ip <<= 'ff00::/8'::CIDR OR
    v_ip <<= '2001:db8::/32'::CIDR
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP FUNCTION IF EXISTS schedules.upsert_job(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, JSONB);

CREATE OR REPLACE FUNCTION schedules.upsert_job(
  p_job_id UUID,
  p_name TEXT,
  p_cron_expression TEXT,
  p_http_method TEXT,
  p_function_url TEXT,
  p_headers_template JSONB,
  p_resolved_headers JSONB,
  p_body JSONB,
  p_resolved_target JSONB
)
RETURNS TABLE(cron_job_id BIGINT, success BOOLEAN, message TEXT) AS $$
DECLARE
  v_existing_cron_id BIGINT;
  v_new_cron_id BIGINT;
  v_function_call TEXT;
  v_encrypted_headers TEXT;
  v_resolved_target JSONB;
BEGIN
  SELECT j.cron_job_id, j.resolved_target
  INTO v_existing_cron_id, v_resolved_target
  FROM schedules.jobs AS j
  WHERE j.id = p_job_id;

  v_resolved_target := COALESCE(p_resolved_target, v_resolved_target);

  IF NOT schedules.is_safe_url(p_function_url) OR
     v_resolved_target IS NULL OR
     v_resolved_target->>'rawUrl' IS DISTINCT FROM p_function_url OR
     jsonb_array_length(COALESCE(v_resolved_target->'addresses', '[]'::JSONB)) = 0 THEN
    RETURN QUERY SELECT NULL::BIGINT, FALSE, 'Scheduled URL failed outbound policy validation';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_resolved_target->'addresses', '[]'::JSONB)) AS address
    WHERE NOT schedules.is_safe_address(address)
  ) THEN
    RETURN QUERY SELECT NULL::BIGINT, FALSE, 'Scheduled URL resolved to unsafe network address';
    RETURN;
  END IF;

  v_encrypted_headers := schedules.encrypt_headers(p_resolved_headers);

  IF v_existing_cron_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_cron_id);
  END IF;

  v_function_call := format('SELECT schedules.execute_job(%L::UUID)', p_job_id);
  SELECT cron.schedule(p_cron_expression, v_function_call) INTO v_new_cron_id;

  INSERT INTO schedules.jobs (
    id, name, cron_schedule, function_url, http_method, encrypted_headers, headers, body,
    resolved_target, cron_job_id, is_active, created_at, updated_at
  ) VALUES (
    p_job_id, p_name, p_cron_expression, p_function_url, p_http_method, v_encrypted_headers,
    p_headers_template, p_body, v_resolved_target, v_new_cron_id, TRUE, NOW(), NOW()
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    cron_schedule = EXCLUDED.cron_schedule,
    function_url = EXCLUDED.function_url,
    http_method = EXCLUDED.http_method,
    encrypted_headers = EXCLUDED.encrypted_headers,
    headers = EXCLUDED.headers,
    body = EXCLUDED.body,
    resolved_target = EXCLUDED.resolved_target,
    cron_job_id = EXCLUDED.cron_job_id,
    is_active = TRUE,
    updated_at = NOW();

  RETURN QUERY SELECT v_new_cron_id, TRUE, 'Cron job scheduled successfully';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'schedules.upsert_job failed for job %: %', p_job_id, SQLERRM;
  RETURN QUERY SELECT NULL::BIGINT, FALSE, 'Failed to schedule job';
END;
$$ LANGUAGE plpgsql;

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
  v_resolved_target JSONB;
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
    j.encrypted_headers,
    j.resolved_target
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

  IF v_job.resolved_target IS NULL OR
     v_job.resolved_target->>'rawUrl' IS DISTINCT FROM v_job.function_url OR
     jsonb_array_length(COALESCE(v_job.resolved_target->'addresses', '[]'::JSONB)) = 0 THEN
    PERFORM schedules.log_job_execution(
      v_job.id,
      v_job.name,
      FALSE,
      400,
      0,
      'Scheduled URL has no valid DNS-pinned destination'
    );
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(v_job.resolved_target->'addresses', '[]'::JSONB)) AS address
    WHERE NOT schedules.is_safe_address(address)
  ) THEN
    PERFORM schedules.log_job_execution(
      v_job.id,
      v_job.name,
      FALSE,
      400,
      0,
      'Scheduled URL resolved to unsafe network address'
    );
    RETURN;
  END IF;

  v_resolved_target := v_job.resolved_target;
  PERFORM http_set_curlopt(
    'CURLOPT_RESOLVE',
    format(
      '%s:%s:%s',
      v_resolved_target->>'hostname',
      v_resolved_target->>'port',
      CASE
        WHEN position(':' IN v_resolved_target->'addresses'->>0) > 0
          THEN '[' || (v_resolved_target->'addresses'->>0) || ']'
        ELSE v_resolved_target->'addresses'->>0
      END
    )
  );

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
    PERFORM http_set_curlopt('CURLOPT_RESOLVE', '');
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    PERFORM schedules.log_job_execution(v_job.id, v_job.name, FALSE, 500, v_duration_ms, SQLERRM);
  END;
  PERFORM http_set_curlopt('CURLOPT_RESOLVE', '');
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_job RECORD;
BEGIN
  FOR v_job IN
    SELECT id, cron_job_id
    FROM schedules.jobs
    WHERE NOT schedules.is_safe_url(function_url)
       OR resolved_target IS NULL
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

ALTER TABLE schedules.jobs
  DROP CONSTRAINT IF EXISTS schedules_jobs_function_url_safe;

ALTER TABLE schedules.jobs
  ADD CONSTRAINT schedules_jobs_function_url_safe
  CHECK (schedules.is_safe_url(function_url)) NOT VALID;
