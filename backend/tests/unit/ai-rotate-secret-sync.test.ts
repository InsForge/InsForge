import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-secret-long-enough-for-signing-32chars';
});

const authMocks = vi.hoisted(() => ({
  verifyAdmin: vi.fn((_req, _res, next) => next()),
  verifyUser: vi.fn((_req, _res, next) => next()),
}));

const openRouterMocks = vi.hoisted(() => ({
  rotateManagedApiKey: vi.fn(),
}));

const secretMocks = vi.hoisted(() => ({
  updateSecretByKey: vi.fn(),
}));

const functionMocks = vi.hoisted(() => ({
  isSubhostingConfigured: vi.fn(),
  redeploy: vi.fn(),
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyAdmin: authMocks.verifyAdmin,
  verifyUser: authMocks.verifyUser,
}));

vi.mock('../../src/providers/ai/openrouter.provider.js', () => ({
  OpenRouterProvider: {
    getInstance: () => openRouterMocks,
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => secretMocks,
  },
}));

vi.mock('../../src/services/functions/function.service.js', () => ({
  FunctionService: {
    getInstance: () => functionMocks,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { aiRouter } from '../../src/api/routes/ai/index.routes';
import { AppError } from '../../src/utils/errors';

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  void next;

  const status = err instanceof AppError ? err.statusCode : 500;
  res.status(status).json({ message: err instanceof Error ? err.message : 'error' });
};

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /api/ai/openrouter/api-key/rotate secret sync', () => {
  const rotatedKey = 'sk-or-rotated-1234567890';
  const maskedKey = 'sk-or-ro••••••••7890';

  beforeEach(() => {
    vi.clearAllMocks();
    openRouterMocks.rotateManagedApiKey.mockResolvedValue({
      apiKey: rotatedKey,
      maskedKey,
    });
    secretMocks.updateSecretByKey.mockResolvedValue(true);
    functionMocks.isSubhostingConfigured.mockReturnValue(true);
  });

  it('updates the OPENROUTER_API_KEY secret with the rotated key and redeploys functions', async () => {
    const response = await request(createApp()).post('/api/ai/openrouter/api-key/rotate');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ apiKey: rotatedKey, maskedKey });
    expect(secretMocks.updateSecretByKey).toHaveBeenCalledWith('OPENROUTER_API_KEY', {
      value: rotatedKey,
    });
    expect(functionMocks.redeploy).toHaveBeenCalledTimes(1);
  });

  it('skips redeployment when no OPENROUTER_API_KEY secret exists', async () => {
    secretMocks.updateSecretByKey.mockResolvedValue(false);

    const response = await request(createApp()).post('/api/ai/openrouter/api-key/rotate');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ apiKey: rotatedKey });
    expect(functionMocks.redeploy).not.toHaveBeenCalled();
  });

  it('skips redeployment when subhosting is not configured', async () => {
    functionMocks.isSubhostingConfigured.mockReturnValue(false);

    const response = await request(createApp()).post('/api/ai/openrouter/api-key/rotate');

    expect(response.status).toBe(200);
    expect(functionMocks.redeploy).not.toHaveBeenCalled();
  });

  it('still returns the rotated key when the secret sync fails', async () => {
    secretMocks.updateSecretByKey.mockRejectedValue(new Error('db down'));

    const response = await request(createApp()).post('/api/ai/openrouter/api-key/rotate');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ apiKey: rotatedKey, maskedKey });
    expect(functionMocks.redeploy).not.toHaveBeenCalled();
  });

  it('does not touch secrets when rotation itself fails', async () => {
    openRouterMocks.rotateManagedApiKey.mockRejectedValue(
      new AppError('rotation failed', 502, 'AI_UPSTREAM_UNAVAILABLE')
    );

    const response = await request(createApp()).post('/api/ai/openrouter/api-key/rotate');

    expect(response.status).toBe(502);
    expect(secretMocks.updateSecretByKey).not.toHaveBeenCalled();
  });
});
