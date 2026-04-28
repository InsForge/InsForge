-- Migration 036: Create lightweight payments schema for Stripe catalog mirror.
--
-- Stripe remains the source of truth. These tables store the minimal mirror
-- needed for agents and the dashboard to reason about Stripe connection status,
-- products, and prices.

CREATE SCHEMA IF NOT EXISTS payments;

CREATE TABLE IF NOT EXISTS payments.stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_account_id TEXT,
  stripe_account_email TEXT,
  account_livemode BOOLEAN,
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured', 'connected', 'error')),
  last_synced_at TIMESTAMPTZ,
  last_sync_status TEXT CHECK (last_sync_status IS NULL OR last_sync_status IN ('succeeded', 'failed')),
  last_sync_error TEXT,
  last_sync_counts JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment)
);

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
