import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '049_add-multi-provider-payments-foundation.sql';
const migrationPath = path.resolve(
  currentDir,
  `../../src/infra/database/migrations/${migrationFile}`
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('payments multi-provider migration', () => {
  it('condenses branch-local Razorpay migrations into the next 049 multi-provider foundation', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
    expect(
      fs.existsSync(
        path.resolve(
          currentDir,
          '../../src/infra/database/migrations/051_add_razorpay_payments.sql'
        )
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          currentDir,
          '../../src/infra/database/migrations/052_fix_razorpay_connections.sql'
        )
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(
          currentDir,
          '../../src/infra/database/migrations/053_make_subscription_customer_nullable.sql'
        )
      )
    ).toBe(false);
    expect(
      fs.existsSync(
        path.resolve(currentDir, '../../src/infra/database/migrations/054_add-provider-column.sql')
      )
    ).toBe(false);
  });

  it('creates shared provider-scoped connection and customer mapping tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.provider_connections/i);
    expect(sql).toMatch(/UNIQUE \(provider, environment\)/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.customer_mappings/i);
    expect(sql).toMatch(/UNIQUE \(provider, environment, subject_type, subject_id\)/i);
    expect(sql).toMatch(/provider_customer_id TEXT NOT NULL/i);
    expect(sql).toMatch(/UNIQUE \(provider, environment, provider_customer_id\)/i);
    expect(sql).not.toMatch(/stripe_customer_id TEXT,/i);
    expect(sql).not.toMatch(/razorpay_customer_id TEXT/i);
    expect(sql).not.toMatch(/idx_payments_customer_mappings_stripe_customer/i);
    expect(sql).not.toMatch(/idx_payments_customer_mappings_razorpay_customer/i);
  });

  it('keeps payment environments limited to test and live', () => {
    expect(sql).toMatch(/environment TEXT NOT NULL CHECK \(environment IN \('test', 'live'\)\)/i);
    expect(sql).not.toMatch(/Remove hard-coded test\/live environment checks/i);
  });

  it('keeps provider identity columns on shared operational projections only', () => {
    for (const tableName of ['customers', 'webhook_events']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE payments\\.${tableName}[\\s\\S]*provider`, 'i'));
    }

    expect(sql).toMatch(/provider_event_id TEXT/i);
    expect(sql).toMatch(/provider_created_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.stripe_payment_activity/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.razorpay_payment_activity/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.products\s+ADD COLUMN IF NOT EXISTS provider/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.prices\s+ADD COLUMN IF NOT EXISTS provider/i);
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.subscription_items\s+ADD COLUMN IF NOT EXISTS provider/i
    );
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.subscriptions\s+ADD COLUMN IF NOT EXISTS provider/i
    );
  });

  it('renames published payment history to the Stripe payment activity source table', () => {
    expect(sql).toMatch(/to_regclass\('payments\.stripe_payment_activity'\) IS NULL/i);
    expect(sql).toMatch(/to_regclass\('payments\.payment_history'\) IS NOT NULL/i);
    expect(sql).toMatch(/ALTER TABLE payments\.payment_history RENAME TO stripe_payment_activity/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_payments_payment_history_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_stripe_payment_activity_updated_at/i);
    expect(sql).toMatch(
      /DROP INDEX IF EXISTS payments\.idx_payments_payment_history_environment_payment_intent/i
    );
  });

  it('renames Stripe-native runtime, catalog, and subscription tables', () => {
    expect(sql).toMatch(
      /ALTER TABLE payments\.checkout_sessions RENAME TO stripe_checkout_sessions/i
    );
    expect(sql).toMatch(
      /ALTER TABLE payments\.customer_portal_sessions RENAME TO stripe_customer_portal_sessions/i
    );
    expect(sql).toMatch(/payments\.stripe_checkout_sessions/i);
    expect(sql).toMatch(/payments\.stripe_customer_portal_sessions/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.checkout_sessions\s+ADD COLUMN/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.customer_portal_sessions\s+ADD COLUMN/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.stripe_checkout_sessions/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.stripe_customer_portal_sessions/i);
    expect(sql).toMatch(/idx_payments_stripe_checkout_sessions_environment_idempotency/i);
    expect(sql).toMatch(/idx_payments_stripe_customer_portal_sessions_environment_customer/i);
    expect(sql).toMatch(/ALTER TABLE payments\.products RENAME TO stripe_products/i);
    expect(sql).toMatch(/ALTER TABLE payments\.prices RENAME TO stripe_prices/i);
    expect(sql).toMatch(/ALTER TABLE payments\.subscriptions RENAME TO stripe_subscriptions/i);
    expect(sql).toMatch(
      /ALTER TABLE payments\.subscription_items RENAME TO stripe_subscription_items/i
    );
    expect(sql).toMatch(/payments\.stripe_products/i);
    expect(sql).toMatch(/payments\.stripe_prices/i);
    expect(sql).toMatch(/payments\.stripe_subscriptions/i);
    expect(sql).toMatch(/payments\.stripe_subscription_items/i);
  });

  it('creates provider-native catalog and subscription indexes without shared catalog indexes', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.razorpay_items/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.razorpay_plans/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.razorpay_subscriptions/i);
    expect(sql).toMatch(/item_id TEXT NOT NULL/i);
    expect(sql).toMatch(/plan_id TEXT NOT NULL/i);
    expect(sql).toMatch(/subscription_id TEXT NOT NULL/i);
    expect(sql).toMatch(/plan_id TEXT NOT NULL/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_products_environment_product/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_prices_environment_price/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_subscription_items_environment_item/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_subscriptions_environment_subscription/i
    );
    expect(sql).toMatch(/'stripe_products', ARRAY\['environment', 'product_id'\]/i);
    expect(sql).toMatch(/'stripe_prices', ARRAY\['environment', 'price_id'\]/i);
    expect(sql).toMatch(
      /'stripe_checkout_sessions', ARRAY\['environment', 'checkout_session_id'\]/i
    );
    expect(sql).toMatch(
      /'stripe_subscription_items', ARRAY\['environment', 'subscription_item_id'\]/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_items_environment_item/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_plans_environment_plan/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_subscriptions_environment_subscription/i
    );
    expect(sql).not.toMatch(/idx_payments_products_provider_product_id/i);
    expect(sql).not.toMatch(/idx_payments_prices_provider_price_id/i);
    expect(sql).not.toMatch(/idx_payments_subscription_items_provider_item_id/i);
    expect(sql).not.toMatch(/idx_payments_subscriptions_provider_subscription_id/i);
  });

  it('replaces shared environment-only uniqueness with provider-native indexes', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_stripe_payment_activity_environment_payment_intent[\s\S]*payment_intent_id IS NOT NULL[\s\S]*type <> 'refund'/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_razorpay_payment_activity_environment_payment[\s\S]*payment_id IS NOT NULL[\s\S]*type <> 'refund'/i
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_payments_stripe_payment_activity_environment_subject[\s\S]*environment, subject_type, subject_id/i
    );
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment_activity_environment_order[\s\S]*order_id/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_webhook_events_provider_event/i
    );
    expect(sql).toMatch(
      /DROP INDEX IF EXISTS payments\.idx_payments_checkout_sessions_environment_idempotency/i
    );
    expect(sql).not.toMatch(/idx_payments_checkout_sessions_provider_session/i);
    expect(sql).not.toMatch(/idx_payments_checkout_sessions_provider_idempotency/i);
  });

  it('removes Stripe-era alias columns from shared provider tables after copying data', () => {
    expect(sql).toMatch(/DROP COLUMN IF EXISTS stripe_customer_id/i);
    expect(sql).toMatch(/DROP COLUMN IF EXISTS stripe_event_id/i);
    expect(sql).not.toMatch(/ALTER TABLE payments\.stripe_payment_activity[^;]*DROP COLUMN/i);
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.stripe_products[^;]*DROP COLUMN IF EXISTS product_id/i
    );
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.stripe_products[^;]*DROP COLUMN IF EXISTS default_price_id/i
    );
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.stripe_subscriptions[^;]*DROP COLUMN IF EXISTS subscription_id/i
    );
    expect(sql).not.toMatch(/compatibility aliases/i);
  });

  it('migrates published Stripe-era split tables before dropping them', () => {
    expect(sql).toMatch(/IF to_regclass\('payments\.stripe_connections'\) IS NOT NULL/i);
    expect(sql).toMatch(/IF to_regclass\('payments\.stripe_customer_mappings'\) IS NOT NULL/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS payments\.stripe_connections/i);
    expect(sql).toMatch(/DROP TABLE IF EXISTS payments\.stripe_customer_mappings/i);
    expect(sql).not.toMatch(/payments\.razorpay_connections/i);
    expect(sql).not.toMatch(/payments\.razorpay_webhook_events/i);
  });

  it('is repeatable and finalizes provider columns on shared tables', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS provider TEXT DEFAULT 'stripe'/i);
    expect(sql).toMatch(/SELECT 1 FROM information_schema\.columns/i);
    expect(sql).toMatch(/WHERE provider IS NULL OR length\(trim\(provider\)\) = 0/i);
    expect(sql).not.toMatch(/provider_product_id/i);
    expect(sql).not.toMatch(/provider_price_id/i);
    expect(sql).not.toMatch(/provider_subscription_item_id/i);
    expect(sql).not.toMatch(/provider_subscription_id/i);
    expect(sql).toMatch(/ALTER COLUMN provider SET DEFAULT/i);
    expect(sql).toMatch(/ALTER COLUMN provider SET NOT NULL/i);
    expect(sql).toMatch(/ALTER COLUMN provider DROP DEFAULT/i);
    expect(sql).toMatch(/chk_payments_%s_provider_format/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS/i);
  });

  it('casts PostgreSQL name columns before comparing unique constraint column arrays', () => {
    expect(sql).toMatch(/array_agg\(att\.attname::text ORDER BY keys\.ordinality\)/i);
    expect(sql).not.toMatch(/array_agg\(att\.attname ORDER BY keys\.ordinality\)/i);
  });
});
