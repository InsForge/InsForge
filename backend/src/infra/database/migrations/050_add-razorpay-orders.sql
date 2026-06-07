-- Up Migration
--
-- Adds the razorpay_orders table to track runtime one-time payment requests.
--
-- Razorpay's runtime flow for one-time payments requires an Order to be
-- created server-side before the user opens the checkout modal. This table
-- records each order attempt so InsForge can track status, support
-- idempotency, and correlate with incoming webhook events.

CREATE TABLE IF NOT EXISTS payments.razorpay_orders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  environment     TEXT        NOT NULL CHECK (environment IN ('test', 'live')),
  -- InsForge internal tracking fields
  status          TEXT        NOT NULL DEFAULT 'initialized'
                              CHECK (status IN ('initialized', 'created', 'paid', 'attempted', 'failed')),
  subject_type    TEXT,
  subject_id      TEXT,
  customer_id     TEXT,           -- Razorpay customer_id (cust_XXX), if resolved
  customer_email  TEXT,
  idempotency_key TEXT,
  -- Razorpay-returned fields (populated after successful createOrder call)
  order_id        TEXT,           -- Razorpay order ID (order_XXX)
  amount          BIGINT  NOT NULL, -- Amount in smallest currency unit (paise)
  amount_paid     BIGINT  NOT NULL DEFAULT 0,
  amount_due      BIGINT  NOT NULL DEFAULT 0,
  currency        TEXT    NOT NULL DEFAULT 'INR',
  description     TEXT,
  metadata        JSONB   NOT NULL DEFAULT '{}'::JSONB,
  last_error      TEXT,
  raw             JSONB   NOT NULL DEFAULT '{}'::JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_payments_razorpay_orders_updated_at
  ON payments.razorpay_orders;
CREATE TRIGGER trg_payments_razorpay_orders_updated_at
BEFORE UPDATE ON payments.razorpay_orders
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Unique idempotency index — prevents duplicate orders for the same request
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_idempotency
  ON payments.razorpay_orders(environment, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Unique order_id index — allows fast lookup by Razorpay order ID from webhooks
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_order
  ON payments.razorpay_orders(environment, order_id)
  WHERE order_id IS NOT NULL;

-- Subject filtering index — allows listing orders by billing subject
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_subject
  ON payments.razorpay_orders(environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

-- Customer filtering index
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_customer
  ON payments.razorpay_orders(environment, customer_id)
  WHERE customer_id IS NOT NULL;

-- Status filtering index
CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_status
  ON payments.razorpay_orders(environment, status);

-- Runtime RLS: project_admin can insert and read orders (needed for SDK route)
GRANT INSERT, SELECT, UPDATE ON payments.razorpay_orders TO authenticated, project_admin;
GRANT TRIGGER ON TABLE payments.razorpay_orders TO project_admin;
ALTER TABLE payments.razorpay_orders ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS payments.razorpay_subscription_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  idempotency_key TEXT,
  subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, idempotency_key)
);

GRANT INSERT, SELECT, UPDATE ON payments.razorpay_subscription_attempts TO authenticated, project_admin;
ALTER TABLE payments.razorpay_subscription_attempts ENABLE ROW LEVEL SECURITY;

-- Down Migration
DROP TABLE IF EXISTS payments.razorpay_subscription_attempts;
DROP TABLE IF EXISTS payments.razorpay_orders;
