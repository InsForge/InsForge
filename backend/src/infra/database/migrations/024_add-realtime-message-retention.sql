SET search_path = public, system, "$user";

-- Migration 024: Add Realtime Message Retention
--
-- Adds automatic cleanup mechanism for realtime.messages table.
-- Creates a SQL function to prune old messages based on retention policy.

-- ============================================================================
-- CONFIGURATION TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS realtime.config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  retention_days INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Ensure only one row exists (singleton pattern)
CREATE UNIQUE INDEX IF NOT EXISTS idx_realtime_config_singleton ON realtime.config ((1));

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
  v_total_deleted INT := 0;
BEGIN
  -- Get retention days from realtime.config, fallback to 30
  SELECT COALESCE(retention_days, 30) INTO v_retention_days
  FROM realtime.config LIMIT 1;
  
  -- Handle "Never" (e.g. NULL or < 0)
  IF v_retention_days IS NULL OR v_retention_days < 0 THEN
    RETURN 0;
  END IF;
  
  -- Calculate cutoff time
  v_cutoff := NOW() - (v_retention_days || ' days')::INTERVAL;
  
  LOOP
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
    
    v_total_deleted := v_total_deleted + v_deleted_count;
    
    -- Exit loop if no rows deleted or batch not full
    EXIT WHEN v_deleted_count < p_batch_size;
  END LOOP;
  
  RETURN v_total_deleted;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'realtime.cleanup_messages failed: %', SQLERRM;
  RETURN v_total_deleted;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, system, "$user";

-- Revoke execute from public, only superuser/backend can call this
REVOKE ALL ON FUNCTION realtime.cleanup_messages FROM PUBLIC;

-- ============================================================================
-- SEED CONFIGURATION
-- ============================================================================
-- Insert default retention period (30 days)

INSERT INTO realtime.config (retention_days)
SELECT 30
WHERE NOT EXISTS (SELECT 1 FROM realtime.config);

-- ============================================================================
-- SCHEDULE CLEANUP
-- ============================================================================
-- Schedule the cleanup function to run daily at midnight using pg_cron.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command = 'SELECT realtime.cleanup_messages()') THEN
    PERFORM cron.schedule('0 0 * * *', 'SELECT realtime.cleanup_messages()');
  END IF;
END $$;
