import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const deploymentServiceMock = vi.hoisted(() => ({ getRuntimeLogs: vi.fn() }));

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

vi.mock('../../src/services/deployments/deployment.service.js', () => ({
  DeploymentService: { getInstance: () => deploymentServiceMock },
  truncateBuildLogs: (lines: string[]) => lines,
}));

vi.mock('../../src/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn().mockResolvedValue(undefined) }) },
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
  const { deploymentsRouter } = await import('../../src/api/routes/deployments/index.routes.js');
  const app = express();
  app.use(express.json());
  app.use('/api/deployments', deploymentsRouter);
  app.use(errorHandler);
  return app;
}

const ID = '11111111-2222-3333-4444-555555555555';

describe('GET /api/deployments/:id/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The limiter's counter lives in the module, so without this a test's budget would
    // depend on how many requests the tests before it made.
    vi.resetModules();
    deploymentServiceMock.getRuntimeLogs.mockResolvedValue({ lines: [], nextToken: null });
  });

  it('passes limit and cursor through', async () => {
    const response = await request(await createApp()).get(
      `/api/deployments/${ID}/logs?limit=25&next_token=1786056693200000000`
    );

    expect(response.status).toBe(200);
    expect(deploymentServiceMock.getRuntimeLogs).toHaveBeenCalledWith(ID, {
      limit: 25,
      nextToken: '1786056693200000000',
    });
  });

  // A page size the caller did not ask for is invisible to a paging client, so `25.7` is a
  // 400 rather than 25 lines. parseInt would have truncated it silently.
  it.each(['25.7', '1e3', ' 25', 'abc', '-5', ''])('rejects limit=%j', async (limit) => {
    const response = await request(await createApp()).get(
      `/api/deployments/${ID}/logs?limit=${encodeURIComponent(limit)}`
    );

    expect(response.status).toBe(400);
    expect(deploymentServiceMock.getRuntimeLogs).not.toHaveBeenCalled();
  });

  it.each(['0', '1001'])('rejects limit=%s as out of range', async (limit) => {
    const response = await request(await createApp()).get(
      `/api/deployments/${ID}/logs?limit=${limit}`
    );

    expect(response.status).toBe(400);
    expect(deploymentServiceMock.getRuntimeLogs).not.toHaveBeenCalled();
  });

  it('leaves limit unset when the caller omits it, so the driver default applies', async () => {
    await request(await createApp()).get(`/api/deployments/${ID}/logs`);

    expect(deploymentServiceMock.getRuntimeLogs).toHaveBeenCalledWith(ID, {
      limit: undefined,
      nextToken: undefined,
    });
  });

  it('rejects an id that is not a uuid before reaching the service', async () => {
    const response = await request(await createApp()).get('/api/deployments/not-a-uuid/logs');

    expect(response.status).toBe(400);
    expect(deploymentServiceMock.getRuntimeLogs).not.toHaveBeenCalled();
  });

  // The endpoint a live tail polls, so it carries the same limiter budget the compute logs
  // endpoint uses. Asserted structurally rather than by spending the budget: 130 requests
  // here made `compute-logs-limiter.test.ts` — which times 120 requests against a 10s
  // timeout — flake when the two files ran at once, and that file already covers what
  // express-rate-limit does at this exact `max`.
  it('mounts the log rate limiter on the route', async () => {
    const { deploymentLogsRateLimiter } =
      await import('../../src/api/middlewares/rate-limiters.js');
    const { deploymentsRouter } = await import('../../src/api/routes/deployments/index.routes.js');

    const layer = (
      deploymentsRouter as unknown as {
        stack: {
          route?: {
            path: string;
            methods: Record<string, boolean>;
            stack: { handle: unknown }[];
          };
        }[];
      }
    ).stack.find((entry) => entry.route?.path === '/:id/logs' && entry.route.methods.get);

    expect(layer).toBeDefined();
    expect(layer?.route?.stack.map((entry) => entry.handle)).toContain(deploymentLogsRateLimiter);
  });
});
