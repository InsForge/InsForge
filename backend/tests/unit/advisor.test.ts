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
      clientQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve({ rows: [{ acquired: true }] });
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
      clientQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve({ rows: [{ acquired: true }] });
        }
        if (sql.includes('INSERT INTO system.advisor_scans')) {
          return Promise.resolve({ rows: [{ id: 'scan-uuid-1' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const firstScan = await service.triggerScan('manual');
      expect(firstScan).toBe('scan-uuid-1');

      // For the second call, we mock pg_try_advisory_lock returning false (locked)
      clientQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve({ rows: [{ acquired: false }] });
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
      clientQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve({ rows: [{ acquired: true }] });
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
                error_message: null,
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
        errorMessage: null,
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
      clientQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve({ rows: [{ acquired: true }] });
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

    it('GET /api/advisor/issues should return 400 for non-integer limit/offset', async () => {
      const res = await request(app).get('/api/advisor/issues').query({ limit: '1.5' }).expect(400);
      expect(res.body.error).toContain('Invalid limit parameter');

      const res2 = await request(app)
        .get('/api/advisor/issues')
        .query({ offset: '2abc' })
        .expect(400);
      expect(res2.body.error).toContain('Invalid offset parameter');
    });

    it('GET /api/advisor/issues should return 400 for invalid severity or category', async () => {
      const res = await request(app)
        .get('/api/advisor/issues')
        .query({ severity: 'urgent' })
        .expect(400);
      expect(res.body.error).toContain('Invalid severity parameter');

      const res2 = await request(app)
        .get('/api/advisor/issues')
        .query({ category: 'networking' })
        .expect(400);
      expect(res2.body.error).toContain('Invalid category parameter');
    });

    it('GET /api/advisor/suppressions should return suppressions list', async () => {
      vi.spyOn(DatabaseAdvisorService.getInstance(), 'listSuppressions').mockResolvedValue([
        {
          id: '11111111-1111-1111-1111-111111111111',
          ruleId: 'dangerous-function',
          affectedObject: 'public.f()',
          scope: 'instance',
          reason: 'false_positive',
          note: null,
          createdAt: new Date().toISOString(),
        },
      ]);

      const res = await request(app).get('/api/advisor/suppressions').expect(200);

      expect(res.body.suppressions).toHaveLength(1);
      expect(res.body.suppressions[0].ruleId).toBe('dangerous-function');
    });

    it('POST /api/advisor/suppressions should 400 on bad scope/reason', async () => {
      const bad1 = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'x', scope: 'nope', reason: 'false_positive', affectedObject: 'y' })
        .expect(400);
      expect(bad1.body.error).toContain('Invalid scope');

      const bad2 = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'x', scope: 'instance', reason: 'nope', affectedObject: 'y' })
        .expect(400);
      expect(bad2.body.error).toContain('Invalid reason');
    });

    it('POST /api/advisor/suppressions should 400 when reason is "other" without a note', async () => {
      const missing = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'x', scope: 'rule', reason: 'other' })
        .expect(400);
      expect(missing.body.error).toContain('required when reason is "other"');

      // Whitespace-only note must also be rejected (trim-based check).
      const whitespace = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'x', scope: 'rule', reason: 'other', note: '   ' })
        .expect(400);
      expect(whitespace.body.error).toContain('required when reason is "other"');
    });

    it('POST /api/advisor/suppressions should 201 when reason is "other" with a note', async () => {
      const createSpy = vi
        .spyOn(DatabaseAdvisorService.getInstance(), 'createSuppression')
        .mockResolvedValue({
          id: '66666666-6666-6666-6666-666666666666',
          ruleId: 'rls-select-only',
          affectedObject: null,
          scope: 'rule',
          reason: 'other',
          note: 'team decision',
          createdBy: 'admin-id',
          createdAt: new Date().toISOString(),
        });

      const res = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'rls-select-only', scope: 'rule', reason: 'other', note: 'team decision' })
        .expect(201);
      expect(res.body.reason).toBe('other');
      // The note must actually be forwarded to the service, not dropped.
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'other', note: 'team decision' })
      );
    });

    it('POST /api/advisor/suppressions should 400 when instance scope lacks affectedObject', async () => {
      const res = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'x', scope: 'instance', reason: 'wont_fix' })
        .expect(400);
      expect(res.body.error).toContain('Invalid affectedObject');
    });

    it('POST /api/advisor/suppressions should 201 on valid rule-scope body', async () => {
      vi.spyOn(DatabaseAdvisorService.getInstance(), 'createSuppression').mockResolvedValue({
        id: '22222222-2222-2222-2222-222222222222',
        ruleId: 'rls-select-only',
        affectedObject: null,
        scope: 'rule',
        reason: 'accepted_risk',
        note: null,
        createdAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/advisor/suppressions')
        .send({ ruleId: 'rls-select-only', scope: 'rule', reason: 'accepted_risk' })
        .expect(201);

      expect(res.body.id).toBe('22222222-2222-2222-2222-222222222222');
      expect(res.body.scope).toBe('rule');
    });

    it('POST /api/advisor/suppressions should 201 on instance scope and pass through the fingerprint', async () => {
      const createSpy = vi
        .spyOn(DatabaseAdvisorService.getInstance(), 'createSuppression')
        .mockResolvedValue({
          id: '44444444-4444-4444-4444-444444444444',
          ruleId: 'dangerous-function',
          affectedObject: 'public.f()',
          scope: 'instance',
          reason: 'false_positive',
          note: null,
          createdBy: 'admin-id',
          createdAt: new Date().toISOString(),
        });

      const res = await request(app)
        .post('/api/advisor/suppressions')
        // Leading/trailing whitespace on ruleId must be trimmed before persisting.
        .send({
          ruleId: '  dangerous-function  ',
          scope: 'instance',
          reason: 'false_positive',
          affectedObject: 'public.f()',
          note: null,
        })
        .expect(201);

      expect(res.body.scope).toBe('instance');
      expect(createSpy).toHaveBeenCalledWith({
        ruleId: 'dangerous-function',
        affectedObject: 'public.f()',
        scope: 'instance',
        reason: 'false_positive',
        note: null,
        createdBy: 'admin-id',
      });
    });

    it('POST /api/advisor/suppressions should null out affectedObject for rule scope', async () => {
      const createSpy = vi
        .spyOn(DatabaseAdvisorService.getInstance(), 'createSuppression')
        .mockResolvedValue({
          id: '55555555-5555-5555-5555-555555555555',
          ruleId: 'rls-select-only',
          affectedObject: null,
          scope: 'rule',
          reason: 'accepted_risk',
          note: null,
          createdBy: 'admin-id',
          createdAt: new Date().toISOString(),
        });

      await request(app)
        .post('/api/advisor/suppressions')
        // A stray affectedObject on a rule-scope request must be dropped.
        .send({
          ruleId: 'rls-select-only',
          scope: 'rule',
          reason: 'accepted_risk',
          affectedObject: 'ignored.for.rule.scope',
        })
        .expect(201);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'rule', affectedObject: null })
      );
    });

    it('DELETE /api/advisor/suppressions/:id should 200 with { deleted: true } on success', async () => {
      vi.spyOn(DatabaseAdvisorService.getInstance(), 'deleteSuppression').mockResolvedValue(true);

      const res = await request(app)
        .delete('/api/advisor/suppressions/33333333-3333-3333-3333-333333333333')
        .expect(200);
      expect(res.body.deleted).toBe(true);
    });

    it('DELETE /api/advisor/suppressions/:id should 400 on a malformed (non-UUID) id', async () => {
      const deleteSpy = vi.spyOn(DatabaseAdvisorService.getInstance(), 'deleteSuppression');

      const res = await request(app).delete('/api/advisor/suppressions/not-a-uuid').expect(400);
      expect(res.body.error).toContain('Invalid id');
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('DELETE /api/advisor/suppressions/:id should 404 when missing', async () => {
      vi.spyOn(DatabaseAdvisorService.getInstance(), 'deleteSuppression').mockResolvedValue(false);

      const res = await request(app)
        .delete('/api/advisor/suppressions/33333333-3333-3333-3333-333333333333')
        .expect(404);
      expect(res.body.error).toBe('Suppression not found');
    });
  });
});
