-- Migration 023: Create Memory Table with pgvector (POC)
--
-- Single-table approach for conversation memory:
-- - Stores conversations with messages as JSONB
-- - Only embeds conversation summary (not individual messages)
-- - Optimized for MCP store/search workflow
--
-- Dependencies: pgvector extension

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- CONVERSATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.memory_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    title TEXT,
    messages JSONB NOT NULL DEFAULT '[]',
    metadata JSONB DEFAULT '{}',
    summary_embedding vector(1536),
    summary_text TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for conversations
CREATE INDEX IF NOT EXISTS idx_memory_conversations_user_id ON public.memory_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_conversations_created_at ON public.memory_conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_conversations_metadata ON public.memory_conversations USING GIN (metadata);

-- HNSW index for conversation summary embeddings
CREATE INDEX IF NOT EXISTS idx_memory_conversations_embedding ON public.memory_conversations
    USING hnsw (summary_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION public.memory_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_memory_conversations_updated_at ON public.memory_conversations;
CREATE TRIGGER trg_memory_conversations_updated_at
BEFORE UPDATE ON public.memory_conversations
FOR EACH ROW EXECUTE FUNCTION public.memory_update_updated_at();

-- ============================================================================
-- SEARCH CONVERSATIONS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.search_memory_conversations(
    p_user_id TEXT,
    p_embedding vector,
    p_limit INT DEFAULT 10,
    p_threshold FLOAT DEFAULT 0.0,
    p_metadata_filter JSONB DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    title TEXT,
    metadata JSONB,
    summary_text TEXT,
    message_count INTEGER,
    similarity FLOAT,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.title,
        c.metadata,
        c.summary_text,
        c.message_count,
        (1 - (c.summary_embedding <=> p_embedding))::FLOAT as similarity,
        c.created_at,
        c.updated_at
    FROM public.memory_conversations c
    WHERE c.user_id = p_user_id
      AND c.summary_embedding IS NOT NULL
      AND (1 - (c.summary_embedding <=> p_embedding)) >= p_threshold
      AND (p_metadata_filter IS NULL OR c.metadata @> p_metadata_filter)
    ORDER BY c.summary_embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- GET CONVERSATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_memory_conversation(
    p_user_id TEXT,
    p_conversation_id UUID
)
RETURNS TABLE (
    id UUID,
    user_id TEXT,
    title TEXT,
    messages JSONB,
    metadata JSONB,
    summary_text TEXT,
    message_count INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        c.id,
        c.user_id,
        c.title,
        c.messages,
        c.metadata,
        c.summary_text,
        c.message_count,
        c.created_at,
        c.updated_at
    FROM public.memory_conversations c
    WHERE c.id = p_conversation_id AND c.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql STABLE;
