import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDirectory,
  '../../src/infra/database/migrations/062_add-oauth-native-client-ids.sql'
);

describe('062_add-oauth-native-client-ids migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('adds the native audience allowlist idempotently', () => {
    expect(sql).toMatch(
      /ALTER TABLE auth\.oauth_configs\s+ADD COLUMN IF NOT EXISTS native_client_ids TEXT\[\] NOT NULL DEFAULT '\{\}'/i
    );
  });
});
