-- Migration: 023 - Add soft-disable support for AI configurations
--
-- Why:
-- AI model "disable" should preserve usage-to-config links for auditing and analytics.
-- Instead of deleting ai.configs rows, we soft-disable them via is_active.
--
-- Desired behavior:
-- - Keep ai.usage.config_id always linked to ai.configs(id)
-- - Allow disabling/enabling models without hard deletes

BEGIN;

ALTER TABLE ai.configs
ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
