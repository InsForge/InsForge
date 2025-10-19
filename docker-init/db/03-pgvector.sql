-- Enable pgvector extension for vector similarity search
-- This extension adds support for vector data types and operations

CREATE EXTENSION IF NOT EXISTS vector;

-- Verify installation
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
    ) THEN
        RAISE EXCEPTION 'pgvector extension installation failed';
    END IF;
    RAISE NOTICE 'pgvector extension v% installed successfully',
        (SELECT extversion FROM pg_extension WHERE extname = 'vector');
END
$$;
