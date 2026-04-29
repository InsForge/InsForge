-- Migration 038: Create payments schema for Stripe catalog and runtime state.
--
-- Stripe remains the source of truth. These tables store the minimal mirror and
-- runtime projections needed for agents and the dashboard to reason about
-- Stripe connection status, catalog data, checkout outcomes, subscriptions, and
-- webhook processing.

CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS payments.stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_account_id TEXT,
  stripe_account_email TEXT,
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

ALTER TABLE payments.stripe_connections
  ADD COLUMN IF NOT EXISTS webhook_endpoint_id TEXT;

ALTER TABLE payments.stripe_connections
  ADD COLUMN IF NOT EXISTS webhook_endpoint_url TEXT;

ALTER TABLE payments.stripe_connections
  ADD COLUMN IF NOT EXISTS webhook_configured_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS payments.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL,
  default_price_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_product_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_products_environment_active
  ON payments.products(environment, active);

CREATE TABLE IF NOT EXISTS payments.prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_price_id TEXT NOT NULL,
  stripe_product_id TEXT,
  active BOOLEAN NOT NULL,
  currency TEXT NOT NULL,
  unit_amount BIGINT,
  unit_amount_decimal TEXT,
  type TEXT NOT NULL,
  lookup_key TEXT,
  billing_scheme TEXT,
  tax_behavior TEXT,
  recurring_interval TEXT,
  recurring_interval_count INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_price_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_prices_environment_product
  ON payments.prices(environment, stripe_product_id);

CREATE INDEX IF NOT EXISTS idx_payments_prices_environment_lookup_key
  ON payments.prices(environment, lookup_key)
  WHERE lookup_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments.stripe_customer_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  customer_email_snapshot TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, subject_type, subject_id),
  UNIQUE (environment, stripe_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_customer_mappings_environment_subject
  ON payments.stripe_customer_mappings(environment, subject_type, subject_id);

CREATE TABLE IF NOT EXISTS payments.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  stripe_customer_id TEXT,
  customer_email_snapshot TEXT,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_invoice_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  stripe_subscription_id TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  amount BIGINT,
  amount_refunded BIGINT,
  currency TEXT,
  description TEXT,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_payment_history_environment_subject
  ON payments.payment_history(environment, subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_payments_payment_history_environment_customer
  ON payments.payment_history(environment, stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_payment_history_environment_created
  ON payments.payment_history(environment, stripe_created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_history_environment_payment_intent
  ON payments.payment_history(environment, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL
    AND type <> 'refund';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_history_environment_invoice
  ON payments.payment_history(environment, stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL
    AND type <> 'refund';

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_history_environment_refund
  ON payments.payment_history(environment, stripe_refund_id)
  WHERE stripe_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_subscription_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  latest_invoice_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_subscriptions_environment_subject
  ON payments.subscriptions(environment, subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_payments_subscriptions_environment_customer
  ON payments.subscriptions(environment, stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_payments_subscriptions_environment_status
  ON payments.subscriptions(environment, status);

CREATE TABLE IF NOT EXISTS payments.subscription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_subscription_item_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  quantity BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_subscription_item_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_subscription_items_environment_subscription
  ON payments.subscription_items(environment, stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_payments_subscription_items_environment_price
  ON payments.subscription_items(environment, stripe_price_id)
  WHERE stripe_price_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  stripe_account_id TEXT,
  object_type TEXT,
  object_id TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'failed', 'ignored')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_event_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_webhook_events_environment_status
  ON payments.webhook_events(environment, processing_status);

CREATE INDEX IF NOT EXISTS idx_payments_webhook_events_environment_object
  ON payments.webhook_events(environment, object_type, object_id)
  WHERE object_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_stripe_connections_updated_at ON payments.stripe_connections;
CREATE TRIGGER trg_payments_stripe_connections_updated_at
BEFORE UPDATE ON payments.stripe_connections
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_products_updated_at ON payments.products;
CREATE TRIGGER trg_payments_products_updated_at
BEFORE UPDATE ON payments.products
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_prices_updated_at ON payments.prices;
CREATE TRIGGER trg_payments_prices_updated_at
BEFORE UPDATE ON payments.prices
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_stripe_customer_mappings_updated_at ON payments.stripe_customer_mappings;
CREATE TRIGGER trg_payments_stripe_customer_mappings_updated_at
BEFORE UPDATE ON payments.stripe_customer_mappings
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_payment_history_updated_at ON payments.payment_history;
CREATE TRIGGER trg_payments_payment_history_updated_at
BEFORE UPDATE ON payments.payment_history
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_subscriptions_updated_at ON payments.subscriptions;
CREATE TRIGGER trg_payments_subscriptions_updated_at
BEFORE UPDATE ON payments.subscriptions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_subscription_items_updated_at ON payments.subscription_items;
CREATE TRIGGER trg_payments_subscription_items_updated_at
BEFORE UPDATE ON payments.subscription_items
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_webhook_events_updated_at ON payments.webhook_events;
CREATE TRIGGER trg_payments_webhook_events_updated_at
BEFORE UPDATE ON payments.webhook_events
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
