import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '040_create-payments-customers-table.sql';
const migrationPath = path.resolve(
  currentDir,
  `../../src/infra/database/migrations/${migrationFile}`
);
const readMigrationSql = () => fs.readFileSync(migrationPath, 'utf8');

describe('payments-customers migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('labels the migration with a migration version comment', () => {
    expect(readMigrationSql()).toMatch(/^-- Migration \d+:/);
  });

  it('creates the payments customers mirror table', () => {
    const sql = readMigrationSql();
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS payments\.customers/i);
    expect(sql).toMatch(/stripe_customer_id TEXT NOT NULL/i);
    expect(sql).toMatch(/deleted BOOLEAN NOT NULL DEFAULT false/i);
    expect(sql).toMatch(/metadata JSONB NOT NULL DEFAULT '\{\}'::JSONB/i);
    expect(sql).toMatch(/raw JSONB NOT NULL DEFAULT '\{\}'::JSONB/i);
    expect(sql).toMatch(/stripe_created_at TIMESTAMPTZ/i);
    expect(sql).toMatch(/synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/i);
  });

  it('uses environment checks for test and live rows', () => {
    expect(readMigrationSql()).toMatch(/CHECK \(environment IN \('test', 'live'\)\)/i);
  });

  it('uses idempotent guards for table, indexes, and trigger recreation', () => {
    const sql = readMigrationSql();
    expect(sql).not.toMatch(/CREATE TABLE payments\./i);
    expect(sql).not.toMatch(/CREATE INDEX idx_payments/i);
    expect(sql).not.toMatch(/CREATE UNIQUE INDEX idx_payments/i);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_payments_customers_updated_at/i);
    expect(sql).toMatch(/CREATE TRIGGER trg_payments_customers_updated_at/i);
  });

  it('creates a unique environment and stripe customer id constraint', () => {
    expect(readMigrationSql()).toMatch(/UNIQUE \(environment, stripe_customer_id\)/i);
  });

  it('adds useful customer mirror indexes', () => {
    const sql = readMigrationSql();
    expect(sql).toMatch(/idx_payments_customers_environment_deleted/i);
    expect(sql).toMatch(/idx_payments_customers_environment_email/i);
    expect(sql).toMatch(/idx_payments_customers_environment_created/i);
  });

  it('keeps the customer mirror decoupled from payments mappings and runtime tables', () => {
    const sql = readMigrationSql();
    expect(sql).not.toMatch(/FOREIGN KEY/i);
    expect(sql).not.toMatch(/REFERENCES payments\./i);
    expect(sql).not.toMatch(/GRANT INSERT, SELECT ON payments\.customers/i);
  });
});
