import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/030_rename-code-to-token-in-email-templates.sql'
);

describe('030_rename-code-to-token-in-email-templates migration', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('replaces {{ code }} with {{ token }} in body_html', () => {
    expect(sql).toMatch(
      /REPLACE\s*\(\s*body_html\s*,\s*'\{\{ code \}\}'\s*,\s*'\{\{ token \}\}'\s*\)/i
    );
  });

  it('only targets the code-based template types', () => {
    expect(sql).toMatch(
      /template_type\s+IN\s*\(\s*'email-verification-code'\s*,\s*'reset-password-code'\s*\)/i
    );
  });

  it('guards the update with a LIKE check so re-runs are no-ops', () => {
    expect(sql).toMatch(/body_html\s+LIKE\s+'%\{\{ code \}\}%'/i);
  });

  it('runs after migration 029', () => {
    const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
    const migrations = fs
      .readdirSync(migrationDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const idx030 = migrations.indexOf('030_rename-code-to-token-in-email-templates.sql');
    const idx029 = migrations.indexOf('029_create-smtp-config-and-email-templates.sql');
    expect(idx029).toBeGreaterThanOrEqual(0);
    expect(idx030).toBeGreaterThan(idx029);
  });
});
