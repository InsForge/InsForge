-- Migration 017: Create Realtime Schema
--
-- Creates the realtime schema with:
-- 1. channels table - Channel definitions with webhook configuration
-- 2. messages table - All realtime messages with delivery statistics
-- 3. publish() function - Called by developer triggers to publish events
--
-- Permission Model (Supabase pattern):
-- - SELECT on channels = 'subscribe' permission (subscribe to channel)
-- - INSERT on messages = 'publish' permission (publish to channel)
-- Developers define RLS policies on channels/messages table to control access.

-- ============================================================================
-- CREATE SCHEMA
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS realtime;

-- ============================================================================
-- CHANNELS TABLE
-- ============================================================================
-- Stores channel definitions with delivery configuration.
-- RLS policies control subscribe permissions.
-- - SELECT policy = 'subscribe' permission (can subscribe to channel)
-- Channel names use : as separator and % for wildcards (LIKE pattern).
-- Examples: "orders", "order:%", "chat:%:messages"

CREATE TABLE IF NOT EXISTS realtime.channels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Channel name pattern (e.g., "orders", "order:%", "chat:%:messages")
  -- Convention: use : as separator, % for wildcards (LIKE pattern)
  pattern TEXT UNIQUE NOT NULL,

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
-- MESSAGES TABLE
-- ============================================================================
-- Stores all realtime messages published through the system.
-- RLS policies on this table control publish permissions:
-- - INSERT policy = 'publish' permission (can publish to channel)

CREATE TABLE IF NOT EXISTS realtime.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Event metadata
  event_name TEXT NOT NULL,

  -- Channel reference (SET NULL on delete to preserve history)
  channel_id UUID REFERENCES realtime.channels(id) ON DELETE SET NULL,
  channel_name TEXT NOT NULL, -- Denormalized for query convenience after channel deletion

  -- Event payload (stored for audit/replay purposes)
  payload JSONB DEFAULT '{}'::jsonb NOT NULL,

  -- Sender information
  -- 'system' = triggered by database trigger (via publish() function)
  -- 'user' = published by client via WebSocket
  sender_type TEXT DEFAULT 'system' NOT NULL CHECK (sender_type IN ('system', 'user')),
  sender_id UUID, -- User ID for 'user' type, NULL for 'system' type

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

CREATE INDEX IF NOT EXISTS idx_realtime_channels_pattern ON realtime.channels(pattern);
CREATE INDEX IF NOT EXISTS idx_realtime_channels_enabled ON realtime.channels(enabled);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_channel_id ON realtime.messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_channel_name ON realtime.messages(channel_name);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_created_at ON realtime.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_event_name ON realtime.messages(event_name);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_sender ON realtime.messages(sender_type, sender_id);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION realtime.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_channels_updated_at ON realtime.channels;
CREATE TRIGGER trg_channels_updated_at
BEFORE UPDATE ON realtime.channels
FOR EACH ROW EXECUTE FUNCTION realtime.update_updated_at();

-- ============================================================================
-- ENABLE RLS
-- ============================================================================

ALTER TABLE realtime.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- HELPER FUNCTIONS FOR RLS POLICIES
-- ============================================================================

-- Returns the channel name being accessed (set by backend during permission checks)
-- Developers use this in policies instead of writing current_setting directly
CREATE OR REPLACE FUNCTION realtime.channel_name()
RETURNS TEXT AS $$
  SELECT current_setting('realtime.channel_name', true);
$$ LANGUAGE SQL STABLE;

-- ============================================================================
-- PUBLISH FUNCTION
-- ============================================================================
-- Called by developer triggers to publish events to channels.
-- This function can only be executed by the backend (SECURITY DEFINER).
--
-- Usage in a trigger:
--   PERFORM realtime.publish(
--     'order:' || NEW.id::text,  -- channel name (resolved instance)
--     'order_updated',           -- event name
--     jsonb_build_object('id', NEW.id, 'status', NEW.status)  -- payload
--   );

CREATE OR REPLACE FUNCTION realtime.publish(
  p_channel_name TEXT,
  p_event_name TEXT,
  p_payload JSONB
)
RETURNS UUID AS $$
DECLARE
  v_channel_id UUID;
  v_message_id UUID;
BEGIN
  -- Find matching channel: exact match first, then wildcard pattern match
  -- For wildcard patterns like "order:%", check if p_channel_name LIKE pattern
  SELECT id INTO v_channel_id
  FROM realtime.channels
  WHERE enabled = TRUE
    AND (pattern = p_channel_name OR p_channel_name LIKE pattern)
  ORDER BY pattern = p_channel_name DESC
  LIMIT 1;

  -- If no channel found, raise a warning and return NULL
  IF v_channel_id IS NULL THEN
    RAISE WARNING 'Realtime: No matching channel found for "%"', p_channel_name;
    RETURN NULL;
  END IF;

  -- Insert message record (system-triggered, so sender_type = 'system')
  INSERT INTO realtime.messages (
    event_name,
    channel_id,
    channel_name,
    payload,
    sender_type
  ) VALUES (
    p_event_name,
    v_channel_id,
    p_channel_name,
    p_payload,
    'system'
  )
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public, only backend can call this
REVOKE ALL ON FUNCTION realtime.publish FROM PUBLIC;

-- ============================================================================
-- TRIGGER FOR PG_NOTIFY
-- ============================================================================
-- Trigger function that sends pg_notify for every new message (both system and client).

CREATE OR REPLACE FUNCTION realtime.notify_on_message_insert()
RETURNS TRIGGER AS $$
BEGIN
  -- Send notification to backend listener
  PERFORM pg_notify('realtime', jsonb_build_object(
    'message_id', NEW.id,
    'channel_id', NEW.channel_id,
    'channel_name', NEW.channel_name,
    'event_name', NEW.event_name,
    'payload', NEW.payload
  )::text);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on messages table
DROP TRIGGER IF EXISTS trg_message_notify ON realtime.messages;
CREATE TRIGGER trg_message_notify
  AFTER INSERT ON realtime.messages
  FOR EACH ROW
  EXECUTE FUNCTION realtime.notify_on_message_insert();

-- ============================================================================
-- GRANTS FOR RLS PERMISSION CHECKS
-- ============================================================================

-- Grant schema access to both authenticated and anonymous users
GRANT USAGE ON SCHEMA realtime TO authenticated, anon;

-- Grant SELECT on channels table (RLS will filter which channels they can see)
GRANT SELECT ON realtime.channels TO authenticated, anon;

-- Grant INSERT on messages table (RLS will filter who can publish to which channels)
GRANT INSERT ON realtime.messages TO authenticated, anon;

-- Grant execution permission on helper function (used in RLS policies)
GRANT EXECUTE ON FUNCTION realtime.channel_name() TO authenticated, anon;
