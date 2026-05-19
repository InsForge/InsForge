import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/044_add-auth-token-expiry-config.sql'
);

describe('044_add-auth-token-expiry-config migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('adds the four expiry columns with defaults', () => {
    expect(sql).toMatch(/verify_email_code_expiry_minutes INTEGER DEFAULT 15 NOT NULL/i);
    expect(sql).toMatch(/verify_email_link_expiry_hours INTEGER DEFAULT 24 NOT NULL/i);
    expect(sql).toMatch(/reset_password_code_expiry_minutes INTEGER DEFAULT 10 NOT NULL/i);
    expect(sql).toMatch(/reset_password_link_expiry_hours INTEGER DEFAULT 1 NOT NULL/i);
  });

  it('guards check constraints behind existence checks', () => {
    expect(sql).toMatch(
      /conname = 'auth_config_verify_email_code_expiry_minutes_check'[\s\S]*?CHECK \(verify_email_code_expiry_minutes BETWEEN 1 AND 10080\)/i
    );
    expect(sql).toMatch(
      /conname = 'auth_config_verify_email_link_expiry_hours_check'[\s\S]*?CHECK \(verify_email_link_expiry_hours BETWEEN 1 AND 168\)/i
    );
    expect(sql).toMatch(
      /conname = 'auth_config_reset_password_code_expiry_minutes_check'[\s\S]*?CHECK \(reset_password_code_expiry_minutes BETWEEN 1 AND 10080\)/i
    );
    expect(sql).toMatch(
      /conname = 'auth_config_reset_password_link_expiry_hours_check'[\s\S]*?CHECK \(reset_password_link_expiry_hours BETWEEN 1 AND 168\)/i
    );
  });
});
