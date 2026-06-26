-- Migration: 056 - Drop the deprecated `ai` schema
--
-- The `ai` schema held ai.configs and ai.usage, both dropped in migration 043
-- once the Model Gateway took over the OpenRouter catalog. The schema itself
-- was left behind: it is empty, referenced nowhere in application code, and
-- still surfaces in the dashboard schema list (database.service.getSchemas
-- returns every non-pg_/information_schema namespace). Remove it.
--
-- Guarded and RESTRICT-by-default: if anything unexpectedly still lives in `ai`,
-- the DROP fails loudly rather than silently cascading.

-- UP migration
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'ai') THEN
    DROP SCHEMA ai;
  END IF;
END $$;

-- DOWN migration
-- Recreate the empty schema for rollback symmetry. The tables it once held were
-- already dropped in 043 and are not restored.
CREATE SCHEMA IF NOT EXISTS ai;
