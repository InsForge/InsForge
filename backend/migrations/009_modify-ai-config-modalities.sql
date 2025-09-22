-- Migration: 008 - Modify AI configurations table to support input/output modalities
-- This migration modifies the _ai_configs table to:
-- 1. Add new columns: input_modality and output_modality (JSONB arrays)
-- 2. Migrate existing modality data to input_modality
-- 3. Set default output_modality based on existing modality
-- 4. Drop the old modality column

DO $$
BEGIN
    -- Add new columns for input and output modalities
    ALTER TABLE _ai_configs 
    ADD COLUMN IF NOT EXISTS input_modality JSONB DEFAULT '[]'::jsonb;
    
    ALTER TABLE _ai_configs 
    ADD COLUMN IF NOT EXISTS output_modality JSONB DEFAULT '[]'::jsonb;

    -- Migrate existing modality data to input_modality
    -- For most cases, we'll set input_modality to the existing modality
    -- and output_modality to the same value, unless it's 'multi'
    UPDATE _ai_configs 
    SET 
        input_modality = CASE 
            WHEN modality = 'multi' THEN '["text", "image", "audio", "video", "file"]'::jsonb
            ELSE jsonb_build_array(modality)
        END,
        output_modality = CASE 
            WHEN modality = 'multi' THEN '["text", "image", "audio", "video", "file"]'::jsonb
            WHEN modality = 'text' THEN '["text"]'::jsonb
            WHEN modality = 'image' THEN '["text", "image"]'::jsonb
            WHEN modality = 'audio' THEN '["text", "audio"]'::jsonb
            WHEN modality = 'video' THEN '["text", "video"]'::jsonb
            WHEN modality = 'file' THEN '["text", "file"]'::jsonb
            ELSE jsonb_build_array(modality)
        END
    WHERE input_modality = '[]'::jsonb OR input_modality IS NULL;

    -- Make the new columns NOT NULL after migration
    ALTER TABLE _ai_configs 
    ALTER COLUMN input_modality SET NOT NULL;
    
    ALTER TABLE _ai_configs 
    ALTER COLUMN output_modality SET NOT NULL;

    -- Drop the old modality column
    ALTER TABLE _ai_configs 
    DROP COLUMN IF EXISTS modality;

    -- Create indexes for the new JSONB columns for better query performance
    CREATE INDEX IF NOT EXISTS idx_ai_configs_input_modality ON _ai_configs USING GIN (input_modality);
    CREATE INDEX IF NOT EXISTS idx_ai_configs_output_modality ON _ai_configs USING GIN (output_modality);

    -- Add check constraints to ensure arrays are not empty
    ALTER TABLE _ai_configs 
    ADD CONSTRAINT check_input_modality_not_empty 
    CHECK (jsonb_array_length(input_modality) > 0);
    
    ALTER TABLE _ai_configs 
    ADD CONSTRAINT check_output_modality_not_empty 
    CHECK (jsonb_array_length(output_modality) > 0);

    -- Add check constraints to ensure valid modality values
    ALTER TABLE _ai_configs 
    ADD CONSTRAINT check_input_modality_valid 
    CHECK (
        input_modality <@ '["text", "image", "audio", "video", "file"]'::jsonb
    );
    
    ALTER TABLE _ai_configs 
    ADD CONSTRAINT check_output_modality_valid 
    CHECK (
        output_modality <@ '["text", "image", "audio", "video", "file"]'::jsonb
    );

END $$;
