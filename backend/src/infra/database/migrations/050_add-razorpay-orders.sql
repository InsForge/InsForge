-- Up Migration
--
-- Adds the razorpay_orders table to track runtime one-time payment requests.
--
-- Razorpay's runtime flow for one-time payments requires an Order to be
-- created server-side before the user opens the checkout modal. This table
-- records each order attempt so InsForge can track status, support
-- idempotency, and correlate with incoming webhook events.

ALTER TABLE payments.razorpay_orders
  ADD COLUMN IF NOT EXISTS customer_id TEXT,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

-- Unique idempotency index — prevents duplicate orders for the same request
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_idempotency
  ON payments.razorpay_orders(environment, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Customer filtering index
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_customer
  ON payments.razorpay_orders(environment, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payments.razorpay_subscription_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  idempotency_key TEXT,
  subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, idempotency_key)
);

GRANT INSERT, SELECT, UPDATE, DELETE ON payments.razorpay_subscription_attempts TO authenticated, project_admin;
ALTER TABLE payments.razorpay_subscription_attempts ENABLE ROW LEVEL SECURITY;

-- Down Migration
DROP TABLE IF EXISTS payments.razorpay_subscription_attempts;
DROP TABLE IF EXISTS payments.razorpay_orders;
