import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDirectory,
  '../../src/infra/database/migrations/060_add-email-otp-sign-in.sql'
);

describe('060_add-email-otp-sign-in migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('restores a persistent OTP attempt counter idempotently', () => {
    expect(sql).toMatch(
      /ALTER TABLE auth\.email_otps\s+ADD COLUMN IF NOT EXISTS attempts_count INTEGER NOT NULL DEFAULT 0/i
    );
  });

  it('adds a delivery-type discriminator and backfills existing rows', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS otp_type TEXT NOT NULL DEFAULT 'NUMERIC_CODE'/i);
    expect(sql).toMatch(/SET otp_type = 'HASH_TOKEN'\s+WHERE otp_hash NOT LIKE '\$2%'/i);
  });

  it('adds a functional index for case-insensitive user lookup idempotently', () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_users_lower_email ON auth\.users \(lower\(email\)\)/i
    );
  });

  it('seeds the SMTP request-otp template idempotently', () => {
    expect(sql).toMatch(/INSERT INTO email\.templates/i);
    expect(sql).toContain("'request-otp'");
    expect(sql).toContain('{{ token }}');
    expect(sql).toMatch(/ON CONFLICT \(template_type\) DO NOTHING/i);
  });
});
