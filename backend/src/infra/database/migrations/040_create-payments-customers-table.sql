-- Migration 040: Create payments customers mirror table.
--
-- This table is an admin-facing mirror of Stripe customer state. It is not used
-- for runtime checkout or portal authorization flows; payments.stripe_customer_mappings
-- remains the operational subject-to-customer bridge.

CREATE TABLE IF NOT EXISTS payments.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_customer_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  phone TEXT,
  deleted BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  stripe_created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_customer_id)
);

CREATE INDEX IF NOT EXISTS idx_payments_customers_environment_deleted
  ON payments.customers(environment, deleted);

CREATE INDEX IF NOT EXISTS idx_payments_customers_environment_email
  ON payments.customers(environment, email)
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_customers_environment_created
  ON payments.customers(environment, stripe_created_at DESC);

DROP TRIGGER IF EXISTS trg_payments_customers_updated_at ON payments.customers;
CREATE TRIGGER trg_payments_customers_updated_at
BEFORE UPDATE ON payments.customers
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
