import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDirectory,
  '../../src/infra/database/migrations/065_add-phone-otp-sign-in.sql'
);

describe('065_add-phone-otp-sign-in migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('relaxes the email requirement so phone-only accounts can exist', () => {
    expect(sql).toMatch(/ALTER TABLE auth\.users\s+ALTER COLUMN email DROP NOT NULL/i);
  });

  it('adds the phone identity columns idempotently', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS phone_number TEXT/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT false/i);
  });

  it('enforces phone uniqueness with a nullable-friendly unique index', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_number ON auth\.users \(phone_number\)/i
    );
  });

  it('creates the SMS config singleton idempotently', () => {
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS sms/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS sms\.config/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS sms_config_singleton_idx ON sms\.config \(\(1\)\)/i
    );
    expect(sql).toMatch(
      /INSERT INTO sms\.config \(enabled\)\s+VALUES \(FALSE\)\s+ON CONFLICT DO NOTHING/i
    );
  });

  it('seeds a default OTP message template with the code placeholder', () => {
    expect(sql).toMatch(/otp_message_template TEXT NOT NULL DEFAULT/i);
    expect(sql).toContain('{{ code }}');
  });

  it('stores the auth token encrypted, not plaintext', () => {
    expect(sql).toContain('auth_token_encrypted');
    expect(sql).not.toMatch(/auth_token TEXT/i);
  });

  it('keeps SMS config writes behind the API for project_admin', () => {
    expect(sql).toMatch(/GRANT USAGE ON SCHEMA sms TO project_admin/i);
    expect(sql).toMatch(/REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA sms FROM project_admin/i);
    expect(sql).toMatch(/GRANT SELECT ON ALL TABLES IN SCHEMA sms TO project_admin/i);
  });
});
