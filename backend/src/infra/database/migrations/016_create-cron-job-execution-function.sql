-- ===============================================
-- Migration 016: Create cron job scheduling and execution functions
-- Dependencies: pgcrypto, pg_cron, http
-- ===============================================

-- ===============================================
-- ENCRYPTION HELPERS
-- ===============================================

-- Encrypt headers safely using pgcrypto
CREATE OR REPLACE FUNCTION encrypt_headers(p_headers JSONB)
RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
  v_encrypted TEXT;
BEGIN
  IF p_headers IS NULL OR p_headers = '{}'::JSONB THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key app.encryption_key is not set';
  END IF;

  -- pgp_sym_encrypt returns bytea; encode to base64 for TEXT storage
  v_encrypted := encode(pgp_sym_encrypt(p_headers::TEXT, v_key), 'base64');

  RETURN v_encrypted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Decrypt headers safely
CREATE OR REPLACE FUNCTION decrypt_headers(p_encrypted_headers TEXT)
RETURNS JSONB AS $$
DECLARE
  v_key TEXT;
  v_decrypted TEXT;
BEGIN
  IF p_encrypted_headers IS NULL OR p_encrypted_headers = '' THEN
    RETURN '{}'::JSONB;
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Encryption key app.encryption_key is not set';
  END IF;

  -- Try to decode and decrypt
  BEGIN
    v_decrypted := pgp_sym_decrypt(decode(p_encrypted_headers, 'base64'), v_key);
    RETURN v_decrypted::JSONB;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'Decryption failed for value: %, error: %', left(p_encrypted_headers, 50), SQLERRM;
    RETURN '{}'::JSONB;
  END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ===============================================
-- HTTP HEADER BUILDER
-- ===============================================

CREATE OR REPLACE FUNCTION build_http_headers(headers_jsonb JSONB)
RETURNS http_header[] AS $$
DECLARE
  v_headers http_header[] := ARRAY[]::http_header[];
  v_key TEXT;
BEGIN
  IF headers_jsonb IS NULL THEN
    RETURN v_headers;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(headers_jsonb)
  LOOP
    v_headers := array_append(
      v_headers,
      http_header(v_key, headers_jsonb ->> v_key)
    );
  END LOOP;

  RETURN v_headers;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===============================================
-- LOG SCHEDULE EXECUTION FUNCTION
-- ===============================================

CREATE OR REPLACE FUNCTION log_schedule_execution(
  p_schedule_id UUID,
  p_schedule_name TEXT,
  p_success BOOLEAN,
  p_response_status INT,
  p_duration_ms BIGINT,
  p_message TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO _schedule_execution_logs (
    schedule_id,
    executed_at,
    status_code,
    success,
    duration_ms,
    message
  ) VALUES (
    p_schedule_id,
    NOW(),
    p_response_status,
    p_success,
    p_duration_ms,
    p_message
  );

  -- Update last_executed_at in _schedules table
  UPDATE _schedules
  SET last_executed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_schedule_id;
END;
$$ LANGUAGE plpgsql;


-- ===============================================
-- EXECUTE SCHEDULED REQUEST
-- ===============================================

CREATE OR REPLACE FUNCTION execute_scheduled_request(p_schedule_id UUID)
RETURNS void AS $$
DECLARE
  v_schedule RECORD;
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
  -- Fetch the schedule
  SELECT
    s.id,
    s.name,
    s.function_url,
    s.http_method,
    s.body,
    s.encrypted_headers
  INTO v_schedule
  FROM _schedules AS s
  WHERE s.id = p_schedule_id;

  IF NOT FOUND THEN
    PERFORM log_schedule_execution(p_schedule_id, 'unknown', FALSE, 404, 0, 'Schedule not found');
    RETURN;
  END IF;

  BEGIN
    -- Decrypt headers
    v_decrypted_headers := decrypt_headers(v_schedule.encrypted_headers);

    -- Build the final request body
    v_final_body := COALESCE(v_schedule.body, '{}'::JSONB);

    -- Construct HTTP request
    v_http_request := (
      v_schedule.http_method::http_method,
      v_schedule.function_url,
      build_http_headers(v_decrypted_headers),
      'application/json',
      v_final_body::TEXT
    );
    v_start_time := clock_timestamp();
    -- Execute HTTP call
    v_http_response := http(v_http_request);
    v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    v_status := v_http_response.status;
    v_body := v_http_response.content;
    v_success := v_status BETWEEN 200 AND 299;

    -- Log execution
   v_error_message := CASE WHEN v_success THEN 'Success' ELSE 'HTTP ' || v_status END;
    PERFORM log_schedule_execution(v_schedule.id, v_schedule.name, v_success, v_status, v_duration_ms, v_error_message);

  EXCEPTION WHEN OTHERS THEN
   v_end_time := clock_timestamp();
    v_duration_ms := EXTRACT(EPOCH FROM (v_end_time - v_start_time)) * 1000;
    PERFORM log_schedule_execution(v_schedule.id, v_schedule.name, FALSE, 500, v_duration_ms, SQLERRM);
  END;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- UPSERT CRON SCHEDULE
-- ===============================================

CREATE OR REPLACE FUNCTION upsert_cron_schedule(
  p_schedule_id UUID,
  p_name TEXT,
  p_cron_expression TEXT,
  p_http_method TEXT,
  p_function_url TEXT,
  p_headers JSONB,
  p_body JSONB
)
RETURNS TABLE(cron_job_id BIGINT, success BOOLEAN, message TEXT) AS $$
DECLARE
  v_existing_cron_id BIGINT;
  v_new_cron_id BIGINT;
  v_function_call TEXT;
  v_encrypted_headers TEXT;
BEGIN
  -- Encrypt headers before storing
  v_encrypted_headers := encrypt_headers(p_headers);

  -- Unschedule any existing job for this schedule to prevent duplicates
  SELECT s.cron_job_id INTO v_existing_cron_id
  FROM _schedules AS s
  WHERE s.id = p_schedule_id;

  IF v_existing_cron_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_cron_id);
  END IF;

  -- Schedule the new cron job
  v_function_call := format('SELECT execute_scheduled_request(%L::UUID)', p_schedule_id);
  SELECT cron.schedule(p_cron_expression, v_function_call) INTO v_new_cron_id;

  -- Insert or update the schedule record in the `_schedules` table
  INSERT INTO _schedules (
    id, name, cron_schedule, function_url, http_method, encrypted_headers, body, cron_job_id, is_active, created_at, updated_at
  ) VALUES (
    p_schedule_id,
    p_name,
    p_cron_expression,
    p_function_url,
    p_http_method,
    v_encrypted_headers,
    p_body,
    v_new_cron_id,
    TRUE,
    NOW(),
    NOW()
  ) ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    cron_schedule = EXCLUDED.cron_schedule,
    function_url = EXCLUDED.function_url,
    http_method = EXCLUDED.http_method,
    encrypted_headers = EXCLUDED.encrypted_headers,
    body = EXCLUDED.body,
    cron_job_id = EXCLUDED.cron_job_id,
    is_active = TRUE,
    updated_at = NOW();

  RETURN QUERY SELECT v_new_cron_id, TRUE, 'Cron job scheduled successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::BIGINT, FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- DISABLE CRON SCHEDULE
-- ===============================================

CREATE OR REPLACE FUNCTION disable_cron_schedule(p_schedule_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_cron_job_id BIGINT;
BEGIN
  SELECT cron_job_id INTO v_cron_job_id
  FROM _schedules WHERE id = p_schedule_id;

  IF v_cron_job_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'No cron job found for this schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(v_cron_job_id);

  UPDATE _schedules
  SET cron_job_id = NULL, is_active = FALSE, updated_at = NOW()
  WHERE id = p_schedule_id;

  RETURN QUERY SELECT TRUE, 'Cron job disabled successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- ENABLE CRON SCHEDULE
-- Schedule an existing schedule's cron job without re-inserting the row.
-- This will create a new cron job entry using the schedule's existing fields
-- and set is_active = TRUE on the schedule row.
-- ===============================================

CREATE OR REPLACE FUNCTION enable_cron_schedule(p_schedule_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_schedule RECORD;
  v_new_cron_id BIGINT;
  v_function_call TEXT;
BEGIN
  SELECT id, cron_schedule, function_url
  INTO v_schedule
  FROM _schedules
  WHERE id = p_schedule_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Schedule not found';
    RETURN;
  END IF;

  v_function_call := format('SELECT execute_scheduled_request(%L::UUID)', p_schedule_id);
  SELECT cron.schedule(v_schedule.cron_schedule, v_function_call) INTO v_new_cron_id;

  UPDATE _schedules
  SET cron_job_id = v_new_cron_id,
      is_active = TRUE,
      updated_at = NOW()
  WHERE id = p_schedule_id;

  RETURN QUERY SELECT TRUE, 'Cron job enabled successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ===============================================
-- DELETE CRON SCHEDULE
-- ===============================================

CREATE OR REPLACE FUNCTION delete_cron_schedule(p_schedule_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_cron_job_id BIGINT;
BEGIN
  SELECT cron_job_id INTO v_cron_job_id
  FROM _schedules WHERE id = p_schedule_id;

  IF v_cron_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_cron_job_id);
  END IF;

  DELETE FROM _schedules WHERE id = p_schedule_id;

  RETURN QUERY SELECT TRUE, 'Cron schedule deleted successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;
