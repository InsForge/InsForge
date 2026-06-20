-- Up Migration
--
-- Ensure the notes column exists on all razorpay tables and safely migrate
-- from the early alpha `metadata` column name to `notes` if necessary.
-- This repairs environments where the tables were created before 049 ran.

DO $$
BEGIN
  -- Fix payments.razorpay_plans
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_plans' AND column_name = 'metadata'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_plans' AND column_name = 'notes'
  ) THEN
    ALTER TABLE payments.razorpay_plans RENAME COLUMN metadata TO notes;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_plans' AND column_name = 'notes'
  ) THEN
    ALTER TABLE payments.razorpay_plans ADD COLUMN notes JSONB NOT NULL DEFAULT '{}'::JSONB;
  END IF;

  -- Fix payments.razorpay_subscriptions
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_subscriptions' AND column_name = 'metadata'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_subscriptions' AND column_name = 'notes'
  ) THEN
    ALTER TABLE payments.razorpay_subscriptions RENAME COLUMN metadata TO notes;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_subscriptions' AND column_name = 'notes'
  ) THEN
    ALTER TABLE payments.razorpay_subscriptions ADD COLUMN notes JSONB NOT NULL DEFAULT '{}'::JSONB;
  END IF;

  -- Fix payments.razorpay_orders
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_orders' AND column_name = 'metadata'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_orders' AND column_name = 'notes'
  ) THEN
    ALTER TABLE payments.razorpay_orders RENAME COLUMN metadata TO notes;
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'payments' AND table_name = 'razorpay_orders' AND column_name = 'notes'
  ) THEN
    ALTER TABLE payments.razorpay_orders ADD COLUMN notes JSONB NOT NULL DEFAULT '{}'::JSONB;
  END IF;
END $$;
