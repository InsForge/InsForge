-- Migration 024: Create Database Webhooks
--
-- Creates the system tables for user-defined database webhooks:
-- 1. _database_webhooks — webhook configurations (table + event + url)
-- 2. _database_webhook_logs — delivery history per webhook
-- 3. notify_database_webhook() — trigger function using pg_notify
--
-- When a webhook is created via the API, the backend dynamically creates
-- a PostgreSQL trigger on the target table that calls pg_notify. The backend
-- LISTEN loop picks up notifications and fires HTTP POST to the configured URL.

-- ============================================================================
-- WEBHOOKS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS _database_webhooks (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT        NOT NULL,
  table_name  TEXT        NOT NULL,
  events      TEXT[]      NOT NULL CHECK (
                events <@ ARRAY['INSERT','UPDATE','DELETE']::TEXT[]
                AND array_length(events, 1) > 0
              ),
  url         TEXT        NOT NULL,
  secret      TEXT,                     -- HMAC-SHA256 signing secret (nullable = no signature)
  enabled     BOOLEAN     DEFAULT TRUE  NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_webhooks_table ON _database_webhooks(table_name);
CREATE INDEX IF NOT EXISTS idx_db_webhooks_enabled ON _database_webhooks(enabled);

-- ============================================================================
-- WEBHOOK DELIVERY LOGS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS _database_webhook_logs (
  id          UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  webhook_id  UUID        NOT NULL REFERENCES _database_webhooks(id) ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,  -- INSERT | UPDATE | DELETE
  table_name  TEXT        NOT NULL,
  payload     JSONB       NOT NULL,
  status_code INTEGER,               -- HTTP response code (NULL = network error)
  error       TEXT,                  -- error message if delivery failed
  success     BOOLEAN     NOT NULL,
  delivered_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_webhook_logs_webhook_id ON _database_webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_db_webhook_logs_delivered_at ON _database_webhook_logs(delivered_at DESC);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

DROP TRIGGER IF EXISTS trg_database_webhooks_updated_at ON _database_webhooks;
CREATE TRIGGER trg_database_webhooks_updated_at
  BEFORE UPDATE ON _database_webhooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- PG_NOTIFY TRIGGER FUNCTION
-- ============================================================================
-- This function is attached to user tables by the backend when a webhook is
-- created. It fires pg_notify('db_webhook', json_payload) so the backend
-- listener can dispatch the HTTP call.
--
-- Channel name: 'db_webhook'
-- Payload: JSON string with event, table, record, old_record

CREATE OR REPLACE FUNCTION notify_database_webhook()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSONB;
  v_record  JSONB;
  v_old     JSONB;
BEGIN
  -- Build record/old_record based on event type
  IF TG_OP = 'INSERT' THEN
    v_record := to_jsonb(NEW);
    v_old    := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_record := to_jsonb(NEW);
    v_old    := to_jsonb(OLD);
  ELSIF TG_OP = 'DELETE' THEN
    v_record := NULL;
    v_old    := to_jsonb(OLD);
  END IF;

  v_payload := jsonb_build_object(
    'event',      TG_OP,
    'table',      TG_TABLE_NAME,
    'record',     v_record,
    'old_record', v_old
  );

  -- pg_notify has an 8KB payload limit; truncate if needed
  PERFORM pg_notify('db_webhook', v_payload::text);

  -- Return appropriate row
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;
