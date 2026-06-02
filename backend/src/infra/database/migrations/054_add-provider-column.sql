-- Migration 054: Add provider discriminator column to shared payment tables.
--
-- Fermionic-Lyu review: Razorpay and Stripe data must be explicitly tagged so
-- that list/sync/cleanup paths can be provider-scoped. Relying on ID prefixes
-- (plan_, item_, sub_) or raw JSON shape is too fragile.
--
-- This migration adds a NOT NULL TEXT column `provider` to every shared
-- payment mirror table.  Existing rows are back-filled to 'stripe' so that
-- the Stripe sync service keeps working without any other change.

-- ── products ─────────────────────────────────────────────────────────────────
ALTER TABLE payments.products
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'razorpay'));


CREATE INDEX IF NOT EXISTS idx_payments_products_provider
  ON payments.products(environment, provider);

-- ── prices ───────────────────────────────────────────────────────────────────
ALTER TABLE payments.prices
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'razorpay'));


CREATE INDEX IF NOT EXISTS idx_payments_prices_provider
  ON payments.prices(environment, provider);

-- ── customers ────────────────────────────────────────────────────────────────
ALTER TABLE payments.customers
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'razorpay'));


CREATE INDEX IF NOT EXISTS idx_payments_customers_provider
  ON payments.customers(environment, provider);

-- ── subscriptions ─────────────────────────────────────────────────────────────
ALTER TABLE payments.subscriptions
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'razorpay'));


CREATE INDEX IF NOT EXISTS idx_payments_subscriptions_provider
  ON payments.subscriptions(environment, provider);

-- ── subscription_items ───────────────────────────────────────────────────────
ALTER TABLE payments.subscription_items
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'razorpay'));


CREATE INDEX IF NOT EXISTS idx_payments_subscription_items_provider
  ON payments.subscription_items(environment, provider);

-- ── payment_history ──────────────────────────────────────────────────────────
ALTER TABLE payments.payment_history
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe', 'razorpay'));


CREATE INDEX IF NOT EXISTS idx_payments_payment_history_provider
  ON payments.payment_history(environment, provider);

-- Down Migration
-- ALTER TABLE payments.payment_history DROP COLUMN IF EXISTS provider;
-- ALTER TABLE payments.subscription_items DROP COLUMN IF EXISTS provider;
-- ALTER TABLE payments.subscriptions DROP COLUMN IF EXISTS provider;
-- ALTER TABLE payments.customers DROP COLUMN IF EXISTS provider;
-- ALTER TABLE payments.prices DROP COLUMN IF EXISTS provider;
-- ALTER TABLE payments.products DROP COLUMN IF EXISTS provider;
