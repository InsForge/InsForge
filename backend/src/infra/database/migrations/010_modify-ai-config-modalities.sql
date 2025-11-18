-- Migration: 010 - Modify AI configurations table to support input/output modalities
-- This migration modifies the _ai_configs table to:
-- 1. Add new columns: input_modality and output_modality (TEXT arrays)
-- 2. Migrate existing modality data to input_modality
-- 3. Set default output_modality based on existing modality
-- 4. Drop the old modality column

DO $$
BEGIN
    -- Add new columns for input and output modalities
    ALTER TABLE _ai_configs 
    ADD COLUMN IF NOT EXISTS input_modality TEXT[] DEFAULT '{text}';
    
    ALTER TABLE _ai_configs 
    ADD COLUMN IF NOT EXISTS output_modality TEXT[] DEFAULT '{text}';

    -- Check if modality column exists and migrate data if it does
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = '_ai_configs'
        AND column_name = 'modality'
    ) THEN
        -- Migrate existing modality data to input_modality
        -- For most cases, we'll set input_modality to the existing modality
        -- and output_modality to the same value, only supporting text and image
        UPDATE _ai_configs
        SET
            input_modality = CASE
                WHEN modality = 'multi' THEN '{text,image}'::TEXT[]
                WHEN modality = 'image' THEN '{text,image}'::TEXT[]
                ELSE ARRAY[modality]::TEXT[]
            END,
            output_modality = CASE
                WHEN modality = 'multi' THEN '{text,image}'::TEXT[]
                WHEN modality = 'text' THEN '{text}'::TEXT[]
                WHEN modality = 'image' THEN '{text,image}'::TEXT[]
                ELSE '{text}'::TEXT[]
            END
        WHERE input_modality = '{text}' OR input_modality IS NULL;
    END IF;

    -- Make the new columns NOT NULL after migration
    ALTER TABLE _ai_configs 
    ALTER COLUMN input_modality SET NOT NULL;
    
    ALTER TABLE _ai_configs 
    ALTER COLUMN output_modality SET NOT NULL;

    -- Drop the old modality column
    ALTER TABLE _ai_configs 
    DROP COLUMN IF EXISTS modality;

    -- Create indexes for the new TEXT array columns for better query performance
    CREATE INDEX IF NOT EXISTS idx_ai_configs_input_modality ON _ai_configs USING GIN (input_modality);
    CREATE INDEX IF NOT EXISTS idx_ai_configs_output_modality ON _ai_configs USING GIN (output_modality);

    -- Drop existing constraints if they exist, then add them
    ALTER TABLE _ai_configs
    DROP CONSTRAINT IF EXISTS check_input_modality_not_empty;

    ALTER TABLE _ai_configs
    ADD CONSTRAINT check_input_modality_not_empty
    CHECK (array_length(input_modality, 1) > 0);

    ALTER TABLE _ai_configs
    DROP CONSTRAINT IF EXISTS check_output_modality_not_empty;

    ALTER TABLE _ai_configs
    ADD CONSTRAINT check_output_modality_not_empty
    CHECK (array_length(output_modality, 1) > 0);

    -- Drop existing constraints if they exist, then add them
    ALTER TABLE _ai_configs
    DROP CONSTRAINT IF EXISTS check_input_modality_valid;

    ALTER TABLE _ai_configs
    ADD CONSTRAINT check_input_modality_valid
    CHECK (
        input_modality <@ '{text,image}'::TEXT[]
    );

    ALTER TABLE _ai_configs
    DROP CONSTRAINT IF EXISTS check_output_modality_valid;

    ALTER TABLE _ai_configs
    ADD CONSTRAINT check_output_modality_valid
    CHECK (
        output_modality <@ '{text,image}'::TEXT[]
    );

END $$;
