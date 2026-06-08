import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
  currentDir,
  '../../src/infra/database/migrations/054_create-project-admins-table.sql'
);

describe('054_create-project-admins-table migration', () => {
  it('migration file exists', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('contains correct table definition and trigger', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS auth.project_admins');
    expect(sql).toContain('username TEXT UNIQUE NOT NULL');
    expect(sql).toContain('password_hash TEXT NOT NULL');
    expect(sql).toContain('CREATE TRIGGER update_project_admins_updated_at');
    expect(sql).toContain('system.update_updated_at()');
  });

  it('grants permissions to project_admin role', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).toContain("pg_roles WHERE rolname = 'project_admin'");
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE auth.project_admins TO project_admin'
    );
  });

  it('does not manage its own transaction', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    expect(sql).not.toMatch(/^\s*BEGIN\s*;/im);
    expect(sql).not.toMatch(/^\s*COMMIT\s*;/im);
  });
});
