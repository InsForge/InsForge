import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/036_create-payments-schema.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

describe('036_create-payments-schema migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('creates only the V1 payments tables', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.stripe_connections/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.products/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.prices/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.sync_runs/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.customers/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.subscriptions/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.subscription_items/i);
    expect(sql).not.toMatch(/CREATE TABLE IF NOT EXISTS payments\.webhook_endpoints/i);
  });

  it('uses environment checks for test and live rows', () => {
    expect(sql).toMatch(/CHECK \(environment IN \('test', 'live'\)\)/i);
  });

  it('does not store key source on mirrored Stripe connection rows', () => {
    expect(sql).not.toMatch(/key_source/i);
  });

  it('stores raw Stripe payloads as jsonb', () => {
    expect(sql).toMatch(/raw JSONB NOT NULL DEFAULT '\{\}'::JSONB/i);
  });

  it('keeps deleted Stripe catalog objects as soft-deleted mirror rows', () => {
    expect(sql).toMatch(/is_deleted BOOLEAN NOT NULL DEFAULT FALSE/i);
  });

  it('creates unique indexes for environment and Stripe object id pairs', () => {
    expect(sql).toMatch(/UNIQUE \(environment, stripe_product_id\)/i);
    expect(sql).toMatch(/UNIQUE \(environment, stripe_price_id\)/i);
  });

  it('stores latest sync state on stripe_connections', () => {
    expect(sql).toMatch(/last_sync_status TEXT/i);
    expect(sql).toMatch(/last_sync_error TEXT/i);
    expect(sql).toMatch(/last_sync_counts JSONB NOT NULL DEFAULT '\{\}'::JSONB/i);
  });

  it('adds updated_at triggers for all V1 tables', () => {
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_stripe_connections_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_products_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_prices_updated_at/i);
    expect(sql).toMatch(/EXECUTE FUNCTION system\.update_updated_at\(\)/i);
  });
});
