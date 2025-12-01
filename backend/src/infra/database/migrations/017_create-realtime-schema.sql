-- Migration 017: Create Realtime Schema
--
-- Creates the insforge_realtime schema with:
-- 1. channels table - Channel definitions with webhook configuration
-- 2. messages table - All realtime messages with delivery statistics (RLS for permissions)
-- 3. publish() function - Called by developer triggers to publish events
--
-- Permission Model (Supabase pattern):
-- - SELECT on messages = 'subscribe' permission (subscribe to channel)
-- - INSERT on messages = 'publish' permission (publish to channel)
-- Developers define RLS policies on messages table to control access.

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
-- MESSAGES TABLE
-- ============================================================================
-- Stores all realtime messages published through the system.
-- RLS policies on this table control subscribe/publish permissions:
-- - SELECT policy = 'subscribe' permission (can subscribe to channel)
-- - INSERT policy = 'publish' permission (can publish to channel)
--
-- Developers define policies checking:
-- - current_setting('request.jwt.claim.sub', true) = user ID
-- - current_setting('request.jwt.claim.role', true) = user role
-- - channel_name for channel-specific access

CREATE TABLE IF NOT EXISTS insforge_realtime.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Event metadata
  event_name TEXT NOT NULL,

  -- Channel reference (SET NULL on delete to preserve history)
  channel_id UUID REFERENCES insforge_realtime.channels(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_realtime_channels_name ON insforge_realtime.channels(name);
CREATE INDEX IF NOT EXISTS idx_realtime_channels_enabled ON insforge_realtime.channels(enabled);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_channel_id ON insforge_realtime.messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_channel_name ON insforge_realtime.messages(channel_name);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_created_at ON insforge_realtime.messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_event_name ON insforge_realtime.messages(event_name);
CREATE INDEX IF NOT EXISTS idx_realtime_messages_sender ON insforge_realtime.messages(sender_type, sender_id);

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
ALTER TABLE insforge_realtime.messages ENABLE ROW LEVEL SECURITY;

-- Admin can manage all channels
CREATE POLICY "admin_full_access_channels" ON insforge_realtime.channels
  FOR ALL USING (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );

-- Admin can view all messages
CREATE POLICY "admin_read_messages" ON insforge_realtime.messages
  FOR SELECT USING (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );

-- Admin can insert messages (for system operations)
CREATE POLICY "admin_insert_messages" ON insforge_realtime.messages
  FOR INSERT WITH CHECK (
    current_setting('request.jwt.claim.role', true) = 'project_admin'
  );

-- ============================================================================
-- PERMISSION POLICIES (Example - Developers extend these)
-- ============================================================================
-- The backend sets these session variables before permission checks:
-- - request.jwt.claim.sub = user ID
-- - request.jwt.claim.role = user role
-- - realtime.channel_name = channel being accessed
--
-- To check 'subscribe' permission: SELECT with matching channel_name
-- To check 'publish' permission: INSERT with matching channel_name
--
-- Example developer policies (not created here, just for reference):
--
-- Allow authenticated users to subscribe (SELECT) to public channels:
-- CREATE POLICY "authenticated_subscribe_public" ON insforge_realtime.messages
--   FOR SELECT USING (
--     current_setting('request.jwt.claim.role', true) = 'authenticated'
--     AND channel_name = current_setting('realtime.channel_name', true)
--   );
--
-- Allow users to publish (INSERT) to their own channels:
-- CREATE POLICY "user_publish_own_channel" ON insforge_realtime.messages
--   FOR INSERT WITH CHECK (
--     channel_name LIKE 'user:' || current_setting('request.jwt.claim.sub', true) || ':%'
--   );

-- ============================================================================
-- PUBLISH FUNCTION
-- ============================================================================
-- Called by developer triggers to publish events to channels.
-- This function can only be executed by the backend (SECURITY DEFINER).
--
-- Usage in a trigger:
--   PERFORM insforge_realtime.publish(
--     'order:' || NEW.id::text,  -- channel name (resolved instance)
--     'order_updated',           -- event name
--     jsonb_build_object('id', NEW.id, 'status', NEW.status)  -- payload
--   );

CREATE OR REPLACE FUNCTION insforge_realtime.publish(
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
  FROM insforge_realtime.channels
  WHERE enabled = TRUE
    AND (name = p_channel_name OR p_channel_name LIKE name)
  ORDER BY name = p_channel_name DESC
  LIMIT 1;

  -- If no channel found, raise a warning and return NULL
  IF v_channel_id IS NULL THEN
    RAISE WARNING 'Realtime: No matching channel found for "%"', p_channel_name;
    RETURN NULL;
  END IF;

  -- Insert message record (system-triggered, so sender_type = 'system')
  INSERT INTO insforge_realtime.messages (
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

  -- Publish notification to event emitter
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
REVOKE ALL ON FUNCTION insforge_realtime.publish FROM PUBLIC;

-- Grant usage on schema to authenticated (for RLS policy checks)
GRANT USAGE ON SCHEMA insforge_realtime TO authenticated;
