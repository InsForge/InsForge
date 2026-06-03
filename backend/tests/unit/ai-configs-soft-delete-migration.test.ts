import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/023_ai-configs-soft-delete.sql'
);

describe('023_ai-configs-soft-delete migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('adds is_active idempotently', () => {
    expect(sql).toMatch(
      /ALTER TABLE ai\.configs\s+ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;/i
    );
  });

  it('does not use a bare ADD COLUMN for is_active', () => {
    expect(sql).not.toMatch(/ADD COLUMN is_active BOOLEAN/i);
  });

  it('does not manage its own transaction', () => {
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/im);
  });
});
