-- Up Migration
--
-- Establish the multi-provider payments foundation.
--
-- Provider-native tables:
--   - Stripe catalog/runtime tables keep Stripe concepts.
--   - Stripe subscriptions keep Stripe subscription/item concepts.
--   - Razorpay catalog/subscription tables keep Razorpay Item/Plan/Subscription
--     concepts.
--
-- Shared projection tables:
--   - Connections, customer mappings, customers, webhook events, and
--     transactions use provider-scoped identity columns because their durable
--     shape is useful across providers.

CREATE TABLE IF NOT EXISTS payments.provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]*$'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured', 'connected', 'error')),
  provider_account_id TEXT,
  account_email TEXT,
  account_name TEXT,
  account_livemode BOOLEAN,
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
  UNIQUE (provider, environment)
);

DROP TRIGGER IF EXISTS trg_payments_provider_connections_updated_at ON payments.provider_connections;
CREATE TRIGGER trg_payments_provider_connections_updated_at
BEFORE UPDATE ON payments.provider_connections
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT SELECT ON payments.provider_connections TO project_admin;

DO $$
BEGIN
  IF to_regclass('payments.stripe_connections') IS NOT NULL THEN
    INSERT INTO payments.provider_connections (
      provider,
      environment,
      status,
      provider_account_id,
      account_email,
      account_livemode,
      webhook_endpoint_id,
      webhook_endpoint_url,
      webhook_configured_at,
      last_synced_at,
      last_sync_status,
      last_sync_error,
      last_sync_counts,
      raw,
      created_at,
      updated_at
    )
    SELECT
      'stripe',
      environment,
      status,
      stripe_account_id,
      stripe_account_email,
      account_livemode,
      webhook_endpoint_id,
      webhook_endpoint_url,
      webhook_configured_at,
      last_synced_at,
      last_sync_status,
      last_sync_error,
      COALESCE(last_sync_counts, '{}'::JSONB),
      COALESCE(raw, '{}'::JSONB),
      created_at,
      updated_at
    FROM payments.stripe_connections
    ON CONFLICT (provider, environment) DO UPDATE SET
      status = EXCLUDED.status,
      provider_account_id = EXCLUDED.provider_account_id,
      account_email = EXCLUDED.account_email,
      account_livemode = EXCLUDED.account_livemode,
      webhook_endpoint_id = EXCLUDED.webhook_endpoint_id,
      webhook_endpoint_url = EXCLUDED.webhook_endpoint_url,
      webhook_configured_at = EXCLUDED.webhook_configured_at,
      last_synced_at = EXCLUDED.last_synced_at,
      last_sync_status = EXCLUDED.last_sync_status,
      last_sync_error = EXCLUDED.last_sync_error,
      last_sync_counts = EXCLUDED.last_sync_counts,
      raw = EXCLUDED.raw,
      updated_at = NOW();
  END IF;
END $$;

-- Rename Stripe-native tables with idempotent guards.
DO $$
BEGIN
  IF to_regclass('payments.stripe_checkout_sessions') IS NULL
     AND to_regclass('payments.checkout_sessions') IS NOT NULL THEN
    ALTER TABLE payments.checkout_sessions RENAME TO stripe_checkout_sessions;
  END IF;

  IF to_regclass('payments.stripe_customer_portal_sessions') IS NULL
     AND to_regclass('payments.customer_portal_sessions') IS NOT NULL THEN
    ALTER TABLE payments.customer_portal_sessions RENAME TO stripe_customer_portal_sessions;
  END IF;

  IF to_regclass('payments.stripe_products') IS NULL
     AND to_regclass('payments.products') IS NOT NULL THEN
    ALTER TABLE payments.products RENAME TO stripe_products;
  END IF;

  IF to_regclass('payments.stripe_prices') IS NULL
     AND to_regclass('payments.prices') IS NOT NULL THEN
    ALTER TABLE payments.prices RENAME TO stripe_prices;
  END IF;

  IF to_regclass('payments.stripe_subscriptions') IS NULL
     AND to_regclass('payments.subscriptions') IS NOT NULL THEN
    ALTER TABLE payments.subscriptions RENAME TO stripe_subscriptions;
  END IF;

  IF to_regclass('payments.stripe_subscription_items') IS NULL
     AND to_regclass('payments.subscription_items') IS NOT NULL THEN
    ALTER TABLE payments.subscription_items RENAME TO stripe_subscription_items;
  END IF;
END $$;

-- Provider-native tables should not repeat the provider name in every column.
-- These renames upgrade the old Stripe-only 039 shape and make this migration
-- safe to re-run after any subset of renames has already happened.
DO $$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT table_name, old_column_name, new_column_name
    FROM (VALUES
      ('stripe_checkout_sessions', 'stripe_checkout_session_id', 'checkout_session_id'),
      ('stripe_checkout_sessions', 'stripe_customer_id', 'customer_id'),
      ('stripe_checkout_sessions', 'stripe_payment_intent_id', 'payment_intent_id'),
      ('stripe_checkout_sessions', 'stripe_subscription_id', 'subscription_id'),
      ('stripe_customer_portal_sessions', 'stripe_customer_id', 'customer_id'),
      ('stripe_products', 'stripe_product_id', 'product_id'),
      ('stripe_prices', 'stripe_price_id', 'price_id'),
      ('stripe_prices', 'stripe_product_id', 'product_id'),
      ('stripe_subscriptions', 'stripe_subscription_id', 'subscription_id'),
      ('stripe_subscriptions', 'stripe_customer_id', 'customer_id'),
      ('stripe_subscription_items', 'stripe_subscription_item_id', 'subscription_item_id'),
      ('stripe_subscription_items', 'stripe_subscription_id', 'subscription_id'),
      ('stripe_subscription_items', 'stripe_product_id', 'product_id'),
      ('stripe_subscription_items', 'stripe_price_id', 'price_id')
    ) AS column_renames(table_name, old_column_name, new_column_name)
  LOOP
    IF to_regclass(format('payments.%I', item.table_name)) IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'payments'
           AND table_name = item.table_name
           AND column_name = item.old_column_name
       )
       AND NOT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'payments'
           AND table_name = item.table_name
           AND column_name = item.new_column_name
       ) THEN
      EXECUTE format(
        'ALTER TABLE payments.%I RENAME COLUMN %I TO %I',
        item.table_name,
        item.old_column_name,
        item.new_column_name
      );
    END IF;
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_payments_checkout_sessions_updated_at
  ON payments.stripe_checkout_sessions;
DROP TRIGGER IF EXISTS trg_payments_stripe_checkout_sessions_updated_at
  ON payments.stripe_checkout_sessions;
CREATE TRIGGER trg_payments_stripe_checkout_sessions_updated_at
BEFORE UPDATE ON payments.stripe_checkout_sessions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

DROP TRIGGER IF EXISTS trg_payments_customer_portal_sessions_updated_at
  ON payments.stripe_customer_portal_sessions;
DROP TRIGGER IF EXISTS trg_payments_stripe_customer_portal_sessions_updated_at
  ON payments.stripe_customer_portal_sessions;
CREATE TRIGGER trg_payments_stripe_customer_portal_sessions_updated_at
BEFORE UPDATE ON payments.stripe_customer_portal_sessions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT INSERT, SELECT ON payments.stripe_checkout_sessions TO anon, authenticated, project_admin;
GRANT INSERT, SELECT ON payments.stripe_customer_portal_sessions TO anon, authenticated, project_admin;
GRANT INSERT, TRIGGER ON TABLE payments.stripe_checkout_sessions TO project_admin;
GRANT INSERT, TRIGGER ON TABLE payments.stripe_customer_portal_sessions TO project_admin;

-- Stripe catalog mirrors.
ALTER TABLE payments.stripe_products
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS default_price_id TEXT;

DELETE FROM payments.stripe_products
WHERE product_id IS NULL;

ALTER TABLE payments.stripe_products
  ALTER COLUMN product_id SET NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_products_updated_at ON payments.stripe_products;
DROP TRIGGER IF EXISTS trg_payments_stripe_products_updated_at ON payments.stripe_products;
CREATE TRIGGER trg_payments_stripe_products_updated_at
BEFORE UPDATE ON payments.stripe_products
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE payments.stripe_prices
  ADD COLUMN IF NOT EXISTS price_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT;

DELETE FROM payments.stripe_prices
WHERE price_id IS NULL;

ALTER TABLE payments.stripe_prices
  ALTER COLUMN price_id SET NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_prices_updated_at ON payments.stripe_prices;
DROP TRIGGER IF EXISTS trg_payments_stripe_prices_updated_at ON payments.stripe_prices;
CREATE TRIGGER trg_payments_stripe_prices_updated_at
BEFORE UPDATE ON payments.stripe_prices
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

ALTER TABLE payments.stripe_subscription_items
  ADD COLUMN IF NOT EXISTS subscription_item_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS price_id TEXT;

DELETE FROM payments.stripe_subscription_items
WHERE subscription_item_id IS NULL
   OR subscription_id IS NULL;

ALTER TABLE payments.stripe_subscription_items
  ALTER COLUMN subscription_item_id SET NOT NULL,
  ALTER COLUMN subscription_id SET NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_subscription_items_updated_at
  ON payments.stripe_subscription_items;
DROP TRIGGER IF EXISTS trg_payments_stripe_subscription_items_updated_at
  ON payments.stripe_subscription_items;
CREATE TRIGGER trg_payments_stripe_subscription_items_updated_at
BEFORE UPDATE ON payments.stripe_subscription_items
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Razorpay catalog mirrors. Items are amount-bearing sellable line items;
-- Plans are recurring subscription definitions around an item.
CREATE TABLE IF NOT EXISTS payments.razorpay_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  item_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  amount BIGINT,
  -- Razorpay response mirror. Usually equals amount for catalog items, but
  -- Razorpay API responses can include unit_amount separately.
  unit_amount BIGINT,
  currency TEXT NOT NULL,
  type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  provider_created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, item_id)
);

DROP TRIGGER IF EXISTS trg_payments_razorpay_items_updated_at ON payments.razorpay_items;
CREATE TRIGGER trg_payments_razorpay_items_updated_at
BEFORE UPDATE ON payments.razorpay_items
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE TABLE IF NOT EXISTS payments.razorpay_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  plan_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  period TEXT NOT NULL,
  interval INTEGER NOT NULL,
  amount BIGINT,
  -- Razorpay nested item response mirror. Usually equals amount.
  unit_amount BIGINT,
  currency TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  provider_created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, plan_id)
);

DROP TRIGGER IF EXISTS trg_payments_razorpay_plans_updated_at ON payments.razorpay_plans;
CREATE TRIGGER trg_payments_razorpay_plans_updated_at
BEFORE UPDATE ON payments.razorpay_plans
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT SELECT ON payments.razorpay_items, payments.razorpay_plans TO project_admin;

CREATE TABLE IF NOT EXISTS payments.razorpay_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  subscription_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  customer_id TEXT,
  subject_type TEXT,
  subject_id TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'created',
    'authenticated',
    'active',
    'pending',
    'halted',
    'cancelled',
    'completed',
    'expired',
    'paused'
  )),
  current_start TIMESTAMPTZ,
  current_end TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  quantity BIGINT,
  charge_at TIMESTAMPTZ,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  total_count BIGINT,
  auth_attempts BIGINT,
  paid_count BIGINT,
  remaining_count BIGINT,
  short_url TEXT,
  has_scheduled_changes BOOLEAN NOT NULL DEFAULT false,
  change_scheduled_at TIMESTAMPTZ,
  offer_id TEXT,
  authorization_payment_id TEXT,
  authorization_verified_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  provider_created_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, subscription_id)
);

ALTER TABLE payments.razorpay_subscriptions
  ADD COLUMN IF NOT EXISTS auth_attempts BIGINT;

DROP TRIGGER IF EXISTS trg_payments_razorpay_subscriptions_updated_at
  ON payments.razorpay_subscriptions;
CREATE TRIGGER trg_payments_razorpay_subscriptions_updated_at
BEFORE UPDATE ON payments.razorpay_subscriptions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT INSERT, SELECT ON payments.razorpay_subscriptions TO authenticated, project_admin;
-- End-user subscription management routes use a rolled-back no-op update on
-- updated_at to evaluate developer-defined UPDATE RLS policies without
-- granting direct write access to subscription state columns.
GRANT UPDATE (updated_at) ON payments.razorpay_subscriptions TO authenticated;
GRANT UPDATE ON payments.razorpay_subscriptions TO project_admin;

CREATE TABLE IF NOT EXISTS payments.razorpay_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  -- initialized and failed are InsForge-local lifecycle states; created,
  -- attempted, and paid mirror Razorpay order statuses.
  status TEXT NOT NULL DEFAULT 'initialized' CHECK (
    status IN ('initialized', 'created', 'attempted', 'paid', 'failed')
  ),
  subject_type TEXT,
  subject_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  customer_contact TEXT,
  -- Nullable until provider order creation succeeds. Unique only when non-null;
  -- the create flow updates rows by the local UUID id.
  order_id TEXT,
  receipt TEXT,
  amount BIGINT NOT NULL,
  amount_paid BIGINT,
  amount_due BIGINT,
  currency TEXT NOT NULL,
  attempts INTEGER,
  verified_payment_id TEXT,
  verified_at TIMESTAMPTZ,
  description TEXT,
  callback_url TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_payments_razorpay_orders_updated_at
  ON payments.razorpay_orders;
CREATE TRIGGER trg_payments_razorpay_orders_updated_at
BEFORE UPDATE ON payments.razorpay_orders
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT INSERT, SELECT ON payments.razorpay_orders TO anon, authenticated, project_admin;
GRANT INSERT, UPDATE ON payments.razorpay_orders TO project_admin;

-- Stripe subscription mirror.
ALTER TABLE payments.stripe_subscriptions
  ADD COLUMN IF NOT EXISTS subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_id TEXT,
  ADD COLUMN IF NOT EXISTS latest_invoice_id TEXT;

DELETE FROM payments.stripe_subscriptions
WHERE subscription_id IS NULL
   OR customer_id IS NULL;

ALTER TABLE payments.stripe_subscriptions
  ALTER COLUMN subscription_id SET NOT NULL,
  ALTER COLUMN customer_id SET NOT NULL;

DROP TRIGGER IF EXISTS trg_payments_subscriptions_updated_at
  ON payments.stripe_subscriptions;
DROP TRIGGER IF EXISTS trg_payments_stripe_subscriptions_updated_at
  ON payments.stripe_subscriptions;
CREATE TRIGGER trg_payments_stripe_subscriptions_updated_at
BEFORE UPDATE ON payments.stripe_subscriptions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

-- Fulfillment triggers should be attached to payments.webhook_events. Stripe
-- subscription rows are provider projections and may also be changed by sync.
REVOKE TRIGGER ON payments.stripe_subscriptions FROM project_admin;

-- Shared customer mirror.
ALTER TABLE payments.customers
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_created_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments'
      AND table_name = 'customers'
      AND column_name = 'stripe_customer_id'
  ) THEN
    EXECUTE 'UPDATE payments.customers
             SET provider_customer_id = COALESCE(provider_customer_id, stripe_customer_id)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments'
      AND table_name = 'customers'
      AND column_name = 'stripe_created_at'
  ) THEN
    EXECUTE 'UPDATE payments.customers
             SET provider_created_at = COALESCE(provider_created_at, stripe_created_at)';
  END IF;
END $$;

DELETE FROM payments.customers
WHERE provider_customer_id IS NULL;

ALTER TABLE payments.customers
  ALTER COLUMN provider_customer_id SET NOT NULL;

CREATE TABLE IF NOT EXISTS payments.customer_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]*$'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  provider_customer_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, environment, subject_type, subject_id),
  UNIQUE (provider, environment, provider_customer_id)
);

ALTER TABLE payments.customer_mappings
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_customer_id TEXT;

UPDATE payments.customer_mappings
SET provider = 'stripe'
WHERE provider IS NULL
   OR length(trim(provider)) = 0;

ALTER TABLE payments.customer_mappings
  ALTER COLUMN provider SET NOT NULL,
  ALTER COLUMN provider DROP DEFAULT,
  ALTER COLUMN provider_customer_id SET NOT NULL;

DO $$
BEGIN
  IF to_regclass('payments.stripe_customer_mappings') IS NOT NULL THEN
    INSERT INTO payments.customer_mappings (
      provider,
      environment,
      subject_type,
      subject_id,
      provider_customer_id,
      created_at,
      updated_at
    )
    SELECT
      'stripe',
      environment,
      subject_type,
      subject_id,
      stripe_customer_id,
      created_at,
      updated_at
    FROM payments.stripe_customer_mappings
    ON CONFLICT (provider, environment, subject_type, subject_id) DO UPDATE SET
      provider_customer_id = EXCLUDED.provider_customer_id,
      updated_at = NOW();
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_payments_customer_mappings_updated_at ON payments.customer_mappings;
CREATE TRIGGER trg_payments_customer_mappings_updated_at
BEFORE UPDATE ON payments.customer_mappings
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE INDEX IF NOT EXISTS idx_payments_customer_mappings_provider_subject
  ON payments.customer_mappings(provider, environment, subject_type, subject_id);

GRANT SELECT ON payments.customer_mappings TO project_admin;

-- InsForge transaction projection. Provider-native tables and webhook events
-- remain the source of truth; this table is optimized for dashboard/reporting.
CREATE TABLE IF NOT EXISTS payments.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_]*$'),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  type TEXT NOT NULL CHECK (type IN (
    'one_time_payment',
    'subscription_invoice',
    'refund',
    'failed_payment'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'succeeded',
    'failed',
    'pending',
    'refunded',
    'partially_refunded'
  )),
  subject_type TEXT,
  subject_id TEXT,
  provider_customer_id TEXT,
  customer_email_snapshot TEXT,
  provider_object_type TEXT,
  provider_object_id TEXT,
  provider_parent_object_type TEXT,
  provider_parent_object_id TEXT,
  related_object_ids JSONB NOT NULL DEFAULT '{}'::JSONB,
  amount BIGINT,
  amount_refunded BIGINT NOT NULL DEFAULT 0,
  currency TEXT,
  description TEXT,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  provider_created_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_payments_transactions_updated_at ON payments.transactions;
CREATE TRIGGER trg_payments_transactions_updated_at
BEFORE UPDATE ON payments.transactions
FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

GRANT SELECT ON payments.transactions TO project_admin;

DO $$
BEGIN
  IF to_regclass('payments.payment_history') IS NOT NULL THEN
    INSERT INTO payments.transactions (
      id,
      provider,
      environment,
      type,
      status,
      subject_type,
      subject_id,
      provider_customer_id,
      customer_email_snapshot,
      provider_object_type,
      provider_object_id,
      provider_parent_object_type,
      provider_parent_object_id,
      related_object_ids,
      amount,
      amount_refunded,
      currency,
      description,
      paid_at,
      failed_at,
      refunded_at,
      provider_created_at,
      raw,
      created_at,
      updated_at
    )
    WITH payment_history_source AS (
      SELECT
        ph.*,
        CASE
          WHEN type = 'refund' AND stripe_refund_id IS NOT NULL THEN 'refund'
          WHEN type <> 'refund' AND stripe_payment_intent_id IS NOT NULL THEN 'payment_intent'
          WHEN type <> 'refund' AND stripe_charge_id IS NOT NULL THEN 'charge'
          WHEN type <> 'refund' AND stripe_invoice_id IS NOT NULL THEN 'invoice'
          WHEN type <> 'refund' AND stripe_checkout_session_id IS NOT NULL THEN 'checkout_session'
          ELSE NULL
        END AS candidate_provider_object_type,
        CASE
          WHEN type = 'refund' AND stripe_refund_id IS NOT NULL THEN stripe_refund_id
          WHEN type <> 'refund' AND stripe_payment_intent_id IS NOT NULL THEN stripe_payment_intent_id
          WHEN type <> 'refund' AND stripe_charge_id IS NOT NULL THEN stripe_charge_id
          WHEN type <> 'refund' AND stripe_invoice_id IS NOT NULL THEN stripe_invoice_id
          WHEN type <> 'refund' AND stripe_checkout_session_id IS NOT NULL THEN stripe_checkout_session_id
          ELSE NULL
        END AS candidate_provider_object_id
      FROM payments.payment_history ph
    ),
    ranked_payment_history AS (
      SELECT
        *,
        CASE
          WHEN candidate_provider_object_type IS NULL OR candidate_provider_object_id IS NULL THEN NULL
          ELSE ROW_NUMBER() OVER (
            PARTITION BY environment, candidate_provider_object_type, candidate_provider_object_id
            ORDER BY stripe_created_at DESC NULLS LAST, updated_at DESC, created_at DESC, id
          )
        END AS provider_object_rank
      FROM payment_history_source
    )
    SELECT
      id,
      'stripe',
      environment,
      type,
      status,
      subject_type,
      subject_id,
      stripe_customer_id,
      customer_email_snapshot,
      CASE WHEN provider_object_rank = 1 THEN candidate_provider_object_type ELSE NULL END,
      CASE WHEN provider_object_rank = 1 THEN candidate_provider_object_id ELSE NULL END,
      CASE
        WHEN type = 'refund' AND stripe_payment_intent_id IS NOT NULL THEN 'payment_intent'
        WHEN type = 'refund' AND stripe_charge_id IS NOT NULL THEN 'charge'
        ELSE NULL
      END,
      CASE
        WHEN type = 'refund' AND stripe_payment_intent_id IS NOT NULL THEN stripe_payment_intent_id
        WHEN type = 'refund' AND stripe_charge_id IS NOT NULL THEN stripe_charge_id
        ELSE NULL
      END,
      jsonb_strip_nulls(jsonb_build_object(
        'checkout_session', stripe_checkout_session_id,
        'payment_intent', stripe_payment_intent_id,
        'invoice', stripe_invoice_id,
        'charge', stripe_charge_id,
        'refund', stripe_refund_id,
        'subscription', stripe_subscription_id,
        'product', stripe_product_id,
        'price', stripe_price_id
      )),
      amount,
      COALESCE(amount_refunded, 0),
      currency,
      description,
      paid_at,
      failed_at,
      refunded_at,
      stripe_created_at,
      COALESCE(raw, '{}'::JSONB),
      created_at,
      updated_at
    FROM ranked_payment_history
    ON CONFLICT (id) DO UPDATE SET
      provider = EXCLUDED.provider,
      environment = EXCLUDED.environment,
      type = EXCLUDED.type,
      status = EXCLUDED.status,
      subject_type = EXCLUDED.subject_type,
      subject_id = EXCLUDED.subject_id,
      provider_customer_id = EXCLUDED.provider_customer_id,
      customer_email_snapshot = EXCLUDED.customer_email_snapshot,
      provider_object_type = EXCLUDED.provider_object_type,
      provider_object_id = EXCLUDED.provider_object_id,
      provider_parent_object_type = EXCLUDED.provider_parent_object_type,
      provider_parent_object_id = EXCLUDED.provider_parent_object_id,
      related_object_ids = EXCLUDED.related_object_ids,
      amount = EXCLUDED.amount,
      amount_refunded = EXCLUDED.amount_refunded,
      currency = EXCLUDED.currency,
      description = EXCLUDED.description,
      paid_at = EXCLUDED.paid_at,
      failed_at = EXCLUDED.failed_at,
      refunded_at = EXCLUDED.refunded_at,
      provider_created_at = EXCLUDED.provider_created_at,
      raw = EXCLUDED.raw,
      updated_at = EXCLUDED.updated_at;
  END IF;
END $$;

DROP TABLE IF EXISTS payments.payment_history;
DROP TABLE IF EXISTS payments.stripe_payment_activity;
DROP TABLE IF EXISTS payments.razorpay_payment_activity;

-- Shared webhook event ledger.
ALTER TABLE payments.webhook_events
  ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS provider_event_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_account_id TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments'
      AND table_name = 'webhook_events'
      AND column_name = 'stripe_event_id'
  ) THEN
    EXECUTE 'UPDATE payments.webhook_events
             SET provider_event_id = COALESCE(provider_event_id, stripe_event_id)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments'
      AND table_name = 'webhook_events'
      AND column_name = 'stripe_account_id'
  ) THEN
    EXECUTE 'UPDATE payments.webhook_events
             SET provider_account_id = COALESCE(provider_account_id, stripe_account_id)';
  END IF;
END $$;

DELETE FROM payments.webhook_events
WHERE provider_event_id IS NULL;

ALTER TABLE payments.webhook_events
  ALTER COLUMN provider_event_id SET NOT NULL;

GRANT TRIGGER ON payments.webhook_events TO project_admin;

-- Finalize provider columns on shared projection tables. The temporary Stripe
-- default repairs rows on retries after columns were added but before
-- nullability/checks were finalized.
DO $$
DECLARE
  table_name TEXT;
  provider_check_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers',
    'webhook_events'
  ]
  LOOP
    IF to_regclass(format('payments.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'UPDATE payments.%I SET provider = %L WHERE provider IS NULL OR length(trim(provider)) = 0',
      table_name,
      'stripe'
    );
    EXECUTE format('ALTER TABLE payments.%I ALTER COLUMN provider SET DEFAULT %L', table_name, 'stripe');
    EXECUTE format('ALTER TABLE payments.%I ALTER COLUMN provider SET NOT NULL', table_name);

    provider_check_name := format('chk_payments_%s_provider_format', table_name);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'payments'
        AND rel.relname = table_name
        AND con.conname = provider_check_name
    ) THEN
      EXECUTE format(
        'ALTER TABLE payments.%I ADD CONSTRAINT %I CHECK (provider ~ %L)',
        table_name,
        provider_check_name,
        '^[a-z][a-z0-9_]*$'
      );
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'customers',
    'webhook_events'
  ]
  LOOP
    IF to_regclass(format('payments.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE payments.%I ALTER COLUMN provider DROP DEFAULT', table_name);
  END LOOP;
END $$;

-- Drop old generated unique constraints before creating the final named unique
-- indexes for provider-native tables and provider-scoped shared projections.
DO $$
DECLARE
  item RECORD;
  constraint_name TEXT;
BEGIN
  FOR item IN
    SELECT table_name, column_names
    FROM (VALUES
      ('stripe_checkout_sessions', ARRAY['environment', 'checkout_session_id']),
      ('stripe_products', ARRAY['environment', 'product_id']),
      ('stripe_prices', ARRAY['environment', 'price_id']),
      ('stripe_subscriptions', ARRAY['environment', 'subscription_id']),
      ('stripe_subscription_items', ARRAY['environment', 'subscription_item_id']),
      ('customers', ARRAY['environment', 'stripe_customer_id']),
      ('webhook_events', ARRAY['environment', 'stripe_event_id'])
    ) AS constraints(table_name, column_names)
  LOOP
    FOR constraint_name IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'payments'
        AND rel.relname = item.table_name
        AND con.contype = 'u'
        AND (
          SELECT array_agg(att.attname::text ORDER BY keys.ordinality)
          FROM unnest(con.conkey) WITH ORDINALITY AS keys(attnum, ordinality)
          JOIN pg_attribute att
            ON att.attrelid = con.conrelid
           AND att.attnum = keys.attnum
        ) = item.column_names
    LOOP
      EXECUTE format('ALTER TABLE payments.%I DROP CONSTRAINT IF EXISTS %I', item.table_name, constraint_name);
    END LOOP;
  END LOOP;
END $$;

DROP INDEX IF EXISTS payments.idx_payments_products_environment_active;
DROP INDEX IF EXISTS payments.idx_payments_prices_environment_product;
DROP INDEX IF EXISTS payments.idx_payments_prices_environment_lookup_key;
DROP INDEX IF EXISTS payments.idx_payments_subscription_items_environment_subscription;
DROP INDEX IF EXISTS payments.idx_payments_subscription_items_environment_price;
DROP INDEX IF EXISTS payments.idx_payments_customers_environment_created;
DROP INDEX IF EXISTS payments.idx_payments_subscriptions_environment_subject;
DROP INDEX IF EXISTS payments.idx_payments_subscriptions_environment_customer;
DROP INDEX IF EXISTS payments.idx_payments_subscriptions_environment_status;
DROP INDEX IF EXISTS payments.idx_payments_checkout_sessions_environment_status;
DROP INDEX IF EXISTS payments.idx_payments_checkout_sessions_environment_subject;
DROP INDEX IF EXISTS payments.idx_payments_checkout_sessions_environment_customer;
DROP INDEX IF EXISTS payments.idx_payments_checkout_sessions_environment_stripe_session;
DROP INDEX IF EXISTS payments.idx_payments_checkout_sessions_environment_idempotency;
DROP INDEX IF EXISTS payments.idx_payments_customer_portal_sessions_environment_status;
DROP INDEX IF EXISTS payments.idx_payments_customer_portal_sessions_environment_subject;
DROP INDEX IF EXISTS payments.idx_payments_customer_portal_sessions_environment_customer;

ALTER TABLE payments.customers
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_created_at;

ALTER TABLE payments.webhook_events
  DROP COLUMN IF EXISTS stripe_event_id,
  DROP COLUMN IF EXISTS stripe_account_id;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_checkout_sessions_environment_status
  ON payments.stripe_checkout_sessions(environment, status);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_checkout_sessions_environment_subject
  ON payments.stripe_checkout_sessions(environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_checkout_sessions_environment_customer
  ON payments.stripe_checkout_sessions(environment, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_checkout_sessions_environment_session
  ON payments.stripe_checkout_sessions(environment, checkout_session_id)
  WHERE checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_checkout_sessions_environment_idempotency
  ON payments.stripe_checkout_sessions(environment, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_customer_portal_sessions_environment_status
  ON payments.stripe_customer_portal_sessions(environment, status);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_customer_portal_sessions_environment_subject
  ON payments.stripe_customer_portal_sessions(environment, subject_type, subject_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_customer_portal_sessions_environment_customer
  ON payments.stripe_customer_portal_sessions(environment, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_products_environment_product
  ON payments.stripe_products(environment, product_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_products_environment_active
  ON payments.stripe_products(environment, active);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_products_environment_default_price
  ON payments.stripe_products(environment, default_price_id)
  WHERE default_price_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_prices_environment_price
  ON payments.stripe_prices(environment, price_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_prices_environment_product
  ON payments.stripe_prices(environment, product_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_prices_environment_lookup_key
  ON payments.stripe_prices(environment, lookup_key)
  WHERE lookup_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_subscriptions_environment_subscription
  ON payments.stripe_subscriptions(environment, subscription_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscriptions_environment_subject
  ON payments.stripe_subscriptions(environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscriptions_environment_customer
  ON payments.stripe_subscriptions(environment, customer_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscriptions_environment_status
  ON payments.stripe_subscriptions(environment, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_subscription_items_environment_item
  ON payments.stripe_subscription_items(environment, subscription_item_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscription_items_environment_subscription
  ON payments.stripe_subscription_items(environment, subscription_id);

CREATE INDEX IF NOT EXISTS idx_payments_stripe_subscription_items_environment_price
  ON payments.stripe_subscription_items(environment, price_id)
  WHERE price_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_items_environment_item
  ON payments.razorpay_items(environment, item_id);

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_items_environment_active
  ON payments.razorpay_items(environment, active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_plans_environment_plan
  ON payments.razorpay_plans(environment, plan_id);

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_plans_environment_item
  ON payments.razorpay_plans(environment, item_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_subscription
  ON payments.razorpay_subscriptions(environment, subscription_id);

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_plan
  ON payments.razorpay_subscriptions(environment, plan_id);

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_customer
  ON payments.razorpay_subscriptions(environment, customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_status
  ON payments.razorpay_subscriptions(environment, status);

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_subject
  ON payments.razorpay_subscriptions(environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_authorization_payment
  ON payments.razorpay_subscriptions(environment, authorization_payment_id)
  WHERE authorization_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_status
  ON payments.razorpay_orders(environment, status);

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_subject
  ON payments.razorpay_orders(environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_order
  ON payments.razorpay_orders(environment, order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_razorpay_orders_environment_verified_payment
  ON payments.razorpay_orders(environment, verified_payment_id)
  WHERE verified_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_customers_provider_customer_id
  ON payments.customers(provider, environment, provider_customer_id);

CREATE INDEX IF NOT EXISTS idx_payments_customers_provider
  ON payments.customers(provider, environment);

CREATE INDEX IF NOT EXISTS idx_payments_customers_provider_created
  ON payments.customers(provider, environment, provider_created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_webhook_events_provider_event
  ON payments.webhook_events(provider, environment, provider_event_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transactions_provider_object
  ON payments.transactions(provider, environment, provider_object_type, provider_object_id)
  WHERE provider_object_type IS NOT NULL
    AND provider_object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_transactions_provider_customer
  ON payments.transactions(provider, environment, provider_customer_id)
  WHERE provider_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_transactions_provider_subject
  ON payments.transactions(provider, environment, subject_type, subject_id)
  WHERE subject_type IS NOT NULL
    AND subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_transactions_provider_status
  ON payments.transactions(provider, environment, status);

CREATE INDEX IF NOT EXISTS idx_payments_transactions_provider_created
  ON payments.transactions(provider, environment, provider_created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payments_transactions_related_object_ids
  ON payments.transactions USING GIN (related_object_ids);

DROP TABLE IF EXISTS payments.stripe_customer_mappings;
DROP TABLE IF EXISTS payments.stripe_connections;

-- Down Migration
-- This migration establishes the provider foundation and intentionally has no
-- destructive down path.
