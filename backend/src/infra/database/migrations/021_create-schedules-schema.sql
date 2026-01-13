-- Migration 021: Create Schedules Schema
--
-- Creates the schedules schema with:
-- 1. jobs table - Cron job definitions with HTTP request configuration
-- 2. job_logs table - Execution history and status tracking
-- 3. Helper functions for encryption, HTTP requests, and cron job management
--
-- Dependencies: pg_cron, http, pgcrypto extensions

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS schedules;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Enable pg_cron extension for scheduling tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable http extension for network operations
CREATE EXTENSION IF NOT EXISTS http;

-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- JOBS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS schedules.jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cron_schedule TEXT NOT NULL,
    function_url TEXT NOT NULL,
    http_method TEXT NOT NULL DEFAULT 'POST',
    encrypted_headers TEXT DEFAULT NULL,
    headers JSONB DEFAULT NULL,
    body JSONB DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    cron_job_id BIGINT,
    last_executed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_cron_job_id ON schedules.jobs(cron_job_id);
CREATE INDEX IF NOT EXISTS idx_jobs_is_active ON schedules.jobs(is_active);

-- ============================================================================
-- JOB LOGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS schedules.job_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES schedules.jobs(id) ON DELETE CASCADE,
    executed_at TIMESTAMPTZ DEFAULT NOW(),
    status_code INT,
    success BOOLEAN,
    duration_ms BIGINT,
    message TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON schedules.job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_logs_executed_at ON schedules.job_logs(executed_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON schedules.jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON schedules.jobs
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ============================================================================
-- ENCRYPTION HELPERS
-- ============================================================================

-- Encrypt headers safely using pgcrypto
CREATE OR REPLACE FUNCTION schedules.encrypt_headers(p_headers JSONB)
RETURNS TEXT AS $$
DECLARE
  v_key TEXT;
  v_encrypted TEXT;
BEGIN
  IF p_headers IS NULL OR p_headers = '{}'::JSONB THEN
    RETURN NULL;
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'Encryption key app.encryption_key is not set';
  END IF;

  -- pgp_sym_encrypt returns bytea; encode to base64 for TEXT storage
  v_encrypted := encode(pgp_sym_encrypt(p_headers::TEXT, v_key), 'base64');

  RETURN v_encrypted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Decrypt headers safely
CREATE OR REPLACE FUNCTION schedules.decrypt_headers(p_encrypted_headers TEXT)
RETURNS JSONB AS $$
DECLARE
  v_key TEXT;
  v_decrypted TEXT;
BEGIN
  IF p_encrypted_headers IS NULL OR p_encrypted_headers = '' THEN
    RETURN '{}'::JSONB;
  END IF;

  v_key := current_setting('app.encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
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

-- ============================================================================
-- HTTP HEADER BUILDER
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.build_http_headers(headers_jsonb JSONB)
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

-- ============================================================================
-- LOG JOB EXECUTION
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.log_job_execution(
  p_job_id UUID,
  p_job_name TEXT,
  p_success BOOLEAN,
  p_response_status INT,
  p_duration_ms BIGINT,
  p_message TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  INSERT INTO schedules.job_logs (
    job_id,
    executed_at,
    status_code,
    success,
    duration_ms,
    message
  ) VALUES (
    p_job_id,
    NOW(),
    p_response_status,
    p_success,
    p_duration_ms,
    p_message
  );

  -- Update last_executed_at in jobs table
  UPDATE schedules.jobs
  SET last_executed_at = NOW(),
      updated_at = NOW()
  WHERE id = p_job_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- EXECUTE JOB
-- ============================================================================

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
  -- Fetch the job
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
    -- Execute HTTP call
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

-- ============================================================================
-- UPSERT JOB
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.upsert_job(
  p_job_id UUID,
  p_name TEXT,
  p_cron_expression TEXT,
  p_http_method TEXT,
  p_function_url TEXT,
  p_headers_template JSONB,
  p_resolved_headers JSONB,
  p_body JSONB
)
RETURNS TABLE(cron_job_id BIGINT, success BOOLEAN, message TEXT) AS $$
DECLARE
  v_existing_cron_id BIGINT;
  v_new_cron_id BIGINT;
  v_function_call TEXT;
  v_encrypted_headers TEXT;
BEGIN
  -- Encrypt resolved headers (with actual secret values) before storing
  v_encrypted_headers := schedules.encrypt_headers(p_resolved_headers);

  -- Unschedule any existing job for this schedule to prevent duplicates
  SELECT j.cron_job_id INTO v_existing_cron_id
  FROM schedules.jobs AS j
  WHERE j.id = p_job_id;

  IF v_existing_cron_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_existing_cron_id);
  END IF;

  -- Schedule the new cron job
  v_function_call := format('SELECT schedules.execute_job(%L::UUID)', p_job_id);
  SELECT cron.schedule(p_cron_expression, v_function_call) INTO v_new_cron_id;

  -- Insert or update the job record
  -- headers = original template (safe to display)
  -- encrypted_headers = resolved values (used at runtime)
  INSERT INTO schedules.jobs (
    id, name, cron_schedule, function_url, http_method, encrypted_headers, headers, body, cron_job_id, is_active, created_at, updated_at
  ) VALUES (
    p_job_id,
    p_name,
    p_cron_expression,
    p_function_url,
    p_http_method,
    v_encrypted_headers,
    p_headers_template,
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
    headers = EXCLUDED.headers,
    body = EXCLUDED.body,
    cron_job_id = EXCLUDED.cron_job_id,
    is_active = TRUE,
    updated_at = NOW();

  RETURN QUERY SELECT v_new_cron_id, TRUE, 'Cron job scheduled successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT NULL::BIGINT, FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DISABLE JOB
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.disable_job(p_job_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_cron_job_id BIGINT;
BEGIN
  SELECT cron_job_id INTO v_cron_job_id
  FROM schedules.jobs WHERE id = p_job_id;

  IF v_cron_job_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'No cron job found for this job';
    RETURN;
  END IF;

  PERFORM cron.unschedule(v_cron_job_id);

  UPDATE schedules.jobs
  SET cron_job_id = NULL, is_active = FALSE, updated_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY SELECT TRUE, 'Cron job disabled successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ENABLE JOB
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.enable_job(p_job_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_job RECORD;
  v_new_cron_id BIGINT;
  v_function_call TEXT;
BEGIN
  SELECT id, cron_schedule, function_url
  INTO v_job
  FROM schedules.jobs
  WHERE id = p_job_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Job not found';
    RETURN;
  END IF;

  v_function_call := format('SELECT schedules.execute_job(%L::UUID)', p_job_id);
  SELECT cron.schedule(v_job.cron_schedule, v_function_call) INTO v_new_cron_id;

  UPDATE schedules.jobs
  SET cron_job_id = v_new_cron_id,
      is_active = TRUE,
      updated_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY SELECT TRUE, 'Cron job enabled successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- DELETE JOB
-- ============================================================================

CREATE OR REPLACE FUNCTION schedules.delete_job(p_job_id UUID)
RETURNS TABLE(success BOOLEAN, message TEXT) AS $$
DECLARE
  v_cron_job_id BIGINT;
BEGIN
  SELECT cron_job_id INTO v_cron_job_id
  FROM schedules.jobs WHERE id = p_job_id;

  IF v_cron_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_cron_job_id);
  END IF;

  DELETE FROM schedules.jobs WHERE id = p_job_id;

  RETURN QUERY SELECT TRUE, 'Cron job deleted successfully';
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Grant schema access
GRANT USAGE ON SCHEMA schedules TO authenticated;

-- Grant table access (restrict as needed via RLS)
GRANT SELECT, INSERT, UPDATE, DELETE ON schedules.jobs TO authenticated;
GRANT SELECT ON schedules.job_logs TO authenticated;

-- Grant function execution
GRANT EXECUTE ON FUNCTION schedules.upsert_job TO authenticated;
GRANT EXECUTE ON FUNCTION schedules.disable_job TO authenticated;
GRANT EXECUTE ON FUNCTION schedules.enable_job TO authenticated;
GRANT EXECUTE ON FUNCTION schedules.delete_job TO authenticated;
