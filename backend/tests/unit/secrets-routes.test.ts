import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const secretServiceMock = vi.hoisted(() => ({
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
  updateSecret: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ log: vi.fn() }));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => secretServiceMock },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => auditMock },
}));

vi.mock('../../src/services/functions/function.service.js', () => ({
  FunctionService: { getInstance: () => ({ isSubhostingConfigured: () => false }) },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function createApp() {
  const { default: secretsRouter } = await import('../../src/api/routes/secrets/index.routes.js');
  const { errorMiddleware } = await import('../../src/api/middlewares/error.js');
  const app = express();
  app.use(express.json());
  app.use('/api/secrets', secretsRouter);
  app.use(errorMiddleware);
  return app;
}

const existingSecret = {
  id: 'secret-1',
  key: 'STRIPE_API_KEY',
  isActive: true,
  isReserved: false,
  lastUsedAt: null,
  expiresAt: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('secrets routes request validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    secretServiceMock.listSecrets.mockResolvedValue([existingSecret]);
    secretServiceMock.createSecret.mockResolvedValue({ id: 'secret-2' });
    secretServiceMock.updateSecret.mockResolvedValue(true);
  });

  it.each([
    ['a missing value', { key: 'NEW_KEY' }],
    ['an array key', { key: ['NEW_KEY'], value: 'sk_live_123' }],
    ['a non-string value', { key: 'NEW_KEY', value: 42 }],
    ['a non-boolean isReserved', { key: 'NEW_KEY', value: 'sk_live_123', isReserved: 'yes' }],
    ['an unparseable expiresAt', { key: 'NEW_KEY', value: 'sk_live_123', expiresAt: 'next week' }],
  ])('rejects a create with %s before touching the store', async (_case, body) => {
    const res = await request(await createApp())
      .post('/api/secrets')
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
    expect(secretServiceMock.listSecrets).not.toHaveBeenCalled();
    expect(secretServiceMock.createSecret).not.toHaveBeenCalled();
  });

  it('creates a secret with the documented optional fields', async () => {
    const res = await request(await createApp())
      .post('/api/secrets')
      .send({
        key: 'NEW_KEY',
        value: 'sk_live_123',
        isReserved: true,
        expiresAt: '2027-01-01T00:00:00Z',
      });

    expect(res.status).toBe(201);
    expect(secretServiceMock.createSecret).toHaveBeenCalledWith({
      key: 'NEW_KEY',
      value: 'sk_live_123',
      isReserved: true,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
  });

  it.each([
    ['an empty body', {}],
    ['a non-boolean isActive', { isActive: 'false' }],
    ['a non-string value', { value: { nested: true } }],
    ['an unparseable expiresAt', { expiresAt: 'never' }],
  ])('rejects an update with %s before touching the store', async (_case, body) => {
    const res = await request(await createApp())
      .put('/api/secrets/STRIPE_API_KEY')
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(ERROR_CODES.INVALID_INPUT);
    expect(secretServiceMock.listSecrets).not.toHaveBeenCalled();
    expect(secretServiceMock.updateSecret).not.toHaveBeenCalled();
  });

  it('clears the expiry when an update sends expiresAt null', async () => {
    const res = await request(await createApp())
      .put('/api/secrets/STRIPE_API_KEY')
      .send({ expiresAt: null });

    expect(res.status).toBe(200);
    expect(secretServiceMock.updateSecret).toHaveBeenCalledWith('secret-1', { expiresAt: null });
  });
});
