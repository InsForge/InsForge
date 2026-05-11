-- Migration 042: Drop deprecated AI configuration and usage tables.
-- The Model Gateway now supports the full OpenRouter model catalog directly.

DROP TABLE IF EXISTS ai.usage;
DROP TABLE IF EXISTS ai.configs;
