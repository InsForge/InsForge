-- Migration: 047 - Normalize functions.deployments.functions into a join table
--
-- functions.deployments had no FK to functions.definitions. Function slugs
-- were stored in a JSONB array (functions column), making orphan cleanup
-- error-prone and requiring app-level logic or cron jobs.
--
-- This migration normalizes the relationship into a join table with a proper
-- FK constraint so that deleting a function automatically cascades.

-- Add a composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_functions_deployments_status_created
  ON functions.deployments(status, created_at);

-- Add a GIN index on the functions JSONB column for backward-compatible queries
CREATE INDEX IF NOT EXISTS idx_functions_deployments_functions_gin
  ON functions.deployments USING GIN (functions);

-- Create the join table
CREATE TABLE IF NOT EXISTS functions.deployment_functions (
  deployment_id TEXT NOT NULL REFERENCES functions.deployments(id) ON DELETE CASCADE,
  slug TEXT NOT NULL REFERENCES functions.definitions(slug) ON DELETE CASCADE,
  PRIMARY KEY (deployment_id, slug)
);

-- Index for looking up deployments by function slug
CREATE INDEX IF NOT EXISTS idx_deployment_functions_slug
  ON functions.deployment_functions(slug);

-- Backfill existing data from the JSONB array into the join table
INSERT INTO functions.deployment_functions (deployment_id, slug)
  SELECT d.id, jsonb_array_elements_text(d.functions) AS slug
  FROM functions.deployments d
  WHERE d.functions IS NOT NULL
    AND jsonb_array_length(d.functions) > 0
ON CONFLICT DO NOTHING;
