import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
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

  // An over-limit context is the client's problem, and the operator who set the
  // limit is the one who needs to hear about it. The shared error middleware does
  // not know `entity.too.large`, so without translation this is a bare 500.
  it('answers an over-limit context with 413 and names the knob', async () => {
    // `express.raw` captures the limit when the module loads, and resetting the
    // module registry re-reads config from the environment — so the knob has to be
    // set there, not on the already-built config object.
    const original = process.env.COMPUTE_BUILD_MAX_CONTEXT;
    process.env.COMPUTE_BUILD_MAX_CONTEXT = '1kb';
    vi.resetModules();
    try {
      const app = await createApp();
      const res = await request(app)
        .post('/api/compute/services/svc-1/build')
        .set('Content-Type', 'application/x-tar')
        .send(Buffer.alloc(4096, 1));

      expect(res.status).toBe(413);
      expect(res.body.message).toMatch(/COMPUTE_BUILD_MAX_CONTEXT/);
      expect(computeServiceMock.buildAndDeploy).not.toHaveBeenCalled();
    } finally {
      if (original === undefined) {
        delete process.env.COMPUTE_BUILD_MAX_CONTEXT;
      } else {
        process.env.COMPUTE_BUILD_MAX_CONTEXT = original;
      }
      vi.resetModules();
    }
  });

  // The build outlives the client, so a disconnect must not hand the slot to the
  // next caller while the daemon is still working — that is how a second full
  // context gets in alongside the first.
  it('keeps the slot while a build runs even if the client disconnects', async () => {
    let releaseBuild: () => void = () => {};
    computeServiceMock.buildAndDeploy.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseBuild = () => resolve({ service: { id: 'svc-1' }, imageTag: 'tag', logs: [] });
        })
    );

    const app = await createApp();
    const abortable = request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);
    const inFlight = abortable.then(
      (r) => r,
      () => undefined // aborting rejects the client promise; the server keeps going
    );

    for (let i = 0; i < 200 && computeServiceMock.buildAndDeploy.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(computeServiceMock.buildAndDeploy).toHaveBeenCalledTimes(1);

    abortable.abort();
    await new Promise((r) => setTimeout(r, 30));

    // Slot still held: the build did not stop just because the client left.
    const during = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);
    expect(during.status).toBe(429);

    releaseBuild();
    await inFlight;
    computeServiceMock.buildAndDeploy.mockResolvedValue({
      service: { id: 'svc-1' },
      imageTag: 'tag',
      logs: [],
    });
    const after = await retryUntilNot429(app);
    expect(after.status).toBe(200);
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

    // Back to an implementation that settles — the blocking one above would hang
    // the next request in the handler and hide whether the gate reopened.
    computeServiceMock.buildAndDeploy.mockResolvedValue({
      service: { id: 'svc-1' },
      imageTag: 'tag',
      logs: [],
    });

    // The slot is handed back in the handler's `finally`, which runs on its own
    // tick. Poll for the reopen instead of sleeping a guessed interval: a fixed
    // sleep that loses the race reports a spurious 429 and flakes under load.
    const third = await retryUntilNot429(app);
    expect(third.status).toBe(200);
  });

  // The two slot-lifecycle branches that decide whether builds block forever or
  // overlap. Neither is reachable through supertest, which always sends a complete
  // body — they need a socket we can stall or drop mid-upload, so these drive a real
  // listener with `http.request` and a `Content-Length` we deliberately underfill.
  describe('build slot lifecycle under a misbehaving client', () => {
    /** Start the app on an ephemeral port. */
    async function listen(app: express.Express) {
      const server = createServer(app);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address() as AddressInfo;
      return { server, port, close: () => new Promise<void>((r) => server.close(() => r())) };
    }

    /**
     * Open a build request that announces more body than it sends, so the server sits
     * inside `express.raw` waiting for the rest.
     */
    function openPartialUpload(port: number) {
      const req = httpRequest({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/api/compute/services/svc-1/build',
        headers: {
          'content-type': 'application/x-tar',
          'content-length': String(TAR.length * 2),
          'x-api-key': 'test',
        },
      });
      // Both tests kill this socket on purpose; without a listener the ECONNRESET
      // surfaces as an unhandled error and fails the run even though the
      // assertions pass.
      req.on('error', () => {});
      req.write(TAR); // half of what we promised
      return req;
    }

    it('frees the slot when the client vanishes before the handler runs', async () => {
      const app = await createApp();
      const { port, close } = await listen(app);
      try {
        const partial = openPartialUpload(port);

        // Held: the upload is parked inside express.raw, so nothing else gets in.
        // Polled rather than slept on — a fixed wait that loses the race reads as a
        // spurious 200 on a loaded worker.
        await waitUntilSlotHeld(app);

        // Counted as a delta rather than "never called": a probe that raced ahead of
        // the partial upload legitimately takes the slot and builds once, and that
        // says nothing about whether a *rejected* upload reaches the service.
        const callsBefore = computeServiceMock.buildAndDeploy.mock.calls.length;
        const blocked = await request(app)
          .post('/api/compute/services/svc-1/build')
          .set('Content-Type', 'application/x-tar')
          .send(TAR);
        expect(blocked.status).toBe(429);
        expect(computeServiceMock.buildAndDeploy.mock.calls.length).toBe(callsBefore);

        // The client disappears without ever reaching the handler. `res.close` is the
        // only thing that can hand the slot back here.
        partial.destroy();

        const after = await retryUntilNot429(app);
        expect(after.status).toBe(200);
      } finally {
        await close();
      }
    });

    it('cuts a stalled upload loose after the configured idle timeout', async () => {
      const original = process.env.COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT;
      // Seconds. Two rather than one so there is room to observe the slot held
      // before the watchdog fires — at one, a slow worker can reach the probe after
      // the release and see 200 for the right reason at the wrong time.
      process.env.COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT = '2';
      vi.resetModules();
      try {
        const app = await createApp();
        const { port, close } = await listen(app);
        try {
          const stalled = openPartialUpload(port);
          const died = new Promise<string>((resolve) => {
            stalled.on('error', () => resolve('socket dropped'));
            stalled.on('response', () => resolve('got a response'));
          });
          // Held while the upload looks alive.
          const blocked = await waitUntilSlotHeld(app);
          expect(blocked.status).toBe(429);

          // Send nothing further: the watchdog should destroy the request and release.
          expect(await died).toBe('socket dropped');
          const after = await retryUntilNot429(app);
          expect(after.status).toBe(200);
        } finally {
          await close();
        }
      } finally {
        if (original === undefined) {
          delete process.env.COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT;
        } else {
          process.env.COMPUTE_BUILD_UPLOAD_IDLE_TIMEOUT = original;
        }
        vi.resetModules();
      }
    }, 15_000);
  });
});

/**
 * Re-issue the request until the build slot is free, bounded so a genuinely stuck
 * gate still fails the test rather than hanging it.
 */
async function retryUntilNot429(app: express.Express) {
  let last;
  for (let i = 0; i < 100; i++) {
    last = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);
    if (last.status !== 429) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return last!;
}

/**
 * Poll until a probe is actually turned away, i.e. the slot is observably held.
 * Returns that 429 response so the caller can assert on it. Bounded, so a gate that
 * never closes fails the test with a real status instead of hanging.
 */
async function waitUntilSlotHeld(app: express.Express) {
  let last;
  for (let i = 0; i < 200; i++) {
    last = await request(app)
      .post('/api/compute/services/svc-1/build')
      .set('Content-Type', 'application/x-tar')
      .send(TAR);
    if (last.status === 429) {
      return last;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  return last!;
}
