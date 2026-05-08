import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('database schema route wiring', () => {
  const indexRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/database/index.routes.ts'),
    'utf-8'
  );
  const tableRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/database/tables.routes.ts'),
    'utf-8'
  );
  const adminRoutesSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/database/admin.routes.ts'),
    'utf-8'
  );

  it('adds a dedicated schema listing endpoint', () => {
    expect(indexRoutesSource).toMatch(/router\.get\(\s*'\/schemas'/);
    expect(indexRoutesSource).toContain('databaseService.getSchemas()');
  });

  it('mounts a separate admin database router for dashboard-only record access', () => {
    expect(indexRoutesSource).toContain("router.use('/admin', databaseAdminRouter);");
    expect(adminRoutesSource).toMatch(/router\.get\(\s*'\/tables\/:tableName\/records'/);
    expect(adminRoutesSource).toContain(
      'paginatedResponse(res, response.records, response.total, offset);'
    );
    expect(adminRoutesSource).not.toContain('PostgrestProxyService');
  });

  it('normalizes schema query params across dashboard database routes', () => {
    expect(indexRoutesSource).toContain('normalizeDatabaseSchemaName(req.query.schema)');
    expect(tableRoutesSource).toContain('normalizeDatabaseSchemaName(req.query.schema)');
  });

  it('passes schema names through table management handlers', () => {
    expect(tableRoutesSource).toContain('tableService.listTables(schemaName)');
    expect(tableRoutesSource).toContain(
      'tableService.createTable(schemaName, tableName, columns, rlsEnabled)'
    );
    expect(tableRoutesSource).toContain('tableService.getTableSchema(schemaName, tableName)');
    expect(tableRoutesSource).toContain(
      'tableService.updateTableSchema(schemaName, tableName, operations)'
    );
    expect(tableRoutesSource).toContain('tableService.deleteTable(schemaName, tableName)');
  });
});
