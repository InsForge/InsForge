import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const environmentMock = vi.hoisted(() => ({ isCloud: false }));
const configServiceMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));
const configUpdateErrorMock = vi.hoisted(() => {
  class ModelGatewayConfigUpdateError extends Error {
    constructor(
      message: string,
      readonly succeededFields: Array<'apiKey' | 'managementKey'>,
      readonly failedFields: Array<'apiKey' | 'managementKey'>
    ) {
      super(message);
      this.name = 'ModelGatewayConfigUpdateError';
    }
  }

  return { ModelGatewayConfigUpdateError };
});
const auditMock = vi.hoisted(() => ({ log: vi.fn() }));

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => environmentMock.isCloud,
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: (
    req: { user?: { id: string }; hasApiKey?: boolean },
    _res: unknown,
    next: () => void
  ) => {
    req.user = { id: 'admin-1' };
    req.hasApiKey = false;
    next();
  },
  verifyUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../src/services/ai/model-gateway-config.service.js', () => ({
  ModelGatewayConfigService: {
    getInstance: () => configServiceMock,
  },
  ModelGatewayConfigUpdateError: configUpdateErrorMock.ModelGatewayConfigUpdateError,
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: {
    getInstance: () => auditMock,
  },
}));

vi.mock('../../src/services/ai/chat-completion.service.js', () => ({
  ChatCompletionService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/ai/image-generation.service.js', () => ({
  ImageGenerationService: { getInstance: () => ({}) },
}));

vi.mock('../../src/services/ai/embedding.service.js', () => ({
  EmbeddingService: { getInstance: () => ({}) },
}));

vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: { getInstance: () => ({}) },
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  res.status(statusCode).json({ message: error instanceof Error ? error.message : 'Error' });
};

async function createApp() {
  const { aiRouter } = await import('../../src/api/routes/ai/index.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use(errorHandler);
  return app;
}

describe('AI config routes', () => {
  const config = {
    apiKey: { configured: true, maskedKey: 'sk-or••••' },
    managementKey: { configured: false, maskedKey: null },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    environmentMock.isCloud = false;
    configServiceMock.getConfig.mockResolvedValue(config);
    configServiceMock.updateConfig.mockResolvedValue(config);
    auditMock.log.mockResolvedValue(undefined);
  });

  it('returns masked self-hosted credential status', async () => {
    const response = await request(await createApp()).get('/api/ai/config');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(config);
    expect(configServiceMock.getConfig).toHaveBeenCalledOnce();
  });

  it('updates requested credentials and audits field names without values', async () => {
    const response = await request(await createApp())
      .put('/api/ai/config')
      .send({
        apiKey: 'new-api-key',
        managementKey: 'new-management-key',
      });

    expect(response.status).toBe(200);
    expect(configServiceMock.updateConfig).toHaveBeenCalledWith({
      apiKey: 'new-api-key',
      managementKey: 'new-management-key',
    });
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'admin-1',
        action: 'UPDATE_MODEL_GATEWAY_CONFIG',
        module: 'AI',
        details: {
          updatedFields: ['apiKey', 'managementKey'],
          failedFields: [],
          outcome: 'succeeded',
        },
      })
    );
    expect(JSON.stringify(auditMock.log.mock.calls)).not.toContain('new-api-key');
    expect(JSON.stringify(auditMock.log.mock.calls)).not.toContain('new-management-key');
  });

  it('returns the successful credential update when success audit logging fails', async () => {
    auditMock.log.mockRejectedValueOnce(new Error('audit insert failed'));

    const response = await request(await createApp())
      .put('/api/ai/config')
      .send({ apiKey: 'new-api-key' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(config);
    expect(configServiceMock.updateConfig).toHaveBeenCalledWith({ apiKey: 'new-api-key' });
    expect(auditMock.log).toHaveBeenCalledOnce();
  });

  it('audits exact field outcomes when an independent credential update partially succeeds', async () => {
    configServiceMock.updateConfig.mockRejectedValueOnce(
      new configUpdateErrorMock.ModelGatewayConfigUpdateError(
        'management update failed',
        ['apiKey'],
        ['managementKey']
      )
    );

    const response = await request(await createApp())
      .put('/api/ai/config')
      .send({
        apiKey: 'new-api-key',
        managementKey: 'new-management-key',
      });

    expect(response.status).toBe(500);
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE_MODEL_GATEWAY_CONFIG',
        details: {
          updatedFields: ['apiKey'],
          failedFields: ['managementKey'],
          outcome: 'partially_succeeded',
        },
      })
    );
    expect(JSON.stringify(auditMock.log.mock.calls)).not.toContain('new-api-key');
    expect(JSON.stringify(auditMock.log.mock.calls)).not.toContain('new-management-key');
  });

  it('audits all requested fields as failed when no credential update outcome is available', async () => {
    configServiceMock.updateConfig.mockRejectedValueOnce(new Error('secret listing failed'));

    const response = await request(await createApp())
      .put('/api/ai/config')
      .send({
        apiKey: 'new-api-key',
        managementKey: 'new-management-key',
      });

    expect(response.status).toBe(500);
    expect(auditMock.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'UPDATE_MODEL_GATEWAY_CONFIG',
        details: {
          updatedFields: [],
          failedFields: ['apiKey', 'managementKey'],
          outcome: 'failed',
        },
      })
    );
  });

  it('rejects an empty update payload', async () => {
    const response = await request(await createApp())
      .put('/api/ai/config')
      .send({});

    expect(response.status).toBe(400);
    expect(configServiceMock.updateConfig).not.toHaveBeenCalled();
    expect(auditMock.log).not.toHaveBeenCalled();
  });

  it.each([
    ['get', undefined],
    ['put', { apiKey: 'new-api-key' }],
  ] as const)('rejects cloud-hosted %s config requests', async (method, body) => {
    environmentMock.isCloud = true;
    const app = await createApp();
    const response =
      method === 'get'
        ? await request(app).get('/api/ai/config')
        : await request(app).put('/api/ai/config').send(body);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('managed by InsForge Cloud');
  });
});

describe('ai route wiring', () => {
  it('registers and guards the OpenRouter key rotation route', async () => {
    const { aiRouter } = await import('../../src/api/routes/ai/index.routes.js');
    const routeLayers = (
      aiRouter as unknown as {
        stack: Array<{
          route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: Array<{ handle: { name: string } }>;
          };
        }>;
      }
    ).stack.filter((layer) => layer.route);
    const rotateRoute = routeLayers.find(
      (layer) => layer.route?.path === '/:provider/api-key/rotate'
    );

    expect(Object.keys(rotateRoute?.route?.methods ?? {})).toContain('post');
    expect(rotateRoute?.route?.stack.map((handler) => handler.handle.name)).toContain(
      'verifyAdmin'
    );
  });
});
