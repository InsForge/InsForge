-- Migration: 035 - Deduplicate system.secrets and ensure UNIQUE(key).
--
-- Background: some installs have multiple is_active=true rows for the same
-- key value (e.g. two rows with key='API_KEY'), produced when a manual SQL
-- operation or a concurrent boot inserted a row on top of an existing one
-- on a DB that lacked a UNIQUE(key) constraint. With duplicates present,
-- read queries (UPDATE ... WHERE key = $1) match more than one row and
-- Postgres returns them in non-deterministic order, so the same client API
-- key validates as match/mismatch unpredictably and the user perceives the
-- API key as "rotating" without an actual rotation event.
--
-- This migration heals existing duplicates and adds the missing UNIQUE
-- constraint so neither the boot path, a manual psql session, nor a future
-- partial migration can re-create the state. It is idempotent.

-- 1. Collapse duplicates: keep the most recently created row per key,
--    rename the rest with a unique _DUP_<id> suffix and mark them inactive
--    + immediately expired so read paths ignore them but audit history is
--    preserved. Skips rows already in the API_KEY_OLD_* grace-period
--    namespace (those are intentional rotation history).
DO $$
DECLARE
  dup_key TEXT;
BEGIN
  FOR dup_key IN
    SELECT key
    FROM system.secrets
    WHERE key NOT LIKE 'API_KEY_OLD_%'
    GROUP BY key
    HAVING count(*) > 1
  LOOP
    UPDATE system.secrets
    SET key = key || '_DUP_' || id::text,
        is_active = false,
        expires_at = NOW()
    WHERE key = dup_key
      AND id <> (
        -- Prefer a row that the read paths would actually accept
        -- (is_active=true AND not-expired). If none qualifies, fall back
        -- to newest by created_at so we still pick deterministically.
        SELECT id
        FROM system.secrets
        WHERE key = dup_key
        ORDER BY
          CASE
            WHEN is_active = true
             AND (expires_at IS NULL OR expires_at > NOW()) THEN 0
            ELSE 1
          END,
          created_at DESC,
          id DESC
        LIMIT 1
      );
    RAISE NOTICE 'Collapsed duplicates for key=%', dup_key;
  END LOOP;
END $$;

-- 2. Add UNIQUE(key) if missing. Idempotent — checks for an equivalent
--    constraint or unique index on (key) before adding.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'system'
      AND t.relname = 'secrets'
      AND c.contype = 'u'
      AND (
        -- Cast attname (type: name) to text so the comparison against
        -- ARRAY['key'] (type: text[]) doesn't fail with
        -- "operator does not exist: name[] = text[]".
        SELECT array_agg(a.attname::text)
        FROM unnest(c.conkey) ck
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ck
      ) = ARRAY['key']
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_class t ON t.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE n.nspname = 'system'
      AND t.relname = 'secrets'
      AND i.indisunique
      AND i.indisvalid       -- skip indexes still being built / never validated
      AND i.indisready       -- skip indexes not yet ready for inserts
      AND i.indpred IS NULL  -- not a partial index (would skip rows)
      AND i.indexprs IS NULL -- not an expression index (different semantics)
      AND i.indnkeyatts = 1  -- single-column index
      AND a.attname = 'key'
  ) THEN
    ALTER TABLE system.secrets ADD CONSTRAINT secrets_key_unique UNIQUE (key);
    RAISE NOTICE 'Added UNIQUE constraint secrets_key_unique on system.secrets(key)';
  END IF;
END $$;
