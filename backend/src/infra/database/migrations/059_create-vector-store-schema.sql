-- ============================================================================
-- Migration 059: Vector store schema (Pinecone-like, backed by pgvector)
-- Managed schema provisioned in every project. Collections group fixed-dimension
-- embeddings; items carry an embedding plus optional source text and metadata.
-- Owner-scoped Row Level Security gates end-user access.
-- ============================================================================

-- Already created in migration 050; repeated for independence/idempotency.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS vectors;

CREATE TABLE IF NOT EXISTS vectors.collections (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  dimension  INT NOT NULL DEFAULT 1536,
  metric     TEXT NOT NULL DEFAULT 'cosine' CHECK (metric IN ('cosine', 'l2', 'ip')),
  owner_id   UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Collection names are unique per owner (NULL owner = project-global).
CREATE UNIQUE INDEX IF NOT EXISTS uq_vector_collections_owner_name
  ON vectors.collections (name, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE IF NOT EXISTS vectors.items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id UUID NOT NULL REFERENCES vectors.collections(id) ON DELETE CASCADE,
  -- MVP fixes the column at 1536 to match the managed embedding model. A future
  -- per-collection-table backend can vary this without changing the API.
  embedding     VECTOR(1536) NOT NULL,
  content       TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  owner_id      UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vector_items_collection ON vectors.items (collection_id);

-- HNSW index for cosine similarity (the indexed/default metric; safe on empty
-- tables). l2/ip queries compute correct distances but are not index-accelerated.
CREATE INDEX IF NOT EXISTS idx_vector_items_embedding_cosine
  ON vectors.items USING hnsw (embedding vector_cosine_ops);

-- GIN index supports Pinecone-style metadata containment filters (metadata @> ...).
CREATE INDEX IF NOT EXISTS idx_vector_items_metadata
  ON vectors.items USING gin (metadata jsonb_path_ops);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- Same model as kv.*: end-user requests run as authenticated/anon via
-- withUserContext and are gated here; the API-key/admin path uses the superuser
-- pool role and bypasses RLS for project-global management.

ALTER TABLE vectors.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE vectors.items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vector_collections_select ON vectors.collections;
CREATE POLICY vector_collections_select ON vectors.collections
  FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS vector_collections_insert ON vectors.collections;
CREATE POLICY vector_collections_insert ON vectors.collections
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vector_collections_delete ON vectors.collections;
CREATE POLICY vector_collections_delete ON vectors.collections
  FOR DELETE USING (owner_id = auth.uid());

DROP POLICY IF EXISTS vector_items_select ON vectors.items;
CREATE POLICY vector_items_select ON vectors.items
  FOR SELECT USING (owner_id = auth.uid());

DROP POLICY IF EXISTS vector_items_insert ON vectors.items;
CREATE POLICY vector_items_insert ON vectors.items
  FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vector_items_update ON vectors.items;
CREATE POLICY vector_items_update ON vectors.items
  FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS vector_items_delete ON vectors.items;
CREATE POLICY vector_items_delete ON vectors.items
  FOR DELETE USING (owner_id = auth.uid());

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT USAGE ON SCHEMA vectors TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON vectors.collections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON vectors.items TO authenticated;
