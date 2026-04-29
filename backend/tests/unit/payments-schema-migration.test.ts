import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/038_create-payments-schema.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('038_create-payments-schema migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('labels the migration with the matching version number', () => {
    expect(sql).toMatch(/^-- Migration 038:/);
    expect(sql).not.toMatch(/^-- Migration 036:/);
  });

  it('creates the payments catalog and runtime tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.stripe_connections/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.products/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.prices/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.stripe_customer_mappings/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.payment_history/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.subscriptions/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.subscription_items/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.webhook_events/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.sync_runs/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.customers/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.webhook_endpoints/i);
  });

  it('uses environment checks for test and live rows', () => {
    expect(
      sql.match(/CHECK \(environment IN \('test', 'live'\)\)/gi)?.length
    ).toBeGreaterThanOrEqual(8);
  });

  it('uses idempotent guards for schema objects and trigger recreation', () => {
    expect(sql).not.toMatch(/CREATE SCHEMA payments/i);
    expect(sql).not.toMatch(/CREATE TABLE payments\./i);
    expect(sql).not.toMatch(/CREATE INDEX idx_payments/i);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX idx_payments/i);

    const dropTriggers = sql.match(/DROP TRIGGER IF EXISTS trg_payments_/gi) ?? [];
    const createTriggers = sql.match(/CREATE TRIGGER trg_payments_/gi) ?? [];
    expect(dropTriggers.length).toBe(createTriggers.length);
  });

  it('does not store key source on mirrored Stripe connection rows', () => {
    expect(sql).not.toMatch(/key_source/i);
  });

  it('stores raw Stripe payloads as jsonb', () => {
    expect(sql).toMatch(/raw JSONB NOT NULL DEFAULT '\{\}'::JSONB/i);
  });

  it('does not keep soft-delete tombstones in Stripe catalog mirror rows', () => {
    expect(sql).not.toMatch(/is_deleted/i);
  });

  it('creates unique indexes for environment and Stripe object id pairs', () => {
    expect(sql).toMatch(/UNIQUE \(environment, stripe_product_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, stripe_price_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, subject_type, subject_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, stripe_customer_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, stripe_subscription_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, stripe_subscription_item_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, stripe_event_id\)/i);
  });

  it('stores latest sync state on stripe_connections', () => {
    expect(sql).toMatch(/last_sync_status TEXT/i);
    expect(sql).toMatch(/last_sync_error TEXT/i);
    expect(sql).toMatch(/last_sync_counts JSONB NOT NULL DEFAULT '\{\}'::JSONB/i);
  });

  it('stores managed Stripe webhook endpoint metadata on stripe_connections', () => {
    expect(sql).toMatch(/webhook_endpoint_id TEXT/i);
    expect(sql).toMatch(/webhook_endpoint_url TEXT/i);
    expect(sql).toMatch(/webhook_configured_at TIMESTAMPTZ/i);
  });

  it('keeps consolidated stripe_connections webhook columns idempotent', () => {
    expect(sql).toMatch(
      /ALTER TABLE payments\.stripe_connections\s+ADD COLUMN IF NOT EXISTS webhook_endpoint_id TEXT/i
    );
    expect(sql).toMatch(
      /ALTER TABLE payments\.stripe_connections\s+ADD COLUMN IF NOT EXISTS webhook_endpoint_url TEXT/i
    );
    expect(sql).toMatch(
      /ALTER TABLE payments\.stripe_connections\s+ADD COLUMN IF NOT EXISTS webhook_configured_at TIMESTAMPTZ/i
    );
  });

  it('keeps customer mappings generic without foreign keys to app tables', () => {
    expect(sql).toMatch(/subject_type TEXT NOT NULL/i);
    expect(sql).toMatch(/subject_id TEXT NOT NULL/i);
    expect(sql).not.toMatch(/REFERENCES public\./i);
    expect(sql).not.toMatch(/REFERENCES auth\./i);
  });

  it('allows anonymous one-time payment history rows', () => {
    expect(sql).toMatch(/subject_type TEXT,/i);
    expect(sql).toMatch(/subject_id TEXT,/i);
    expect(sql).toMatch(/customer_email_snapshot TEXT/i);
  });

  it('allows unmapped subscription rows for existing Stripe syncs', () => {
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS payments\.subscriptions[\s\S]*subject_type TEXT,/i
    );
    expect(sql).toMatch(
      /CREATE TABLE IF NOT EXISTS payments\.subscriptions[\s\S]*subject_id TEXT,/i
    );
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.subscriptions\s+ALTER COLUMN subject_type DROP NOT NULL/i
    );
    expect(sql).not.toMatch(
      /ALTER TABLE payments\.subscriptions\s+ALTER COLUMN subject_id DROP NOT NULL/i
    );
  });

  it('stores webhook events idempotently with processing state', () => {
    expect(sql).toMatch(
      /processing_status TEXT NOT NULL DEFAULT 'pending' CHECK \(processing_status IN \('pending', 'processed', 'failed', 'ignored'\)\)/i
    );
    expect(sql).toMatch(/attempt_count INTEGER NOT NULL DEFAULT 0/i);
    expect(sql).toMatch(/payload JSONB NOT NULL/i);
  });

  it('adds useful runtime indexes', () => {
    expect(sql).toMatch(/idx_payments_payment_history_environment_subject/i);
    expect(sql).toMatch(/idx_payments_payment_history_environment_payment_intent/i);
    expect(sql).toMatch(/idx_payments_payment_history_environment_invoice/i);
    expect(sql).toMatch(/idx_payments_payment_history_environment_refund/i);
    expect(sql).toMatch(/idx_payments_subscriptions_environment_subject/i);
    expect(sql).toMatch(/idx_payments_webhook_events_environment_status/i);
  });

  it('keeps refund rows from conflicting with original payment and invoice rows', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_history_environment_payment_intent[\s\S]*WHERE stripe_payment_intent_id IS NOT NULL\s+AND type <> 'refund'/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_history_environment_invoice[\s\S]*WHERE stripe_invoice_id IS NOT NULL\s+AND type <> 'refund'/i
    );
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_payment_history_environment_refund[\s\S]*WHERE stripe_refund_id IS NOT NULL/i
    );
  });

  it('adds updated_at triggers for all payments tables', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_stripe_connections_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_products_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_prices_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_stripe_customer_mappings_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_payment_history_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_subscriptions_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_subscription_items_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_webhook_events_updated_at/i);
    expect(
      sql.match(/EXECUTE FUNCTION system\.update_updated_at\(\)/gi)?.length
    ).toBeGreaterThanOrEqual(8);
  });
});
