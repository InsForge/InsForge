import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/042_add-token-expiry-config.sql'
);

describe('042_add-token-expiry-config migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('targets auth.config table', () => {
    expect(sql).toMatch(/ALTER TABLE auth\.config/i);
  });

  it('adds verify_email_code_expiry_minutes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS verify_email_code_expiry_minutes INTEGER/i);
  });

  it('adds verify_email_link_expiry_minutes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS verify_email_link_expiry_minutes INTEGER/i);
  });

  it('adds reset_password_code_expiry_minutes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reset_password_code_expiry_minutes INTEGER/i);
  });

  it('adds reset_password_link_expiry_minutes with IF NOT EXISTS', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS reset_password_link_expiry_minutes INTEGER/i);
  });

  it('sets verify_email_code_expiry_minutes default to 15', () => {
    expect(sql).toMatch(/verify_email_code_expiry_minutes INTEGER DEFAULT 15/i);
  });

  it('sets verify_email_link_expiry_minutes default to 1440 (24h)', () => {
    expect(sql).toMatch(/verify_email_link_expiry_minutes INTEGER DEFAULT 1440/i);
  });

  it('sets reset_password_code_expiry_minutes default to 10', () => {
    expect(sql).toMatch(/reset_password_code_expiry_minutes INTEGER DEFAULT 10/i);
  });

  it('sets reset_password_link_expiry_minutes default to 60 (1h)', () => {
    expect(sql).toMatch(/reset_password_link_expiry_minutes INTEGER DEFAULT 60/i);
  });

  it('includes CHECK constraints with lower bound of 1', () => {
    const checkMatches = sql.match(/>= 1/g);
    expect(checkMatches).not.toBeNull();
    expect(checkMatches!.length).toBe(4);
  });

  it('includes CHECK constraints with upper bound of 10080 (7 days)', () => {
    const checkMatches = sql.match(/<= 10080/g);
    expect(checkMatches).not.toBeNull();
    expect(checkMatches!.length).toBe(4);
  });

  it('marks all columns NOT NULL', () => {
    const notNullMatches = sql.match(/NOT NULL/g);
    expect(notNullMatches).not.toBeNull();
    expect(notNullMatches!.length).toBe(4);
  });

  it('runs after migration 041', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx042 = migrations.indexOf('042_add-token-expiry-config.sql');
    const idx041 = migrations.indexOf('041_consolidate-retention-jobs.sql');
    expect(idx041).toBeGreaterThanOrEqual(0);
    expect(idx042).toBeGreaterThan(idx041);
  });
});
