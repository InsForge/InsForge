import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({ authorized: true }));
const backupServiceMock = vi.hoisted(() => ({
  getBackupConfig: vi.fn(),
  updateBackupConfig: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (
    req: { user?: { id: string }; hasApiKey?: boolean },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void
  ) => {
    if (!authMock.authorized) {
      res.status(401).json({ message: 'Unauthorized' });
      return;
    }
    req.user = { id: 'admin-1' };
    req.hasApiKey = false;
    next();
  },
}));

vi.mock('../../src/services/database/database-backup.service.js', () => ({
  DatabaseBackupService: {
    getInstance: () => backupServiceMock,
  },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: {
    getInstance: () => auditMock,
  },
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  res.status(statusCode).json({
    message: error instanceof Error ? error.message : 'Error',
  });
};

async function createApp() {
  const { databaseConfigRouter } = await import('../../src/api/routes/database/config.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/database/config', databaseConfigRouter);
  app.use(errorHandler);
  return app;
}

describe('database config routes', () => {
  const backup = {
    enabled: true,
    cronSchedule: '0 0 * * *',
    retentionDays: 7,
    nextBackupAt: '2026-07-30T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    authMock.authorized = true;
    backupServiceMock.getBackupConfig.mockResolvedValue(backup);
    backupServiceMock.updateBackupConfig.mockResolvedValue(backup);
    auditMock.log.mockResolvedValue(undefined);
  });

  it('returns the config nested under the backup section', async () => {
    const response = await request(await createApp()).get('/api/database/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ backup });
    expect(backupServiceMock.getBackupConfig).toHaveBeenCalledOnce();
  });

  it('rejects unauthenticated access', async () => {
    authMock.authorized = false;

    const get = await request(await createApp()).get('/api/database/config');
    const patch = await request(await createApp())
      .patch('/api/database/config')
      .send({ backup: { enabled: false } });

    expect(get.status).toBe(401);
    expect(patch.status).toBe(401);
    expect(backupServiceMock.updateBackupConfig).not.toHaveBeenCalled();
  });

  it('applies a nested backup patch and audits without touching other sections', async () => {
    const response = await request(await createApp())
      .patch('/api/database/config')
      .send({ backup: { enabled: true, retentionDays: 14 } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ backup });
    expect(backupServiceMock.updateBackupConfig).toHaveBeenCalledWith({
      enabled: true,
      retentionDays: 14,
    });
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE_DATABASE_CONFIG',
        module: 'DATABASE',
        details: {
          backup: { enabled: true, cronSchedule: '0 0 * * *', retentionDays: 7 },
        },
      })
    );
  });

  it('rejects a payload without the backup section', async () => {
    const response = await request(await createApp())
      .patch('/api/database/config')
      .send({});

    expect(response.status).toBe(400);
    expect(backupServiceMock.updateBackupConfig).not.toHaveBeenCalled();
    expect(auditMock.log).not.toHaveBeenCalled();
  });

  it('rejects an empty backup patch', async () => {
    const response = await request(await createApp())
      .patch('/api/database/config')
      .send({ backup: {} });

    expect(response.status).toBe(400);
    expect(backupServiceMock.updateBackupConfig).not.toHaveBeenCalled();
  });

  it('rejects out-of-range retention before it reaches the service', async () => {
    const response = await request(await createApp())
      .patch('/api/database/config')
      .send({ backup: { retentionDays: 5000 } });

    expect(response.status).toBe(400);
    expect(backupServiceMock.updateBackupConfig).not.toHaveBeenCalled();
  });
});
