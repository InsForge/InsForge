import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/054_grant-system-database-backups-select.sql'
);

function readMigration(): string {
  return fs.readFileSync(migrationPath, 'utf8');
}

describe('054_grant-system-database-backups-select migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('UP migration grants SELECT on system.database_backups to project_admin only if table and role exist', () => {
    const sql = readMigration();
    const upBlock = sql.match(/-- UP migration\s+DO \$\$([\s\S]*?)END \$\$;/);
    expect(upBlock).not.toBeNull();

    const upBody = upBlock![1];
    const grantPattern =
      /IF EXISTS\s*\(\s*SELECT 1 FROM pg_tables WHERE schemaname = 'system' AND tablename = 'database_backups'\s*\)\s*AND EXISTS\s*\(\s*SELECT 1 FROM pg_roles WHERE rolname = 'project_admin'\s*\)\s*THEN\s*EXECUTE 'GRANT SELECT ON TABLE system\.database_backups TO project_admin';/i;
    expect(upBody).toMatch(grantPattern);
  });

  it('sets default privileges for future system tables for postgres only', () => {
    const sql = readMigration();
    expect(sql).toMatch(
      /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA system GRANT SELECT ON TABLES TO project_admin/
    );

    expect(sql).not.toMatch(/FOR ROLE current_user/);
    expect(sql).not.toMatch(/format\('ALTER DEFAULT PRIVILEGES FOR ROLE %I/);
  });

  it('DOWN migration has conditional REVOKE guards and revokes default privileges for postgres only', () => {
    const sql = readMigration();
    const downSection = sql.split('-- DOWN migration')[1];
    expect(downSection).toBeDefined();

    expect(downSection).toMatch(
      /DO \$\$\s*BEGIN[\s\S]*IF EXISTS[\s\S]*REVOKE SELECT ON TABLE system\.database_backups FROM project_admin[\s\S]*END IF;[\s\S]*END \$\$/s
    );

    expect(downSection).toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA system REVOKE SELECT ON TABLES FROM project_admin'
    );

    expect(downSection).not.toMatch(/FOR ROLE current_user/);
    expect(downSection).not.toMatch(/format\('ALTER DEFAULT PRIVILEGES FOR ROLE %I/);
  });

  it('should run after migration 045 which creates project_admin', () => {
    const migrationsDir = path.join(currentDir, '../../src/infra/database/migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const idx045 = files.findIndex((f) => f.startsWith('045_'));
    const idx054 = files.findIndex((f) => f.startsWith('054_grant-system-database-backups-select'));

    expect(idx045).toBeGreaterThanOrEqual(0);
    expect(idx054).toBeGreaterThan(idx045);
  });
});
