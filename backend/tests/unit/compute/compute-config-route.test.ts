import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Behavioural coverage for GET/PUT /api/compute/services/config at the HTTP boundary.
// The service tests cover storage; what only exists here is who may write, what the
// response is allowed to contain, and that a write rebuilds the provider registry.

const configMock = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
}));
const servicesMock = vi.hoisted(() => ({ resetForConfigChange: vi.fn() }));
const env = vi.hoisted(() => ({ isCloud: false }));

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyAdmin: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.user = { id: 'admin-1' };
    req.hasApiKey = false;
    next();
  },
}));

vi.mock('@/api/middlewares/rate-limiters.js', () => ({
  computeWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  computeLogsRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('@/utils/environment.js', () => ({
  isCloudEnvironment: () => env.isCloud,
}));

vi.mock('@/services/compute/compute-config.service.js', () => ({
  ComputeConfigService: { getInstance: () => configMock },
}));

vi.mock('@/services/compute/services.service.js', () => ({
  ComputeServicesService: { getInstance: () => ({}), ...servicesMock },
  getComputeMetadata: () => undefined,
}));

vi.mock('@/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }) },
}));

vi.mock('@/services/dashboard/dashboard-event.service.js', () => ({
  dashboardEventService: { publishDataUpdate: vi.fn() },
}));

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  void _next;
  const status =
    error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
  res.status(status).json({ message: error instanceof Error ? error.message : 'Error' });
};

async function createApp() {
  const { servicesRouter: router } = await import('@/api/routes/compute/services.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/compute/services', router);
  app.use(errorHandler);
  return app;
}

const STATUS = {
  flyApiToken: { configured: true, masked: 'fm2_••••••cli', source: 'stored' },
  flyOrg: { configured: true, masked: 'my-org', source: 'stored' },
};

describe('/api/compute/services/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.isCloud = false;
    configMock.getConfig.mockResolvedValue(STATUS);
    configMock.updateConfig.mockResolvedValue(undefined);
  });

  // `config` must not be swallowed by the `/:id` route, which would look up a service
  // with that id and 404.
  it('reads status without matching the service-id route', async () => {
    const res = await request(await createApp()).get('/api/compute/services/config');

    expect(res.status).toBe(200);
    expect(configMock.getConfig).toHaveBeenCalled();
  });

  it('stores a credential and rebuilds the provider registry', async () => {
    const res = await request(await createApp())
      .put('/api/compute/services/config')
      .send({ flyApiToken: 'fm2_new' });

    expect(res.status).toBe(200);
    expect(configMock.updateConfig).toHaveBeenCalledWith({ flyApiToken: 'fm2_new' });
    expect(servicesMock.resetForConfigChange).toHaveBeenCalled();
  });

  // A write that failed part-way through has still changed the credentials, so the
  // registry built from the old ones is stale either way.
  it('rebuilds the registry even when the write fails', async () => {
    configMock.updateConfig.mockRejectedValueOnce(new Error('secret store unavailable'));

    const res = await request(await createApp())
      .put('/api/compute/services/config')
      .send({ flyApiToken: 'fm2_new' });

    expect(res.status).toBe(500);
    expect(servicesMock.resetForConfigChange).toHaveBeenCalled();
  });

  it('rejects an empty body rather than reporting a successful no-op', async () => {
    const res = await request(await createApp())
      .put('/api/compute/services/config')
      .send({});

    expect(res.status).toBe(400);
    expect(configMock.updateConfig).not.toHaveBeenCalled();
  });

  // On cloud, compute runs through InsForge's own Fly account. A project admin storing
  // their own token would move their containers off the control plane that bills and
  // quotas them, so the UI hides this — and the API has to agree, or the gate is
  // decoration. The signal is the AWS instance profile, which cloud provisioning always
  // sets; PROJECT_ID is not used, because self-hosters set that too.
  it('refuses to store credentials on a cloud instance', async () => {
    env.isCloud = true;

    const res = await request(await createApp())
      .put('/api/compute/services/config')
      .send({ flyApiToken: 'fm2_new' });

    expect(res.status).toBe(403);
    expect(configMock.updateConfig).not.toHaveBeenCalled();
  });
});
