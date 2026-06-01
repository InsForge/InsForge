-- Up Migration

CREATE TABLE IF NOT EXISTS payments.razorpay_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  razorpay_account_id TEXT,
  razorpay_merchant_name TEXT,
  account_livemode BOOLEAN,
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured', 'connected', 'error')),
  webhook_endpoint_id TEXT,
  webhook_endpoint_url TEXT,
  webhook_configured_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IS NULL OR last_sync_status IN ('succeeded', 'failed')),
  last_sync_error TEXT,
  last_sync_counts JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment)
);

DROP TRIGGER IF EXISTS trg_payments_razorpay_connections_updated_at ON payments.razorpay_connections;
CREATE TRIGGER trg_payments_razorpay_connections_updated_at
BEFORE UPDATE ON payments.razorpay_connections
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT SELECT ON payments.razorpay_connections TO project_admin;

-- Webhook event log for idempotency (mirrors payments.stripe_webhook_events)
CREATE TABLE IF NOT EXISTS payments.razorpay_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_status IN ('pending', 'processed', 'failed', 'ignored')),
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, event_id)
);

DROP TRIGGER IF EXISTS trg_payments_razorpay_webhook_events_updated_at ON payments.razorpay_webhook_events;
CREATE TRIGGER trg_payments_razorpay_webhook_events_updated_at
BEFORE UPDATE ON payments.razorpay_webhook_events
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT SELECT ON payments.razorpay_webhook_events TO project_admin;

-- Down Migration

DROP TABLE IF EXISTS payments.razorpay_webhook_events;
DROP TABLE IF EXISTS payments.razorpay_connections;

