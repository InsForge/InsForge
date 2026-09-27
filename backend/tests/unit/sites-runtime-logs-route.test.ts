import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectSettingsSchema } from '@insforge/shared-schemas';

const deploymentServiceMock = vi.hoisted(() => ({
  getRuntimeLogs: vi.fn(),
  rollbackTo: vi.fn(),
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

/**
 * One app per call, but the router module is imported once for the file.
 *
 * No `vi.resetModules()`: re-importing the route graph per test cost enough CPU to push the
 * two limiter suites — which each time 120 requests against a 10s timeout — over their
 * deadline when the full suite runs. Nothing here needs a fresh registry: the logs tests
 * make one request each, and the three rollback tests sit far under the deployments write
 * budget of 25/5min.
 */
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

describe('POST /api/deployments/:id/rollback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deploymentServiceMock.rollbackTo.mockResolvedValue({ id: 'row-1', status: 'READY' });
  });

  it('restores the named run', async () => {
    const response = await request(await createApp()).post(`/api/deployments/${ID}/rollback`);

    expect(response.status).toBe(200);
    expect(deploymentServiceMock.rollbackTo).toHaveBeenCalledWith(ID);
  });

  // Without this the id reached the driver, where a Docker deployment id is a container id
  // and an arbitrary string is a lookup against the daemon.
  it('rejects an id that is not a uuid', async () => {
    const response = await request(await createApp()).post('/api/deployments/not-a-uuid/rollback');

    expect(response.status).toBe(400);
    expect(deploymentServiceMock.rollbackTo).not.toHaveBeenCalled();
  });

  it('passes a driver refusal through with its own status', async () => {
    const refusal = Object.assign(new Error('The vercel sites driver does not support rollback.'), {
      statusCode: 400,
    });
    deploymentServiceMock.rollbackTo.mockRejectedValue(refusal);

    const response = await request(await createApp()).post(`/api/deployments/${ID}/rollback`);

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('does not support rollback');
  });
});

describe('projectSettings.startCommand', () => {
  // Presence is what selects a server image, and the driver trims before deciding — so a
  // blank string meant "static" for a caller who plainly asked for a server. Rejected at the
  // edge instead, where the message can say so.
  it.each(['', '   ', '\t'])('rejects a blank command (%j)', (startCommand) => {
    expect(projectSettingsSchema.safeParse({ startCommand }).success).toBe(false);
  });

  it('accepts a real command, and null for static', () => {
    expect(projectSettingsSchema.safeParse({ startCommand: 'node server.js' }).success).toBe(true);
    expect(projectSettingsSchema.safeParse({ startCommand: null }).success).toBe(true);
    expect(projectSettingsSchema.safeParse({}).success).toBe(true);
  });

  // Anything above 65535 is not a port; it used to fail at the daemon as an upstream error.
  it('bounds serverPort to the TCP range', () => {
    expect(projectSettingsSchema.safeParse({ serverPort: 70000 }).success).toBe(false);
    expect(projectSettingsSchema.safeParse({ serverPort: 0 }).success).toBe(false);
    expect(projectSettingsSchema.safeParse({ serverPort: 3000 }).success).toBe(true);
  });
});
