-- Add usage_type column to ai.usage to distinguish chat, embedding, and image_generation requests
ALTER TABLE ai.usage ADD COLUMN IF NOT EXISTS usage_type VARCHAR(20) NOT NULL DEFAULT 'chat';

-- Backfill existing image generation rows
UPDATE ai.usage SET usage_type = 'image_generation' WHERE image_count IS NOT NULL AND image_count > 0;
