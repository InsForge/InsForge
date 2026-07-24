import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/060_add-email-otp-sign-in.sql'
);

describe('060_add-email-otp-sign-in migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('restores a persistent OTP attempt counter idempotently', () => {
    expect(sql).toMatch(
      /ALTER TABLE auth\.email_otps\s+ADD COLUMN IF NOT EXISTS attempts_count INTEGER NOT NULL DEFAULT 0/i
    );
  });

  it('seeds the SMTP request-otp template idempotently', () => {
    expect(sql).toMatch(/INSERT INTO email\.templates/i);
    expect(sql).toContain("'request-otp'");
    expect(sql).toContain('{{ token }}');
    expect(sql).toMatch(/ON CONFLICT \(template_type\) DO NOTHING/i);
  });
});
