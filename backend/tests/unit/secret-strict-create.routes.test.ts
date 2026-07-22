import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSecretRequestSchema, createSecretResponseSchema } from '@insforge/shared-schemas';

const { secretMocks, auditMocks, functionMocks, loggerMocks } = vi.hoisted(() => ({
  secretMocks: {
    listSecrets: vi.fn(),
    createSecret: vi.fn(),
    createSecretStrict: vi.fn(),
    updateSecret: vi.fn(),
  },
  auditMocks: { log: vi.fn() },
  functionMocks: {
    isSubhostingConfigured: vi.fn(),
    redeploy: vi.fn(),
  },
  loggerMocks: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: { getInstance: () => secretMocks },
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => auditMocks },
}));

vi.mock('../../src/services/functions/function.service.js', () => ({
  FunctionService: { getInstance: () => functionMocks },
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: vi.fn((req, _res, next) => {
    req.user = { id: 'admin-id', role: 'project_admin' };
    req.hasApiKey = false;
    next();
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({ default: loggerMocks }));

const routeErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;
  if (
    error instanceof Error &&
    'statusCode' in error &&
    typeof error.statusCode === 'number' &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      statusCode: error.statusCode,
    });
    return;
  }
  res.status(500).json({ error: 'INTERNAL_ERROR' });
};

async function createApp() {
  vi.resetModules();
  const { default: secretsRouter } = await import('../../src/api/routes/secrets/index.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/secrets', secretsRouter);
  app.use(routeErrorHandler);
  return app;
}

describe('POST /api/secrets strict create mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functionMocks.isSubhostingConfigured.mockReturnValue(true);
    auditMocks.log.mockResolvedValue({ id: 'audit-id' });
  });

  it('returns a durable, value-free strict-create receipt for an absent name', async () => {
    secretMocks.createSecretStrict.mockResolvedValue({ id: 'secret-id', disposition: 'created' });
    const app = await createApp();

    const response = await request(app)
      .post('/api/secrets')
      .send({ key: 'STRICT_KEY', value: 'candidate-value', mode: 'strict' })
      .expect(201);

    expect(response.body).toMatchObject({
      success: true,
      id: 'secret-id',
      disposition: 'created',
      auditId: 'audit-id',
    });
    expect(response.body.operationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(JSON.stringify(response.body)).not.toContain('candidate-value');
    expect(secretMocks.listSecrets).not.toHaveBeenCalled();
    expect(secretMocks.updateSecret).not.toHaveBeenCalled();
    expect(auditMocks.log).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          id: 'secret-id',
          disposition: 'created',
          operationId: response.body.operationId,
        }),
      })
    );
    expect(JSON.stringify(auditMocks.log.mock.calls)).not.toContain('candidate-value');
    expect(JSON.stringify(loggerMocks.info.mock.calls)).not.toContain('candidate-value');
    expect(functionMocks.redeploy).toHaveBeenCalledOnce();
  });

  it('returns 409 for an existing active name without audit or redeploy', async () => {
    secretMocks.createSecretStrict.mockRejectedValue(
      Object.assign(new Error('Secret already exists: ACTIVE_KEY'), {
        statusCode: 409,
        code: 'SECRET_ALREADY_EXISTS',
      })
    );
    const app = await createApp();

    await request(app)
      .post('/api/secrets')
      .send({ key: 'ACTIVE_KEY', value: 'candidate', mode: 'strict' })
      .expect(409);

    expect(auditMocks.log).not.toHaveBeenCalled();
    expect(functionMocks.redeploy).not.toHaveBeenCalled();
  });

  it('returns 409 for an inactive name without invoking legacy reactivation', async () => {
    secretMocks.createSecretStrict.mockRejectedValue(
      Object.assign(new Error('Secret already exists: TOMBSTONED_KEY'), {
        statusCode: 409,
        code: 'SECRET_ALREADY_EXISTS',
      })
    );
    const app = await createApp();

    await request(app)
      .post('/api/secrets')
      .send({ key: 'TOMBSTONED_KEY', value: 'candidate', mode: 'strict' })
      .expect(409);

    expect(secretMocks.listSecrets).not.toHaveBeenCalled();
    expect(secretMocks.updateSecret).not.toHaveBeenCalled();
    expect(auditMocks.log).not.toHaveBeenCalled();
    expect(functionMocks.redeploy).not.toHaveBeenCalled();
  });

  it('audits and redeploys only the winner of two concurrent creates', async () => {
    let attempt = 0;
    secretMocks.createSecretStrict.mockImplementation(async () => {
      const current = ++attempt;
      await Promise.resolve();
      if (current === 1) {
        return { id: 'winner-id', disposition: 'created' };
      }
      throw Object.assign(new Error('Secret already exists: RACE_KEY'), {
        statusCode: 409,
        code: 'SECRET_ALREADY_EXISTS',
      });
    });
    const app = await createApp();

    const responses = await Promise.all([
      request(app).post('/api/secrets').send({ key: 'RACE_KEY', value: 'first', mode: 'strict' }),
      request(app).post('/api/secrets').send({ key: 'RACE_KEY', value: 'second', mode: 'strict' }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(auditMocks.log).toHaveBeenCalledOnce();
    expect(functionMocks.redeploy).toHaveBeenCalledOnce();
  });

  it('preserves legacy inactive-row reactivation and response shape when mode is omitted', async () => {
    secretMocks.listSecrets.mockResolvedValue([
      { id: 'inactive-id', key: 'LEGACY_KEY', isActive: false },
    ]);
    secretMocks.updateSecret.mockResolvedValue(true);
    const app = await createApp();

    const response = await request(app)
      .post('/api/secrets')
      .send({ key: 'LEGACY_KEY', value: 'legacy-candidate' })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      message: 'Secret LEGACY_KEY has been created successfully',
      id: 'inactive-id',
    });
    expect(secretMocks.createSecretStrict).not.toHaveBeenCalled();
    expect(secretMocks.updateSecret).toHaveBeenCalledWith(
      'inactive-id',
      expect.objectContaining({ value: 'legacy-candidate', isActive: true })
    );
  });

  it('rejects unknown modes instead of silently falling back to legacy behavior', async () => {
    const app = await createApp();

    await request(app)
      .post('/api/secrets')
      .send({ key: 'STRICT_KEY', value: 'candidate', mode: 'replace' })
      .expect(400);

    expect(secretMocks.listSecrets).not.toHaveBeenCalled();
    expect(secretMocks.createSecret).not.toHaveBeenCalled();
    expect(secretMocks.createSecretStrict).not.toHaveBeenCalled();
  });
});

describe('strict create API schemas', () => {
  it('accepts both the unchanged legacy request and an explicit strict request', () => {
    expect(createSecretRequestSchema.safeParse({ key: 'LEGACY_KEY', value: 'value' }).success).toBe(
      true
    );
    expect(
      createSecretRequestSchema.safeParse({ key: 'STRICT_KEY', value: 'value', mode: 'strict' })
        .success
    ).toBe(true);
  });

  it('rejects an unknown create mode', () => {
    expect(
      createSecretRequestSchema.safeParse({ key: 'STRICT_KEY', value: 'value', mode: 'replace' })
        .success
    ).toBe(false);
  });

  it('keeps the legacy response valid and validates the strict receipt fields', () => {
    expect(
      createSecretResponseSchema.safeParse({
        success: true,
        message: 'created',
        id: 'legacy-id',
      }).success
    ).toBe(true);
    expect(
      createSecretResponseSchema.safeParse({
        success: true,
        message: 'created',
        id: 'strict-id',
        disposition: 'created',
        operationId: '11111111-1111-4111-8111-111111111111',
        auditId: 'audit-id',
      }).success
    ).toBe(true);
  });

  it('does not silently downcast a malformed strict receipt to the legacy shape', () => {
    const strictLikeReceipt = {
      success: true,
      message: 'created',
      id: 'strict-id',
      disposition: 'created',
      operationId: 'not-a-uuid',
      auditId: 'audit-id',
    };

    expect(createSecretResponseSchema.safeParse(strictLikeReceipt).success).toBe(false);
    expect(
      createSecretResponseSchema.safeParse({
        ...strictLikeReceipt,
        operationId: '11111111-1111-4111-8111-111111111111',
        auditId: 42,
      }).success
    ).toBe(false);
    expect(
      createSecretResponseSchema.safeParse({
        success: true,
        message: 'created',
        id: 'strict-id',
        disposition: 'created',
      }).success
    ).toBe(false);
  });
});
