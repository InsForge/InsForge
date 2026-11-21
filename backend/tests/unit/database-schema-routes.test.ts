import { describe, expect, it, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import express from 'express';
import request from 'supertest';
import { AppError } from '../../src/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const {
  mockTableService,
  mockAuditService,
  mockTokenManager,
  mockSecretService,
  mockDatabaseService,
  mockAdminRecordService,
} = vi.hoisted(() => ({
  mockTableService: {
    listTables: vi.fn(),
    getTableRlsStatuses: vi.fn(),
    createTable: vi.fn(),
    getTableSchema: vi.fn(),
    updateTableSchema: vi.fn(),
    deleteTable: vi.fn(),
    enableTableRLS: vi.fn(),
  },
  mockAuditService: {
    log: vi.fn().mockResolvedValue(undefined),
  },
  mockTokenManager: {
    verifyToken: vi.fn(),
    verifyCloudProjectAuthorization: vi.fn(),
    generatePostgrestAdminToken: vi.fn(() => 'mock-admin-token'),
    generatePostgrestAnonToken: vi.fn(() => 'mock-anon-token'),
  },
  mockSecretService: {
    verifyApiKey: vi.fn(),
  },
  mockDatabaseService: {
    getSchemas: vi.fn(),
    getFunctions: vi.fn(),
    getIndexes: vi.fn(),
    getPolicies: vi.fn(),
    getTriggers: vi.fn(),
  },
  mockAdminRecordService: {
    listRecords: vi.fn(),
    lookupRecord: vi.fn(),
    createRecords: vi.fn(),
    updateRecord: vi.fn(),
    deleteRecords: vi.fn(),
  },
}));

vi.mock('../../src/services/database/database-table.service.js', () => ({
  DatabaseTableService: { getInstance: () => mockTableService },
}));

vi.mock('../../src/services/database/database.service.js', () => ({
  DatabaseService: { getInstance: () => mockDatabaseService },
}));

vi.mock('../../src/services/database/admin-record.service.js', () => ({
  AdminRecordService: { getInstance: () => mockAdminRecordService },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => mockAuditService },
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => mockTokenManager },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => mockSecretService },
}));

import { databaseTablesRouter } from '../../src/api/routes/database/tables.routes.js';
import databaseIndexRouter from '../../src/api/routes/database/index.routes.js';
import { errorMiddleware } from '../../src/api/middlewares/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/database/tables', databaseTablesRouter);
  app.use('/api/database', databaseIndexRouter);
  app.use(errorMiddleware);
  return app;
}

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
    expect(adminRoutesSource).toContain('normalizeDatabaseSchemaName(req.query.schema)');
  });

  it('validates schema query params before normalizing across database routes', () => {
    expect(indexRoutesSource).toContain('validateSchemaQueryParam(req.query.schema)');
    expect(tableRoutesSource).toContain('validateSchemaQueryParam(req.query.schema)');
    expect(adminRoutesSource).toContain('validateSchemaQueryParam(req.query.schema)');
  });

  it('passes schema names through table management handlers', () => {
    expect(tableRoutesSource).toContain('tableService.listTables(schemaName)');
    expect(tableRoutesSource).toContain(
      'const { tableName, columns, foreignKeys, rlsEnabled } = validation.data'
    );
    expect(tableRoutesSource).toMatch(
      /tableService\.createTable\(\s*schemaName,\s*tableName,\s*columns,\s*foreignKeys,\s*rlsEnabled\s*\)/s
    );
    expect(tableRoutesSource).toContain('tableService.getTableSchema(schemaName, tableName)');
    expect(tableRoutesSource).toContain(
      'tableService.updateTableSchema(schemaName, tableName, operations)'
    );
    expect(tableRoutesSource).toContain('tableService.deleteTable(schemaName, tableName)');
    expect(tableRoutesSource).toContain("router.post(\n  '/:tableName/enable-rls',\n  verifyAdmin");
    expect(tableRoutesSource).toContain('tableService.enableTableRLS(schemaName, tableName)');
    expect(tableRoutesSource).toContain("action: 'UPDATE_TABLE_RLS'");
  });
});

describe('database tables route endpoints', () => {
  const app = createTestApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/database/tables/rls-status', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/database/tables/rls-status');
      expect(res.status).toBe(401);
      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });

    it('rejects non-admin authenticated users with 403', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'authenticated', sub: 'user-1' });

      const res = await request(app)
        .get('/api/database/tables/rls-status')
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(403);
      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });

    it('returns RLS statuses for public schema by default for project admin', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
      mockTableService.getTableRlsStatuses.mockResolvedValue([
        { tableName: 'users', schemaName: 'public', rlsEnabled: true },
        { tableName: 'notes', schemaName: 'public', rlsEnabled: false },
      ]);

      const res = await request(app)
        .get('/api/database/tables/rls-status')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(mockTableService.getTableRlsStatuses).toHaveBeenCalledWith('public');
      expect(res.body).toEqual([
        { tableName: 'users', schemaName: 'public', rlsEnabled: true },
        { tableName: 'notes', schemaName: 'public', rlsEnabled: false },
      ]);
    });

    it('passes custom schema query parameter', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
      mockTableService.getTableRlsStatuses.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/database/tables/rls-status?schema=custom_schema')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(mockTableService.getTableRlsStatuses).toHaveBeenCalledWith('custom_schema');
    });

    it('propagates service errors to error middleware', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
      mockTableService.getTableRlsStatuses.mockRejectedValue(
        new AppError('Schema error', 400, ERROR_CODES.INVALID_INPUT)
      );

      const res = await request(app)
        .get('/api/database/tables/rls-status')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Schema error');
    });

    it('rejects repeated schema query parameters with HTTP 400', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

      const res = await request(app)
        .get('/api/database/tables/rls-status?schema=public&schema=custom_scope')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
      expect(res.body.message).toBe(
        'The "schema" query parameter must be a single non-empty schema name.'
      );
      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });

    it('rejects empty or whitespace schema query parameter with HTTP 400', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

      const emptyRes = await request(app)
        .get('/api/database/tables/rls-status?schema=')
        .set('Authorization', 'Bearer admin-token');

      expect(emptyRes.status).toBe(400);
      expect(emptyRes.body.error).toBe(ERROR_CODES.INVALID_INPUT);
      expect(emptyRes.body.message).toBe(
        'The "schema" query parameter must be a single non-empty schema name.'
      );

      const whitespaceRes = await request(app)
        .get('/api/database/tables/rls-status?schema=%20%20')
        .set('Authorization', 'Bearer admin-token');

      expect(whitespaceRes.status).toBe(400);
      expect(whitespaceRes.body.error).toBe(ERROR_CODES.INVALID_INPUT);
      expect(whitespaceRes.body.message).toBe(
        'The "schema" query parameter must be a single non-empty schema name.'
      );

      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });

    it('rejects malformed non-string object schema query parameter with HTTP 400', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

      const res = await request(app)
        .get('/api/database/tables/rls-status?schema[name]=custom')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
      expect(res.body.message).toBe(
        'The "schema" query parameter must be a single non-empty schema name.'
      );
      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });

    it('preserves 401 unauthenticated response even when repeated schema is passed', async () => {
      const res = await request(app).get(
        '/api/database/tables/rls-status?schema=public&schema=custom_scope'
      );

      expect(res.status).toBe(401);
      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });

    it('preserves 403 non-admin forbidden response even when repeated schema is passed', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'authenticated', sub: 'user-1' });

      const res = await request(app)
        .get('/api/database/tables/rls-status?schema=public&schema=custom_scope')
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(403);
      expect(mockTableService.getTableRlsStatuses).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/database/tables/:tableName/enable-rls', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await request(app).post('/api/database/tables/orders/enable-rls');
      expect(res.status).toBe(401);
      expect(mockTableService.enableTableRLS).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('rejects non-admin authenticated users with 403', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'authenticated', sub: 'user-1' });

      const res = await request(app)
        .post('/api/database/tables/orders/enable-rls')
        .set('Authorization', 'Bearer user-token');

      expect(res.status).toBe(403);
      expect(mockTableService.enableTableRLS).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('enables RLS, logs audit entry, and returns result for project admin', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-42' });
      mockTableService.enableTableRLS.mockResolvedValue({
        success: true,
        tableName: 'orders',
        schemaName: 'public',
        rlsEnabled: true,
      });

      const res = await request(app)
        .post('/api/database/tables/orders/enable-rls')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(mockTableService.enableTableRLS).toHaveBeenCalledWith('public', 'orders');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'admin-42',
          action: 'UPDATE_TABLE_RLS',
          module: 'DATABASE',
          details: {
            schemaName: 'public',
            tableName: 'orders',
            rlsEnabled: true,
          },
        })
      );
      expect(res.body).toEqual({
        success: true,
        tableName: 'orders',
        schemaName: 'public',
        rlsEnabled: true,
      });
    });

    it('supports API key authentication with actor="api-key"', async () => {
      mockSecretService.verifyApiKey.mockResolvedValue(true);
      mockTableService.enableTableRLS.mockResolvedValue({
        success: true,
        tableName: 'orders',
        schemaName: 'public',
        rlsEnabled: true,
      });

      const res = await request(app)
        .post('/api/database/tables/orders/enable-rls')
        .set('x-api-key', 'ik_test_key');

      expect(res.status).toBe(200);
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'api-key',
          action: 'UPDATE_TABLE_RLS',
        })
      );
    });

    it('respects schema query parameter', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-42' });
      mockTableService.enableTableRLS.mockResolvedValue({
        success: true,
        tableName: 'orders',
        schemaName: 'tenant_1',
        rlsEnabled: true,
      });

      const res = await request(app)
        .post('/api/database/tables/orders/enable-rls?schema=tenant_1')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(mockTableService.enableTableRLS).toHaveBeenCalledWith('tenant_1', 'orders');
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          details: {
            schemaName: 'tenant_1',
            tableName: 'orders',
            rlsEnabled: true,
          },
        })
      );
    });

    it('returns 404 when table does not exist', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-42' });
      mockTableService.enableTableRLS.mockRejectedValue(
        new AppError(
          'Table "missing" does not exist in schema "public"',
          404,
          ERROR_CODES.NOT_FOUND
        )
      );

      const res = await request(app)
        .post('/api/database/tables/missing/enable-rls')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(404);
      expect(res.body.message).toContain('does not exist');
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('returns 400 when identifier validation fails', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-42' });
      mockTableService.enableTableRLS.mockRejectedValue(
        new AppError('Invalid table name', 400, ERROR_CODES.INVALID_INPUT)
      );

      const res = await request(app)
        .post('/api/database/tables/bad%22table/enable-rls')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Invalid table name');
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });

    it('rejects repeated schema query parameters with HTTP 400', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-42' });

      const res = await request(app)
        .post('/api/database/tables/orders/enable-rls?schema=public&schema=tenant_1')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
      expect(res.body.message).toBe(
        'The "schema" query parameter must be a single non-empty schema name.'
      );
      expect(mockTableService.enableTableRLS).not.toHaveBeenCalled();
      expect(mockAuditService.log).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/database/tables', () => {
    it('defaults to public schema when query schema is omitted', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
      mockTableService.listTables.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/database/tables')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(mockTableService.listTables).toHaveBeenCalledWith('public');
    });

    it('passes single valid schema query parameter', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
      mockTableService.listTables.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/database/tables?schema=tenant_1')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(200);
      expect(mockTableService.listTables).toHaveBeenCalledWith('tenant_1');
    });

    it('rejects repeated schema query parameter with HTTP 400', async () => {
      mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

      const res = await request(app)
        .get('/api/database/tables?schema=public&schema=tenant_1')
        .set('Authorization', 'Bearer admin-token');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
      expect(res.body.message).toBe(
        'The "schema" query parameter must be a single non-empty schema name.'
      );
      expect(mockTableService.listTables).not.toHaveBeenCalled();
    });
  });

  describe('database metadata route endpoints (index.routes)', () => {
    describe('GET /api/database/functions', () => {
      it('defaults to public schema when query schema is omitted', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockDatabaseService.getFunctions.mockResolvedValue([]);

        const res = await request(app)
          .get('/api/database/functions')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockDatabaseService.getFunctions).toHaveBeenCalledWith('public');
      });

      it('passes single valid schema query parameter', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockDatabaseService.getFunctions.mockResolvedValue([]);

        const res = await request(app)
          .get('/api/database/functions?schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockDatabaseService.getFunctions).toHaveBeenCalledWith('tenant_1');
      });

      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/functions?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockDatabaseService.getFunctions).not.toHaveBeenCalled();
      });

      it('rejects empty schema query parameter with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/functions?schema=')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockDatabaseService.getFunctions).not.toHaveBeenCalled();
      });

      it('rejects whitespace-only schema query parameter with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/functions?schema=%20%20')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockDatabaseService.getFunctions).not.toHaveBeenCalled();
      });
    });

    describe('GET /api/database/indexes', () => {
      it('passes single valid schema query parameter', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockDatabaseService.getIndexes.mockResolvedValue([]);

        const res = await request(app)
          .get('/api/database/indexes?schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockDatabaseService.getIndexes).toHaveBeenCalledWith('tenant_1');
      });

      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/indexes?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockDatabaseService.getIndexes).not.toHaveBeenCalled();
      });
    });

    describe('GET /api/database/policies', () => {
      it('passes single valid schema query parameter', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockDatabaseService.getPolicies.mockResolvedValue([]);

        const res = await request(app)
          .get('/api/database/policies?schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockDatabaseService.getPolicies).toHaveBeenCalledWith('tenant_1');
      });

      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/policies?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockDatabaseService.getPolicies).not.toHaveBeenCalled();
      });
    });

    describe('GET /api/database/triggers', () => {
      it('passes single valid schema query parameter', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockDatabaseService.getTriggers.mockResolvedValue([]);

        const res = await request(app)
          .get('/api/database/triggers?schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockDatabaseService.getTriggers).toHaveBeenCalledWith('tenant_1');
      });

      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/triggers?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockDatabaseService.getTriggers).not.toHaveBeenCalled();
      });
    });
  });

  describe('database admin route endpoints (admin.routes)', () => {
    describe('GET /api/database/admin/tables/:tableName/records', () => {
      it('defaults to public schema when query schema is omitted', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockAdminRecordService.listRecords.mockResolvedValue({ records: [], total: 0 });

        const res = await request(app)
          .get('/api/database/admin/tables/users/records')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockAdminRecordService.listRecords).toHaveBeenCalledWith(
          'public',
          'users',
          expect.any(Object)
        );
      });

      it('passes single valid schema query parameter', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });
        mockAdminRecordService.listRecords.mockResolvedValue({ records: [], total: 0 });

        const res = await request(app)
          .get('/api/database/admin/tables/users/records?schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(200);
        expect(mockAdminRecordService.listRecords).toHaveBeenCalledWith(
          'tenant_1',
          'users',
          expect.any(Object)
        );
      });

      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/admin/tables/users/records?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.listRecords).not.toHaveBeenCalled();
      });

      it('rejects empty schema query parameter with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/admin/tables/users/records?schema=')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.listRecords).not.toHaveBeenCalled();
      });

      it('rejects whitespace-only schema query parameter with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get('/api/database/admin/tables/users/records?schema=%20%20')
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.listRecords).not.toHaveBeenCalled();
      });
    });

    describe('GET /api/database/admin/tables/:tableName/records/lookup', () => {
      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .get(
            '/api/database/admin/tables/users/records/lookup?column=id&value=1&schema=public&schema=tenant_1'
          )
          .set('Authorization', 'Bearer admin-token');

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.lookupRecord).not.toHaveBeenCalled();
      });
    });

    describe('POST /api/database/admin/tables/:tableName/records', () => {
      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .post('/api/database/admin/tables/users/records?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token')
          .send([{ name: 'Alice' }]);

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.createRecords).not.toHaveBeenCalled();
      });
    });

    describe('PATCH /api/database/admin/tables/:tableName/records', () => {
      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .patch('/api/database/admin/tables/users/records?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token')
          .send({ pkKeys: { id: 1 }, data: { name: 'Bob' } });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.updateRecord).not.toHaveBeenCalled();
      });
    });

    describe('DELETE /api/database/admin/tables/:tableName/records', () => {
      it('rejects repeated schema query parameters with HTTP 400', async () => {
        mockTokenManager.verifyToken.mockReturnValue({ role: 'project_admin', sub: 'admin-1' });

        const res = await request(app)
          .delete('/api/database/admin/tables/users/records?schema=public&schema=tenant_1')
          .set('Authorization', 'Bearer admin-token')
          .send({ pkKeys: [{ id: 1 }] });

        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
        expect(res.body.message).toBe(
          'The "schema" query parameter must be a single non-empty schema name.'
        );
        expect(mockAdminRecordService.deleteRecords).not.toHaveBeenCalled();
      });
    });
  });
});
