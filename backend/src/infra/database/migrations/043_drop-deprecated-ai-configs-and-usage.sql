-- Migration 043: Drop deprecated AI configuration and usage tables.
-- The Model Gateway now supports the full OpenRouter model catalog directly.
--
-- Only drop tables in the internal `ai` schema. Do not touch similarly named
-- user-created tables in `public` or any other schema. Guard the schema lookup
-- so fresh installs or partially migrated databases do not fail before `ai`
-- exists.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'ai') THEN
    DROP TABLE IF EXISTS ai.usage CASCADE;
    DROP TABLE IF EXISTS ai.configs CASCADE;
  END IF;
END $$;
