SET search_path = public, system, "$user";

-- Migration 024: Add Realtime Message Retention
--
-- Adds automatic cleanup mechanism for realtime.messages table.
-- Creates a SQL function to prune old messages based on retention policy.

-- ============================================================================
-- CONFIGURATION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS realtime.config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- CLEANUP FUNCTION
-- ============================================================================
-- Deletes messages older than the configured retention period.
-- Default retention is 30 days if not set in realtime.config.
-- Deletes in batches to prevent performance impact.

CREATE OR REPLACE FUNCTION realtime.cleanup_messages(p_batch_size INT DEFAULT 1000)
RETURNS INT AS $$
DECLARE
  v_retention_days INT;
  v_cutoff TIMESTAMPTZ;
  v_deleted_count INT := 0;
BEGIN
  -- Get retention days from realtime.config, fallback to 30
  -- Using COALESCE to handle NULL or missing config row
  SELECT COALESCE(value::INT, 30) INTO v_retention_days
  FROM realtime.config WHERE key = 'realtime_retention_days';
  
  -- Calculate cutoff time
  v_cutoff := NOW() - (v_retention_days || ' days')::INTERVAL;
  
  -- Delete batch ordered by created_at ASC to prune oldest first
  WITH deleted AS (
    DELETE FROM realtime.messages
    WHERE id IN (
      SELECT id FROM realtime.messages
      WHERE created_at < v_cutoff
      ORDER BY created_at ASC
      LIMIT p_batch_size
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_count FROM deleted;
  
  RETURN v_deleted_count;
EXCEPTION WHEN OTHERS THEN
  -- Log error or raise warning but return 0 to prevent scheduled job failure cascading
  RAISE WARNING 'realtime.cleanup_messages failed: %', SQLERRM;
  RETURN 0;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, system, "$user";

-- Revoke execute from public, only superuser/backend can call this
REVOKE ALL ON FUNCTION realtime.cleanup_messages FROM PUBLIC;

-- ============================================================================
-- SEED CONFIGURATION
-- ============================================================================
-- Insert default retention period (30 days)

INSERT INTO realtime.config (key, value)
VALUES ('realtime_retention_days', '30')
ON CONFLICT (key) DO NOTHING;
