-- Migration 017: Create Realtime Schema
--
-- Creates the insforge_realtime schema with:
-- 1. channels table - Channel definitions with webhook configuration
-- 2. usage table - Audit log of all events with delivery statistics
-- 3. send() function - Called by developer triggers to send events

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS insforge_realtime;

-- ============================================================================
-- CHANNELS TABLE
-- ============================================================================
-- Stores channel definitions with delivery configuration.
-- RLS policies control join/send permissions.
-- Channel names use : as separator and % for wildcards (LIKE pattern).
-- Examples: "orders", "order:%", "chat:%:messages"

CREATE TABLE IF NOT EXISTS insforge_realtime.channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Channel name pattern (e.g., "orders", "order:%", "chat:%:messages")
  -- Convention: use : as separator, % for wildcards (LIKE pattern)
  name TEXT UNIQUE NOT NULL,

  -- Human-readable description
  description TEXT,

  -- Webhook URLs to POST events to (NULL or empty array = no webhooks)
  webhook_urls TEXT[],

  -- Whether this channel is active
  enabled BOOLEAN DEFAULT TRUE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- USAGE TABLE (Audit Log)
-- ============================================================================
-- Tracks all events sent through the realtime system.
-- All events here are system-triggered (from database triggers).

CREATE TABLE IF NOT EXISTS insforge_realtime.usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Event metadata
  event_name TEXT NOT NULL,

  -- Channel reference (SET NULL on delete to preserve history)
  channel_id UUID REFERENCES insforge_realtime.channels(id) ON DELETE SET NULL,
  channel_name TEXT NOT NULL, -- Denormalized for query convenience after channel deletion

  -- Delivery statistics for WebSocket
  ws_audience_count INTEGER DEFAULT 0 NOT NULL, -- How many clients were subscribed

  -- Delivery statistics for Webhooks
  wh_audience_count INTEGER DEFAULT 0 NOT NULL, -- How many webhook URLs configured
  wh_delivered_count INTEGER DEFAULT 0 NOT NULL, -- How many succeeded (2xx response)

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_realtime_channels_name ON insforge_realtime.channels(name);
CREATE INDEX IF NOT EXISTS idx_realtime_channels_enabled ON insforge_realtime.channels(enabled);
CREATE INDEX IF NOT EXISTS idx_realtime_usage_channel_id ON insforge_realtime.usage(channel_id);
CREATE INDEX IF NOT EXISTS idx_realtime_usage_created_at ON insforge_realtime.usage(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_usage_event_name ON insforge_realtime.usage(event_name);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION insforge_realtime.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channels_updated_at ON insforge_realtime.channels;
CREATE TRIGGER trg_channels_updated_at
BEFORE UPDATE ON insforge_realtime.channels
FOR EACH ROW EXECUTE FUNCTION insforge_realtime.update_updated_at();

-- ============================================================================
-- ENABLE RLS
-- ============================================================================

ALTER TABLE insforge_realtime.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE insforge_realtime.usage ENABLE ROW LEVEL SECURITY;

-- Admin can manage all channels
CREATE POLICY "admin_full_access_channels" ON insforge_realtime.channels
  FOR ALL USING (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );

-- Admin can view all usage records
CREATE POLICY "admin_read_usage" ON insforge_realtime.usage
  FOR SELECT USING (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );

-- ============================================================================
-- SEND FUNCTION
-- ============================================================================
-- Called by developer triggers to send events to channels.
-- This function can only be executed by the backend (SECURITY DEFINER).
--
-- Usage in a trigger:
--   PERFORM insforge_realtime.send(
--     'order:' || NEW.id::text,  -- channel name (resolved instance)
--     'order_updated',           -- event name
--     jsonb_build_object('id', NEW.id, 'status', NEW.status)  -- payload
--   );

CREATE OR REPLACE FUNCTION insforge_realtime.send(
  p_channel_name TEXT,
  p_event_name TEXT,
  p_payload JSONB
)
RETURNS UUID AS $$
DECLARE
  v_channel_id UUID;
  v_message_id UUID;
BEGIN
  -- Channel name convention: segments separated by ':'
  -- Wildcard segments use % syntax (LIKE pattern), e.g., "order:%"

  -- First, try exact match (no wildcards in pattern)
  SELECT id INTO v_channel_id
  FROM insforge_realtime.channels
  WHERE name = p_channel_name AND enabled = TRUE
  LIMIT 1;

  -- If no exact match, try pattern matching for wildcards
  -- Channel patterns use % for wildcards, e.g., "order:%" matches "order:123"
  IF v_channel_id IS NULL THEN
    SELECT id INTO v_channel_id
    FROM insforge_realtime.channels
    WHERE enabled = TRUE
      AND name LIKE '%\%%' ESCAPE '\'
      AND p_channel_name LIKE name
    LIMIT 1;
  END IF;

  -- If still no channel found, raise a warning and return NULL
  IF v_channel_id IS NULL THEN
    RAISE WARNING 'Realtime: No matching channel found for "%"', p_channel_name;
    RETURN NULL;
  END IF;

  -- Insert usage record (sender_type is always 'system' for DB triggers)
  INSERT INTO insforge_realtime.usage (
    event_name,
    channel_id,
    channel_name
  ) VALUES (
    p_event_name,
    v_channel_id,
    p_channel_name
  )
  RETURNING id INTO v_message_id;

  -- Send notification to event emitter
  PERFORM pg_notify('insforge_realtime', jsonb_build_object(
    'message_id', v_message_id,
    'channel_id', v_channel_id,
    'channel_name', p_channel_name,
    'event_name', p_event_name,
    'payload', p_payload
  )::text);

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public, only backend can call this
REVOKE ALL ON FUNCTION insforge_realtime.send FROM PUBLIC;

-- Grant usage on schema to authenticated (for RLS policy checks)
GRANT USAGE ON SCHEMA insforge_realtime TO authenticated;
