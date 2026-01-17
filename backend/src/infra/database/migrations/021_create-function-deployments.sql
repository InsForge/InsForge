-- Track Deno Deploy deployment history for functions
CREATE TABLE IF NOT EXISTS functions.deployments (
  id TEXT PRIMARY KEY,                    -- deployment_id from Deno Deploy
  project_id TEXT NOT NULL,               -- Deno project name
  status TEXT NOT NULL DEFAULT 'pending', -- pending, success, failed
  url TEXT,                               -- deployment URL
  function_count INT,
  functions JSONB,                        -- array of function slugs
  error_message TEXT,
  error_file TEXT,                        -- e.g., "functions/sdk-test.ts" or "main.ts"
  error_function TEXT,                    -- parsed function slug if applicable
  build_logs JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying latest deployments
CREATE INDEX IF NOT EXISTS idx_function_deployments_created
  ON functions.deployments(created_at DESC);

-- Index for querying by status
CREATE INDEX IF NOT EXISTS idx_function_deployments_status
  ON functions.deployments(status);
