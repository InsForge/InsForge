-- Up Migration
--
-- Ensure the notes column exists on all razorpay tables and safely migrate
-- from the early alpha `metadata` column name to `notes` if necessary.
-- This repairs environments where the tables were created before 049 ran.

DO $$
BEGIN
  -- Fix payments.razorpay_plans
  IF to_regclass('payments.razorpay_plans') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_plans' AND column_name = 'metadata'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_plans' AND column_name = 'notes'
    ) THEN
      ALTER TABLE payments.razorpay_plans RENAME COLUMN metadata TO notes;
      ALTER TABLE payments.razorpay_plans
        ALTER COLUMN notes SET NOT NULL,
        ALTER COLUMN notes SET DEFAULT '{}'::JSONB;
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_plans' AND column_name = 'notes'
    ) THEN
      ALTER TABLE payments.razorpay_plans ADD COLUMN notes JSONB NOT NULL DEFAULT '{}'::JSONB;
    END IF;
  END IF;

  -- Fix payments.razorpay_subscriptions
  IF to_regclass('payments.razorpay_subscriptions') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_subscriptions' AND column_name = 'metadata'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_subscriptions' AND column_name = 'notes'
    ) THEN
      ALTER TABLE payments.razorpay_subscriptions RENAME COLUMN metadata TO notes;
      ALTER TABLE payments.razorpay_subscriptions
        ALTER COLUMN notes SET NOT NULL,
        ALTER COLUMN notes SET DEFAULT '{}'::JSONB;
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_subscriptions' AND column_name = 'notes'
    ) THEN
      ALTER TABLE payments.razorpay_subscriptions ADD COLUMN notes JSONB NOT NULL DEFAULT '{}'::JSONB;
    END IF;
  END IF;

  -- Fix payments.razorpay_orders
  IF to_regclass('payments.razorpay_orders') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_orders' AND column_name = 'metadata'
    ) AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_orders' AND column_name = 'notes'
    ) THEN
      ALTER TABLE payments.razorpay_orders RENAME COLUMN metadata TO notes;
      ALTER TABLE payments.razorpay_orders
        ALTER COLUMN notes SET NOT NULL,
        ALTER COLUMN notes SET DEFAULT '{}'::JSONB;
    ELSIF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'payments' AND table_name = 'razorpay_orders' AND column_name = 'notes'
    ) THEN
      ALTER TABLE payments.razorpay_orders ADD COLUMN notes JSONB NOT NULL DEFAULT '{}'::JSONB;
    END IF;
  END IF;
END $$;

-- Down Migration
-- Column rename/addition is intentionally not reversed; rolling back would
-- require knowing the prior column name per environment, which is not safely
-- deterministic.
