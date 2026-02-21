import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

describe('AI usage FK migration', () => {
  it('restores ai.usage.config_id foreign key to ON DELETE SET NULL', () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationPath = path.resolve(
      currentDir,
      '../../src/infra/database/migrations/023_restore-ai-usage-fk-set-null.sql'
    );

    expect(fs.existsSync(migrationPath), `Migration file not found at: ${migrationPath}`).toBe(true);

    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/\bBEGIN\b\s*;/i);
    expect(sql).toMatch(/ALTER TABLE\s+ai\.usage\s+ALTER COLUMN\s+config_id\s+DROP NOT NULL/i);
    expect(sql).toMatch(/DROP CONSTRAINT\s+IF EXISTS\s+usage_config_id_fkey/i);
    expect(sql).toMatch(
      /FOREIGN KEY\s*\(config_id\)\s*REFERENCES\s+ai\.configs\(id\)\s+ON DELETE SET NULL/i
    );
    expect(sql).toMatch(/\bCOMMIT\b\s*;/i);

    const dropNotNullPos = sql.search(/ALTER COLUMN\s+config_id\s+DROP NOT NULL/i);
    const addConstraintPos = sql.search(
      /ADD CONSTRAINT\s+usage_config_id_fkey[\s\S]*ON DELETE SET NULL/i
    );
    expect(dropNotNullPos).toBeLessThan(addConstraintPos);
  });
});
