import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationFile = '068_auto_enable_rls_on_create_table.sql';
const migrationDir = path.resolve(currentDir, '../../src/infra/database/migrations');
const migrationPath = path.join(migrationDir, migrationFile);
const dockerInitPath = path.resolve(currentDir, '../../../deploy/docker-init/db/db-init.sql');
const zeaburTemplatePath = path.resolve(currentDir, '../../../deploy/zeabur/template.yml');

function extractSqlBlock(source: string, startPattern: RegExp, endPattern: RegExp): string {
  const match = source.match(
    new RegExp(`${startPattern.source}[\\s\\S]*?${endPattern.source}`, 'i')
  );
  return match ? match[0] : '';
}

function normalizeSql(sql: string): string {
  return sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

describe('auto-enable-rls-on-create-table migration (068)', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const dockerInitSql = fs.readFileSync(dockerInitPath, 'utf8');
  const zeaburTemplateSql = fs.readFileSync(zeaburTemplatePath, 'utf8');

  it('defines the auto_enable_rls function in schema system with SECURITY DEFINER', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION system\.auto_enable_rls\(\)/i);
    expect(sql).toMatch(/RETURNS event_trigger/i);
    expect(sql).toMatch(/LANGUAGE plpgsql/i);
    expect(sql).toMatch(/SECURITY DEFINER/i);
  });

  it('hardens search_path to prevent injection attacks', () => {
    expect(sql).toMatch(/SET search_path = pg_catalog, pg_temp/i);
  });

  it('inspects pg_event_trigger_ddl_commands for CREATE TABLE, CREATE TABLE AS, and SELECT INTO', () => {
    expect(sql).toMatch(/pg_event_trigger_ddl_commands\(\)/i);
    expect(sql).toMatch(/command_tag IN \('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO'\)/i);
  });

  it('scopes auto-enforcement strictly to schema public and excludes extensions', () => {
    expect(sql).toMatch(/cmd\.schema_name = 'public'/i);
    expect(sql).toMatch(/cmd\.in_extension IS NULL OR NOT cmd\.in_extension/i);
  });

  it('targets ordinary and partitioned tables while excluding temporary tables', () => {
    expect(sql).toMatch(/c\.relkind IN \('r', 'p'\)/i);
    expect(sql).toMatch(/c\.relpersistence <> 't'/i);
  });

  it('is idempotent and checks NOT c.relrowsecurity before enabling', () => {
    expect(sql).toMatch(/NOT c\.relrowsecurity/i);
  });

  it('formats SQL safely using identifier quoting (%I)', () => {
    expect(sql).toMatch(
      /format\('ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY', cmd\.schema_name, v_relname\)/i
    );
  });

  it('grants EXECUTE on the function to project_admin when present', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION system\.auto_enable_rls\(\) TO project_admin/i);
  });

  it('installs the event trigger on ddl_command_end idempotently', () => {
    expect(sql).toMatch(/DROP EVENT TRIGGER IF EXISTS auto_enable_rls_on_create_table;/i);
    expect(sql).toMatch(/CREATE EVENT TRIGGER auto_enable_rls_on_create_table/i);
    expect(sql).toMatch(/ON ddl_command_end/i);
    expect(sql).toMatch(/EXECUTE FUNCTION system\.auto_enable_rls\(\)/i);
  });

  it('synchronizes deploy/docker-init/db/db-init.sql with the new event trigger', () => {
    expect(dockerInitSql).toMatch(/system\.auto_enable_rls/i);
    expect(dockerInitSql).toMatch(/auto_enable_rls_on_create_table/i);
    expect(dockerInitSql).not.toMatch(/create_policies_on_table_create/i);
    expect(dockerInitSql).not.toMatch(/create_default_policies\(\)/i);
  });

  it('maintains exact semantic parity of system.auto_enable_rls() between migration, docker-init, and zeabur template', () => {
    const fnStart = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+system\.auto_enable_rls\s*\(\)/;
    const fnEnd = /\$\$;/;

    const migrationFn = normalizeSql(extractSqlBlock(sql, fnStart, fnEnd));
    const dockerInitFn = normalizeSql(extractSqlBlock(dockerInitSql, fnStart, fnEnd));
    const zeaburFn = normalizeSql(extractSqlBlock(zeaburTemplateSql, fnStart, fnEnd));

    expect(migrationFn.length).toBeGreaterThan(0);
    expect(dockerInitFn).toBe(migrationFn);
    expect(zeaburFn).toBe(migrationFn);
  });

  it('maintains exact semantic parity of auto_enable_rls_on_create_table event trigger between migration, docker-init, and zeabur template', () => {
    const triggerStart = /CREATE\s+EVENT\s+TRIGGER\s+auto_enable_rls_on_create_table/;
    const triggerEnd = /EXECUTE\s+FUNCTION\s+system\.auto_enable_rls\s*\(\);/;

    const migrationTrigger = normalizeSql(extractSqlBlock(sql, triggerStart, triggerEnd));
    const dockerInitTrigger = normalizeSql(extractSqlBlock(dockerInitSql, triggerStart, triggerEnd));
    const zeaburTrigger = normalizeSql(extractSqlBlock(zeaburTemplateSql, triggerStart, triggerEnd));

    expect(migrationTrigger.length).toBeGreaterThan(0);
    expect(dockerInitTrigger).toBe(migrationTrigger);
    expect(zeaburTrigger).toBe(migrationTrigger);
  });
});
