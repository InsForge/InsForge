import express, { type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Behavioural coverage for POST /:id/build at the HTTP boundary. The service-level
// tests cover what happens once a context is in hand; everything interesting here
// happens before that — the raw-tar body parse, the tenant check, the `dockerfile`
// parameter, and the concurrency door that keeps a second upload from being
// buffered at all.

const computeServiceMock = vi.hoisted(() => ({
  getService: vi.fn(),
  buildAndDeploy: vi.fn(),
}));
const auditMock = vi.hoisted(() => ({ log: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyAdmin: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.user = { id: 'admin-1' };
    req.hasApiKey = false;
    next();
  },
}));

// The real limiter carries per-instance state across tests in the same file.
vi.mock('@/api/middlewares/rate-limiters.js', () => ({
  computeWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  computeLogsRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('@/services/compute/services.service.js', () => ({
  ComputeServicesService: { getInstance: () => computeServiceMock },
}));

vi.mock('@/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => auditMock },
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
  res.status(status).json({
    message: error instanceof Error ? error.message : 'Error',
    error: (error as { code?: string })?.code,
  });
};

async function createApp() {
  const { servicesRouter: router } = await import('@/api/routes/compute/services.routes.js');
  const app = express();
  app.use('/api/compute/services', router);
  app.use(errorHandler);
  return app;
}

const TAR = Buffer.alloc(2048, 1);

describe('POST /api/compute/services/:id/build', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROJECT_ID = 'proj-1';
    computeServiceMock.getService.mockResolvedValue({
      id: 'svc-1',
      projectId: 'proj-1',
      name: 'api',
    });
    computeServiceMock.buildAndDeploy.mockResolvedValue({
      service: { id: 'svc-1', name: 'api' },
      imageTag: 'insforge-x/api:abc',
      logs: ['Step 1/2'],
    });
  });

  it('accepts an application/x-tar body and returns the built tag', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);

    expect(res.status).toBe(200);
    const [, context, options] = computeServiceMock.buildAndDeploy.mock.calls[0];
    expect(Buffer.isBuffer(context)).toBe(true);
    expect(context.length).toBe(TAR.length);
    expect(options).toEqual({ dockerfile: undefined });
  });

  // Anything that is not the declared type never reaches express.raw, so the body
  // arrives unparsed rather than as a Buffer. That has to be a 400, not a crash.
  it('rejects a body sent with the wrong content type', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/json')
      .send('{}');

    expect(res.status).toBe(400);
    expect(computeServiceMock.buildAndDeploy).not.toHaveBeenCalled();
  });

  it('rejects an empty context', async () => {
    const app = await createApp();
    const res = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(Buffer.alloc(0));

    expect(res.status).toBe(400);
    expect(computeServiceMock.buildAndDeploy).not.toHaveBeenCalled();
  });

  // A service belonging to someone else must be indistinguishable from one that
  // does not exist.
  it('404s a service from another project without building', async () => {
    computeServiceMock.getService.mockResolvedValue({
      id: 'svc-1',
      projectId: 'other-project',
      name: 'api',
    });
    const app = await createApp();
    const res = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);

    expect(res.status).toBe(404);
    expect(computeServiceMock.buildAndDeploy).not.toHaveBeenCalled();
  });

  it('passes a build failure through with the builder message', async () => {
    computeServiceMock.buildAndDeploy.mockRejectedValue(
      Object.assign(new Error('process "/bin/sh -c exit 7" did not complete successfully'), {
        statusCode: 400,
      })
    );
    const app = await createApp();
    const res = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/exit 7/);
  });

  describe('the `dockerfile` parameter', () => {
    it.each([
      ['/etc/passwd', 'absolute'],
      ['../../etc/passwd', 'parent traversal'],
      ['nested/../../out', 'traversal after a valid segment'],
      ['C:\\Windows\\System32', 'windows absolute'],
      ['x'.repeat(256), 'over-long'],
      ['', 'empty'],
    ])('rejects %s (%s) with a 400 before building', async (value) => {
      const app = await createApp();
      const res = await request(app)
        .post(`/api/compute/services/svc-1/build?dockerfile=${encodeURIComponent(value)}`)
        .set('Content-Type', 'application/x-tar')
        .send(TAR);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/dockerfile/i);
      expect(computeServiceMock.buildAndDeploy).not.toHaveBeenCalled();
    });

    it.each(['Dockerfile', 'docker/Dockerfile.prod', './Dockerfile'])(
      'forwards the legitimate path %s',
      async (value) => {
        const app = await createApp();
        const res = await request(app)
          .post(`/api/compute/services/svc-1/build?dockerfile=${encodeURIComponent(value)}`)
          .set('Content-Type', 'application/x-tar')
          .send(TAR);

        expect(res.status).toBe(200);
        expect(computeServiceMock.buildAndDeploy.mock.calls[0][2]).toEqual({ dockerfile: value });
      }
    );
  });

  // The point of the door: express buffers the whole tarball before any handler
  // runs, so a second upload has to be turned away *before* that, not after the
  // driver's own concurrency cap throws.
  it('rejects a concurrent upload with 429 rather than buffering it', async () => {
    let releaseBuild: () => void = () => {};
    computeServiceMock.buildAndDeploy.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBuild = () => resolve({ service: { id: 'svc-1' }, imageTag: 'tag', logs: [] });
        })
    );

    const app = await createApp();
    // `.then()` is what actually dispatches a supertest request; holding the Test
    // object alone would never enter the handler.
    const first = request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR)
      .then((r) => r);

    // Wait until the first request is inside the handler, i.e. past express.raw.
    for (let i = 0; i < 200 && computeServiceMock.buildAndDeploy.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(computeServiceMock.buildAndDeploy).toHaveBeenCalledTimes(1);
    const second = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);
    expect(second.status).toBe(429);
    // Still one call: the rejected upload never reached the service.
    expect(computeServiceMock.buildAndDeploy).toHaveBeenCalledTimes(1);
    releaseBuild();
    await first;
    // `res.on('close')` fires a tick after the response is delivered.
    await new Promise((r) => setTimeout(r, 20));

    // Back to an implementation that settles — the blocking one above would hang
    // the next request in the handler and hide whether the gate reopened.
    computeServiceMock.buildAndDeploy.mockResolvedValue({
      service: { id: 'svc-1' },
      imageTag: 'tag',
      logs: [],
    });

    // The door reopens once the first response closes.
    const third = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);
    expect(third.status).toBe(200);
  });
});
