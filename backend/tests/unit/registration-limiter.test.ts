import { describe, it, expect, beforeEach } from 'vitest';
import express, { type RequestHandler, type Request, type Response } from 'express';
import request from 'supertest';
import { registrationRateLimiter } from '@/api/middlewares/rate-limiters.js';

// express-rate-limit keeps in-memory state per limiter instance; reset the
// bucket between tests. supertest's default remote address is the key below.
const DEFAULT_KEY = '::ffff:127.0.0.1';
const BUDGET = 20; // keep in sync with registrationRateLimiter `max`

function resetLimiter(limiter: RequestHandler): void {
  (limiter as unknown as { resetKey: (k: string) => void }).resetKey(DEFAULT_KEY);
}

/**
 * Models POST /api/auth/users: `verifyUser` runs FIRST and sets the credential
 * shape, then the limiter reads it. `as` mirrors what verifyUser would attach —
 * undefined for an anon_ key (self-serve signup), hasApiKey/project_admin for an
 * admin-initiated create.
 */
function buildApp(as?: { hasApiKey?: boolean; role?: string }) {
  const app = express();
  app.post(
    '/users',
    (req: Request, _res: Response, next) => {
      const authReq = req as Request & { hasApiKey?: boolean; user?: { role?: string } };
      if (as?.hasApiKey) authReq.hasApiKey = true;
      if (as?.role) authReq.user = { role: as.role };
      next();
    },
    registrationRateLimiter,
    // A registration that SUCCEEDS. This matters: the limiter must charge for
    // successes, so the stub must not return an error.
    (_req, res) => {
      res.status(201).json({ ok: true });
    }
  );
  return app;
}

describe('registrationRateLimiter (POST /api/auth/users)', () => {
  beforeEach(() => {
    resetLimiter(registrationRateLimiter);
  });

  it(`allows ${BUDGET} self-serve registrations in the window from one IP`, async () => {
    const app = buildApp();
    for (let i = 0; i < BUDGET; i++) {
      await request(app).post('/users').send({}).expect(201);
    }
  });

  it(`rejects registration #${BUDGET + 1} with 429, not 500`, async () => {
    const app = buildApp();
    for (let i = 0; i < BUDGET; i++) {
      await request(app).post('/users').send({}).expect(201);
    }
    const r = await request(app).post('/users').send({});
    // The limiter surfaces the refusal via next(new AppError(..., 429)). If that
    // ever gets swallowed into a generic 500 the endpoint is still blocked but
    // blames us and drops Retry-After, so assert the status explicitly.
    expect(r.status).toBe(429);
  });

  // GUARD: this is the test that fails if someone sets skipSuccessfulRequests:true.
  // Every request above returned 201, so the budget can only have been consumed by
  // successes. Registration differs from the OTP-verify limiter above precisely
  // here: an accepted call is the one that costs something (it writes a user row),
  // so a setting that skipped successes would make this limiter ineffective for the
  // case it exists to cover while still appearing on the route.
  it('charges for SUCCESSFUL registrations, not just failed ones', async () => {
    const app = buildApp();
    for (let i = 0; i < BUDGET; i++) {
      await request(app).post('/users').send({}).expect(201);
    }
    const r = await request(app).post('/users').send({});
    expect(r.status).toBe(429);
  });

  it('exposes RateLimit-* headers and no legacy X-RateLimit-*', async () => {
    const app = buildApp();
    const r = await request(app).post('/users').send({}).expect(201);
    expect(r.headers['ratelimit-limit']).toBe(String(BUDGET));
    expect(r.headers['x-ratelimit-limit']).toBeUndefined();
  });

  describe('admin-initiated creation is exempt', () => {
    it('does not throttle an API-key caller past the budget', async () => {
      const app = buildApp({ hasApiKey: true });
      for (let i = 0; i < BUDGET + 5; i++) {
        await request(app).post('/users').send({}).expect(201);
      }
    });

    it('does not throttle a project_admin caller past the budget', async () => {
      const app = buildApp({ role: 'project_admin' });
      for (let i = 0; i < BUDGET + 5; i++) {
        await request(app).post('/users').send({}).expect(201);
      }
    });

    // NEGATIVE CONTROL for the two above: `skip` must stop the request being
    // COUNTED, not merely stop it being refused. Without this, an implementation
    // that counted admin calls and only skipped the refusal would pass both tests
    // while silently burning a customer's signup budget from the dashboard.
    it('admin calls do not consume the self-serve budget', async () => {
      const adminApp = buildApp({ hasApiKey: true });
      for (let i = 0; i < BUDGET + 5; i++) {
        await request(adminApp).post('/users').send({}).expect(201);
      }
      // Same limiter instance, same IP — a self-serve caller must still have its
      // full allowance.
      const selfServeApp = buildApp();
      for (let i = 0; i < BUDGET; i++) {
        await request(selfServeApp).post('/users').send({}).expect(201);
      }
      const r = await request(selfServeApp).post('/users').send({});
      expect(r.status).toBe(429);
    });
  });
});
