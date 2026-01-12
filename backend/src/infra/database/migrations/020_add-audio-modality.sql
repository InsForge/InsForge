-- Migration: 020 - Expand modality constraints to all OpenRouter modalities
-- Supports: text, image, audio, video, file
-- Filtering is handled in application layer (shared-schemas + helpers.ts)

ALTER TABLE ai.configs DROP CONSTRAINT IF EXISTS check_input_modality_valid;
ALTER TABLE ai.configs ADD CONSTRAINT check_input_modality_valid
CHECK (input_modality <@ '{text,image,audio,video,file}'::TEXT[]);

ALTER TABLE ai.configs DROP CONSTRAINT IF EXISTS check_output_modality_valid;
ALTER TABLE ai.configs ADD CONSTRAINT check_output_modality_valid
CHECK (output_modality <@ '{text,image,audio,video,file}'::TEXT[]);
