-- Migration: 023 - Restore AI usage foreign key to SET NULL on config deletion
--
-- Why:
-- In 018_schema-rework.sql, the FK was recreated with ON DELETE NO ACTION,
-- which blocks deleting ai.configs rows once usage exists.
--
-- Desired behavior:
-- Keep ai.usage records for historical analytics while allowing model/config disable
-- by deleting ai.configs and nulling ai.usage.config_id.

BEGIN;

-- Ensure config_id can be nulled when parent config is deleted
ALTER TABLE ai.usage
ALTER COLUMN config_id DROP NOT NULL;

-- Replace FK behavior from NO ACTION to SET NULL
ALTER TABLE ai.usage
DROP CONSTRAINT IF EXISTS usage_config_id_fkey;

ALTER TABLE ai.usage
ADD CONSTRAINT usage_config_id_fkey
FOREIGN KEY (config_id) REFERENCES ai.configs(id) ON DELETE SET NULL;

COMMIT;
