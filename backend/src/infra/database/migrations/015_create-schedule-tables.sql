-- Migration: 015 - Create scheduler table 
-- creates the scheduler system table and the necessary extensions for it. 

-- Enable pg_cron extension for scheduling tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable http extension for network operations
CREATE EXTENSION IF NOT EXISTS http;

-- Enable pgcrypto extension for Encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create the _schedules table 
CREATE TABLE IF NOT EXISTS _schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cron_schedule TEXT NOT NULL,
    function_url TEXT NOT NULL,
    http_method TEXT NOT NULL DEFAULT 'POST',
   encrypted_headers TEXT DEFAULT NULL,
    body JSONB DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    cron_job_id BIGINT,
    last_executed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()

   
);

-- Add an index for cron_job_id 
CREATE INDEX IF NOT EXISTS idx_schedules_cron_job_id on _schedules(cron_job_id);


-- Trigger to update updated_at timestamp on row modification
DROP TRIGGER IF EXISTS update__schedules_updated_at ON _schedules;
CREATE TRIGGER update__schedules_updated_at
BEFORE UPDATE ON _schedules
FOR EACH ROW
EXECUTE PROCEDURE update_updated_at_column();


-- ===============================================
-- SCHEDULE EXECUTION LOGGING TABLE 
-- ===============================================
CREATE TABLE _schedule_execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID REFERENCES _schedules(id) ON DELETE CASCADE,
    executed_at TIMESTAMPTZ DEFAULT NOW(),
    status_code INT,
    success BOOLEAN,
    duration_ms BIGINT,
    message TEXT
);

CREATE INDEX idx_schedule_execution_logs_schedule_id ON _schedule_execution_logs(schedule_id);