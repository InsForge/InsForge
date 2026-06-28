-- ============================================================================
-- Migration 058: Key-Value store schema (Redis-like, Postgres-backed)
-- Managed schema provisioned in every project, like memory.* / realtime.*.
-- Stores arbitrary JSON addressed by (namespace, key), with TTL and
-- owner-scoped Row Level Security for end-user access.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS kv;

CREATE TABLE IF NOT EXISTS kv.entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace   TEXT NOT NULL DEFAULT 'default',
  key         TEXT NOT NULL,
  value       JSONB NOT NULL,
  -- NULL owner = project-global entry (managed via the project API key).
  -- A set owner = an end-user-owned entry, gated by RLS on auth.uid().
  owner_id    UUID,
  visibility  TEXT NOT NULL DEFAULT 'private'
              CHECK (visibility IN ('private', 'authed', 'public')),
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- (namespace, key) is unique per owner. NULLs are distinct in a plain UNIQUE,
-- so collapse NULL owners onto a sentinel to keep project-global keys unique.
CREATE UNIQUE INDEX IF NOT EXISTS uq_kv_entries_owner_ns_key
  ON kv.entries (namespace, key, COALESCE(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX IF NOT EXISTS idx_kv_entries_lookup ON kv.entries (namespace, key);
-- Partial index supports the TTL sweep without bloating it with non-expiring rows.
CREATE INDEX IF NOT EXISTS idx_kv_entries_expires_at
  ON kv.entries (expires_at) WHERE expires_at IS NOT NULL;

-- Keep updated_at fresh on UPDATE.
DROP TRIGGER IF EXISTS trg_kv_entries_updated_at ON kv.entries;
CREATE TRIGGER trg_kv_entries_updated_at
BEFORE UPDATE ON kv.entries
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
-- End-user requests run as `authenticated`/`anon` (via withUserContext) and are
-- gated here. The backend's API-key/admin path connects as the superuser pool
-- role, which bypasses RLS and sees every row (project-global management).

ALTER TABLE kv.entries ENABLE ROW LEVEL SECURITY;

-- Read: own rows, anything public, and 'authed' rows for any signed-in user.
DROP POLICY IF EXISTS kv_entries_select ON kv.entries;
CREATE POLICY kv_entries_select ON kv.entries
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR visibility = 'public'
    OR (visibility = 'authed' AND auth.uid() IS NOT NULL)
  );

-- Writes are always owner-only; owner_id must match the caller's identity.
DROP POLICY IF EXISTS kv_entries_insert ON kv.entries;
CREATE POLICY kv_entries_insert ON kv.entries
  FOR INSERT
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS kv_entries_update ON kv.entries;
CREATE POLICY kv_entries_update ON kv.entries
  FOR UPDATE
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS kv_entries_delete ON kv.entries;
CREATE POLICY kv_entries_delete ON kv.entries
  FOR DELETE
  USING (owner_id = auth.uid());

-- ============================================================================
-- GRANTS
-- ============================================================================
GRANT USAGE ON SCHEMA kv TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON kv.entries TO authenticated;
-- Anonymous callers can only read (RLS further limits them to public rows).
GRANT SELECT ON kv.entries TO anon;
