/**
 * Saving `useSharedKey` for a provider the cloud does not proxy produced a config whose
 * every login failed later, at the hardened shared callback (#2053). The config routes
 * now reject the flag when it is saved, so the failure is a configuration error the
 * admin sees immediately.
 */
import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

const JWT_SECRET = 'test-secret';

const configServiceMock = vi.hoisted(() => ({
  createConfig: vi.fn(),
  updateConfig: vi.fn(),
  getConfigByProvider: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ log: vi.fn() }));

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
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => configServiceMock },
}));
vi.mock('../../src/services/auth/auth.service.js', () => ({
  AuthService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: { getInstance: () => ({ validateRedirectUrl: vi.fn() }) },
}));
vi.mock('../../src/services/auth/oauth-pkce.service.js', () => ({
  OAuthPKCEService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/shared-oauth.service.js', () => ({
  SharedOAuthService: { getInstance: () => ({ verifyIdentityToken: vi.fn() }) },
}));
vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => auditMock },
}));
vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/dashboard/dashboard-event.service.js', () => ({
  dashboardEventService: { emit: vi.fn() },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: () => true,
  getApiBaseUrl: () => 'http://localhost:7130',
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const statusCode =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  const code =
    error instanceof Error && 'code' in error
      ? (error as Error & { code: string }).code
      : undefined;
  res.status(statusCode).json({ message: error.message, error: code });
};

async function createApp() {
  const oauthRouter = (await import('../../src/api/routes/auth/oauth.routes.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/auth/oauth', oauthRouter);
  app.use(errorHandler);
  return app;
}

describe('OAuth config shared-key provider guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    configServiceMock.createConfig.mockResolvedValue({ provider: 'google', useSharedKey: true });
    configServiceMock.updateConfig.mockResolvedValue({ provider: 'google', useSharedKey: true });
    auditMock.log.mockResolvedValue(undefined);
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects creating an x config on shared keys', async () => {
    const response = await request(await createApp())
      .post('/api/auth/oauth/configs')
      .send({ provider: 'x', useSharedKey: true });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(ERROR_CODES.AUTH_OAUTH_CONFIG_ERROR);
    expect(configServiceMock.createConfig).not.toHaveBeenCalled();
  });

  it('rejects updating an x config onto shared keys', async () => {
    const response = await request(await createApp())
      .put('/api/auth/oauth/x/config')
      .send({ useSharedKey: true });

    expect(response.status).toBe(400);
    expect(configServiceMock.updateConfig).not.toHaveBeenCalled();
  });

  it('rejects a mixed-case x path, which the config lookup would have matched', async () => {
    const response = await request(await createApp())
      .put('/api/auth/oauth/X/config')
      .send({ useSharedKey: true });

    expect(response.status).toBe(400);
    expect(configServiceMock.updateConfig).not.toHaveBeenCalled();
  });

  it('accepts a mixed-case path for a provider the cloud proxies', async () => {
    const response = await request(await createApp())
      .put('/api/auth/oauth/Google/config')
      .send({ useSharedKey: true });

    expect(response.status).toBe(200);
    expect(configServiceMock.updateConfig).toHaveBeenCalled();
  });

  it('still accepts a provider the cloud proxies', async () => {
    const response = await request(await createApp())
      .post('/api/auth/oauth/configs')
      .send({ provider: 'google', useSharedKey: true });

    expect(response.status).toBe(200);
    expect(configServiceMock.createConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google', useSharedKey: true })
    );
  });

  it('lets an x config move off shared keys', async () => {
    configServiceMock.updateConfig.mockResolvedValue({ provider: 'x', useSharedKey: false });

    const response = await request(await createApp())
      .put('/api/auth/oauth/x/config')
      .send({ useSharedKey: false, clientId: 'client-id', clientSecret: 'client-secret' });

    expect(response.status).toBe(200);
    expect(configServiceMock.updateConfig).toHaveBeenCalled();
  });

  it('rejects a shared callback carrying a valid x state', async () => {
    const state = jwt.sign(
      {
        provider: 'x',
        redirectUri: 'http://localhost:3000/callback',
        codeChallenge: 'challenge',
      },
      JWT_SECRET,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const response = await request(await createApp()).get(
      `/api/auth/oauth/shared/callback/${state}?success=true&token=anything`
    );

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('does not support InsForge shared OAuth keys');
    expect(configServiceMock.getConfigByProvider).not.toHaveBeenCalled();
  });
});
