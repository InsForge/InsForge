-- Migration 023: Create Memory Schema with pgvector
--
-- Creates the memory schema with:
-- 1. vector extension (pgvector) for embeddings
-- 2. conversations table - Store conversation metadata and summary embeddings
-- 3. messages table - Store individual messages with embeddings
-- 4. HNSW indexes for fast vector similarity search
-- 5. RPC functions for semantic search
-- 6. RLS policies for user access control
--
-- Dependencies: pgvector extension

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS memory;

-- ============================================================================
-- EXTENSIONS
-- ============================================================================

-- Enable pgvector extension for vector embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- CONVERSATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory.conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    title TEXT,
    metadata JSONB DEFAULT '{}',
    summary_embedding vector(1536),
    summary_text TEXT,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for conversations
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON memory.conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_conversations_created_at ON memory.conversations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_metadata ON memory.conversations USING GIN (metadata);

-- HNSW index for conversation summary embeddings (fast approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_conversations_embedding ON memory.conversations
    USING hnsw (summary_embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS memory.messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES memory.conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
    content TEXT NOT NULL,
    embedding vector(1536),
    "position" INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for messages
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON memory.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_position ON memory.messages(conversation_id, "position");

-- HNSW index for message embeddings
CREATE INDEX IF NOT EXISTS idx_messages_embedding ON memory.messages
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_conversations_updated_at ON memory.conversations;
CREATE TRIGGER trg_conversations_updated_at
BEFORE UPDATE ON memory.conversations
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ============================================================================
-- SEARCH CONVERSATIONS FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION memory.search_conversations(
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
    FROM memory.conversations c
    WHERE c.user_id = p_user_id
      AND c.summary_embedding IS NOT NULL
      AND (1 - (c.summary_embedding <=> p_embedding)) >= p_threshold
      AND (p_metadata_filter IS NULL OR c.metadata @> p_metadata_filter)
    ORDER BY c.summary_embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- SEARCH MESSAGES FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION memory.search_messages(
    p_user_id TEXT,
    p_embedding vector,
    p_conversation_id UUID DEFAULT NULL,
    p_limit INT DEFAULT 10,
    p_threshold FLOAT DEFAULT 0.0
)
RETURNS TABLE (
    id UUID,
    conversation_id UUID,
    conversation_title TEXT,
    role TEXT,
    content TEXT,
    "position" INTEGER,
    metadata JSONB,
    similarity FLOAT,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.conversation_id,
        c.title as conversation_title,
        m.role,
        m.content,
        m."position",
        m.metadata,
        (1 - (m.embedding <=> p_embedding))::FLOAT as similarity,
        m.created_at
    FROM memory.messages m
    JOIN memory.conversations c ON c.id = m.conversation_id
    WHERE c.user_id = p_user_id
      AND m.embedding IS NOT NULL
      AND (1 - (m.embedding <=> p_embedding)) >= p_threshold
      AND (p_conversation_id IS NULL OR m.conversation_id = p_conversation_id)
    ORDER BY m.embedding <=> p_embedding
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

-- Enable RLS on tables
ALTER TABLE memory.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory.messages ENABLE ROW LEVEL SECURITY;

-- Policy for conversations: users can only access their own conversations
DROP POLICY IF EXISTS conversations_user_policy ON memory.conversations;
CREATE POLICY conversations_user_policy ON memory.conversations
    FOR ALL
    USING (user_id = current_setting('app.user_id', true))
    WITH CHECK (user_id = current_setting('app.user_id', true));

-- Policy for messages: users can only access messages in their conversations
DROP POLICY IF EXISTS messages_user_policy ON memory.messages;
CREATE POLICY messages_user_policy ON memory.messages
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM memory.conversations c
            WHERE c.id = conversation_id
            AND c.user_id = current_setting('app.user_id', true)
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM memory.conversations c
            WHERE c.id = conversation_id
            AND c.user_id = current_setting('app.user_id', true)
        )
    );

-- ============================================================================
-- HELPER FUNCTION: Get conversation with messages
-- ============================================================================

CREATE OR REPLACE FUNCTION memory.get_conversation_with_messages(
    p_user_id TEXT,
    p_conversation_id UUID
)
RETURNS TABLE (
    conversation JSONB
) AS $$
DECLARE
    v_conv RECORD;
    v_messages JSONB;
BEGIN
    -- Get the conversation
    SELECT c.id, c.user_id, c.title, c.metadata, c.summary_text,
           c.message_count, c.created_at, c.updated_at
    INTO v_conv
    FROM memory.conversations c
    WHERE c.id = p_conversation_id AND c.user_id = p_user_id;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- Get messages as JSONB array
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', m.id,
            'role', m.role,
            'content', m.content,
            'position', m."position",
            'metadata', m.metadata,
            'createdAt', m.created_at
        ) ORDER BY m."position"
    ), '[]'::jsonb)
    INTO v_messages
    FROM memory.messages m
    WHERE m.conversation_id = p_conversation_id;

    -- Return combined result
    RETURN QUERY SELECT jsonb_build_object(
        'id', v_conv.id,
        'userId', v_conv.user_id,
        'title', v_conv.title,
        'metadata', v_conv.metadata,
        'summaryText', v_conv.summary_text,
        'messageCount', v_conv.message_count,
        'createdAt', v_conv.created_at,
        'updatedAt', v_conv.updated_at,
        'messages', v_messages
    );
END;
$$ LANGUAGE plpgsql STABLE;
