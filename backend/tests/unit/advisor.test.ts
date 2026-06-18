import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const { queryMock, connectMock, clientQueryMock, releaseMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  connectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  releaseMock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        query: queryMock,
        connect: connectMock,
      })),
    })),
  },
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: vi.fn((req, _res, next) => {
    req.user = { id: 'admin-id', role: 'project_admin' };
    next();
  }),
}));

import { DatabaseAdvisorService } from '../../src/services/database/database-advisor.service';
import { advisorRouter } from '../../src/api/routes/advisor/index.routes';

let app: express.Express;

describe('Database Advisor Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue({ query: clientQueryMock, release: releaseMock });
    clientQueryMock.mockResolvedValue({ rows: [] });
    queryMock.mockResolvedValue({ rows: [] });
  });

  describe('DatabaseAdvisorService', () => {
    it('should trigger a scan and start it in background', async () => {
      const service = DatabaseAdvisorService.getInstance();
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_locks')) {
          return Promise.resolve({ rows: [{ is_locked: false }] });
        }
        if (sql.includes('INSERT INTO system.advisor_scans')) {
          return Promise.resolve({ rows: [{ id: 'scan-uuid' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const scanId = await service.triggerScan('manual');
      expect(scanId).toBe('scan-uuid');
      expect(service.isScanInProgress()).toBe(true);

      // Wait for background scan to finish
      await vi.waitFor(() => {
        expect(service.isScanInProgress()).toBe(false);
      });

      expect(connectMock).toHaveBeenCalled();
    });

    it('should reject concurrent scans with 409 Conflict', async () => {
      const service = DatabaseAdvisorService.getInstance();
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_locks')) {
          return Promise.resolve({ rows: [{ is_locked: false }] });
        }
        if (sql.includes('INSERT INTO system.advisor_scans')) {
          return Promise.resolve({ rows: [{ id: 'scan-uuid-1' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const firstScan = await service.triggerScan('manual');
      expect(firstScan).toBe('scan-uuid-1');

      // For the second call, we mock pg_locks returning true (locked)
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_locks')) {
          return Promise.resolve({ rows: [{ is_locked: true }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(service.triggerScan('manual')).rejects.toMatchObject({
        statusCode: 409,
        code: ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION,
      });

      // Wait for first background scan to finish
      await vi.waitFor(() => {
        expect(service.isScanInProgress()).toBe(false);
      });
    });

    it('should reset isScanning lock if DB insert fails in triggerScan', async () => {
      const service = DatabaseAdvisorService.getInstance();
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_locks')) {
          return Promise.resolve({ rows: [{ is_locked: false }] });
        }
        if (sql.includes('INSERT INTO system.advisor_scans')) {
          return Promise.reject(new Error('DB connection failure'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(service.triggerScan('manual')).rejects.toThrow('DB connection failure');
      expect(service.isScanInProgress()).toBe(false);
    });

    it('should query latest scan and return summary', async () => {
      const service = DatabaseAdvisorService.getInstance();
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('advisor_scans')) {
          return Promise.resolve({
            rows: [
              {
                id: 'scan-uuid',
                status: 'completed',
                scan_type: 'manual',
                scanned_at: new Date('2026-06-18T10:00:00Z'),
              },
            ],
          });
        }
        if (sql.includes('advisor_findings')) {
          return Promise.resolve({
            rows: [
              { severity: 'critical', count: 2 },
              { severity: 'warning', count: 3 },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const summary = await service.getLatestScan();
      expect(summary).not.toBeNull();
      expect(summary).toEqual({
        scanId: 'scan-uuid',
        status: 'completed',
        scanType: 'manual',
        scannedAt: '2026-06-18T10:00:00.000Z',
        summary: {
          total: 5,
          critical: 2,
          warning: 3,
          info: 0,
        },
      });
    });

    it('should query paginated findings/issues', async () => {
      const service = DatabaseAdvisorService.getInstance();
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('advisor_scans')) {
          return Promise.resolve({ rows: [{ id: 'scan-uuid' }] });
        }
        if (sql.includes('count(*)::int')) {
          return Promise.resolve({ rows: [{ total: 12 }] });
        }
        if (sql.includes('advisor_findings')) {
          return Promise.resolve({
            rows: [
              {
                id: '1',
                ruleId: 'rls-disabled',
                severity: 'critical',
                category: 'security',
                title: 'RLS disabled',
                description: 'Enable RLS',
                affectedObject: 'users',
                recommendation: 'ALTER TABLE',
                isResolved: false,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const result = await service.getLatestScanIssues({
        severity: 'critical',
        limit: 10,
        offset: 0,
      });

      expect(result.total).toBe(12);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].ruleId).toBe('rls-disabled');
    });
  });

  describe('Advisor Routes', () => {
    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/api/advisor', advisorRouter);
      app.use(
        (
          err: { statusCode?: number; message?: string },
          _req: express.Request,
          res: express.Response,
          _next: express.NextFunction
        ) => {
          void _next;
          res.status(err.statusCode || 500).json({ error: err.message });
        }
      );
    });

    it('POST /api/advisor/scan should start scan', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_locks')) {
          return Promise.resolve({ rows: [{ is_locked: false }] });
        }
        if (sql.includes('INSERT INTO system.advisor_scans')) {
          return Promise.resolve({ rows: [{ id: 'scan-uuid' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const res = await request(app).post('/api/advisor/scan').expect(201);

      expect(res.body).toEqual({
        scanId: 'scan-uuid',
        message: 'Scan started',
      });
    });

    it('GET /api/advisor/latest should return latest scan', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('advisor_scans')) {
          return Promise.resolve({
            rows: [
              {
                id: 'scan-uuid',
                status: 'completed',
                scan_type: 'manual',
                scanned_at: new Date('2026-06-18T10:00:00Z'),
              },
            ],
          });
        }
        if (sql.includes('advisor_findings')) {
          return Promise.resolve({
            rows: [{ severity: 'critical', count: 2 }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app).get('/api/advisor/latest').expect(200);

      expect(res.body.scanId).toBe('scan-uuid');
      expect(res.body.summary.critical).toBe(2);
    });

    it('GET /api/advisor/issues should return issues list', async () => {
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('advisor_scans')) {
          return Promise.resolve({ rows: [{ id: 'scan-uuid' }] });
        }
        if (sql.includes('count(*)::int')) {
          return Promise.resolve({ rows: [{ total: 1 }] });
        }
        if (sql.includes('advisor_findings')) {
          return Promise.resolve({
            rows: [
              {
                id: '1',
                ruleId: 'rls-disabled',
                severity: 'critical',
                category: 'security',
                title: 'RLS disabled',
                description: 'Enable RLS',
                isResolved: false,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .get('/api/advisor/issues')
        .query({ severity: 'critical' })
        .expect(200);

      expect(res.body.total).toBe(1);
      expect(res.body.issues[0].ruleId).toBe('rls-disabled');
    });

    it('GET /api/advisor/issues should return 400 for invalid limit or offset', async () => {
      const res = await request(app).get('/api/advisor/issues').query({ limit: 'abc' }).expect(400);

      expect(res.body.error).toContain('Invalid limit parameter');

      const res2 = await request(app)
        .get('/api/advisor/issues')
        .query({ offset: '-5' })
        .expect(400);

      expect(res2.body.error).toContain('Invalid offset parameter');
    });
  });
});
