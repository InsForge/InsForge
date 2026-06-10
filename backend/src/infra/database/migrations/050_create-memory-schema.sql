-- ============================================================================
-- Migration 049: Agent memory schema (pgvector)
-- Managed schema provisioned in every project, like realtime.* / schedules.*.
-- Stores durable agent memories with embeddings for semantic recall.
-- ============================================================================

-- pgvector for embedding storage + similarity search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('fact', 'decision', 'preference', 'reference')),
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  embedding       VECTOR(1536) NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'openai/text-embedding-3-small',
  source          TEXT,
  -- Generated full-text vector for hybrid (keyword + semantic) recall.
  -- Keyword search catches exact tokens (identifiers, file paths, key names)
  -- that embeddings smear together.
  content_tsv     TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memories are partitioned logically by scope (project / agent / end-user).
CREATE INDEX IF NOT EXISTS idx_memories_scope ON memory.memories (scope);

-- HNSW index for cosine similarity (safe on empty tables).
CREATE INDEX IF NOT EXISTS idx_memories_embedding_cosine
  ON memory.memories USING hnsw (embedding vector_cosine_ops);

-- GIN index for the keyword arm of hybrid recall.
CREATE INDEX IF NOT EXISTS idx_memories_content_tsv
  ON memory.memories USING gin (content_tsv);

-- Keep updated_at fresh on UPDATE (reconcile path).
CREATE TRIGGER trg_memories_updated_at
BEFORE UPDATE ON memory.memories
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
