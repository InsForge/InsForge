import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import {
  functionsWriteLimiter,
  deploymentsWriteLimiter,
  computeWriteLimiter,
} from '@/api/middlewares/rate-limiters.js';

// express-rate-limit keeps in-memory state PER LIMITER INSTANCE. Since each
// test builds a fresh app but reuses the same exported limiter, we reset the
// bucket between tests so each test exercises the limiter freshly. The
// default supertest remote address is "::ffff:127.0.0.1".
const DEFAULT_KEY = '::ffff:127.0.0.1';

function resetLimiter(limiter: RequestHandler): void {
  (limiter as unknown as { resetKey: (k: string) => void }).resetKey(DEFAULT_KEY);
}

function buildApp(limiter: RequestHandler) {
  const app = express();
  app.use(express.json());
  app.post('/x', limiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

const limiters: Array<[name: string, limiter: RequestHandler]> = [
  ['functionsWriteLimiter', functionsWriteLimiter],
  ['deploymentsWriteLimiter', deploymentsWriteLimiter],
  ['computeWriteLimiter', computeWriteLimiter],
];

// Mirrors the `max:` value in createWriteEndpointLimiter. Update both
// together if the budget changes.
const PER_CATEGORY_LIMIT = 10;

describe.each(limiters)('%s', (_name, limiter) => {
  beforeEach(() => {
    resetLimiter(limiter);
  });

  it(`allows up to ${PER_CATEGORY_LIMIT} POSTs in 5min from a single IP`, async () => {
    const app = buildApp(limiter);
    for (let i = 0; i < PER_CATEGORY_LIMIT; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
  });

  it(`rejects POST #${PER_CATEGORY_LIMIT + 1} with 429`, async () => {
    const app = buildApp(limiter);
    for (let i = 0; i < PER_CATEGORY_LIMIT; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
    const r = await request(app).post('/x').send({});
    expect(r.status).toBe(429);
  });
});

describe('per-category buckets are independent', () => {
  beforeEach(() => {
    resetLimiter(functionsWriteLimiter);
    resetLimiter(deploymentsWriteLimiter);
    resetLimiter(computeWriteLimiter);
  });

  it('exhausting functions does not affect deployments or compute', async () => {
    const fnApp = buildApp(functionsWriteLimiter);
    for (let i = 0; i < PER_CATEGORY_LIMIT; i++) {
      await request(fnApp).post('/x').send({}).expect(200);
    }
    await request(fnApp).post('/x').send({}).expect(429);

    // Other categories still have a full budget.
    await request(buildApp(deploymentsWriteLimiter)).post('/x').send({}).expect(200);
    await request(buildApp(computeWriteLimiter)).post('/x').send({}).expect(200);
  });
});

describe('within a category the bucket is shared across routes', () => {
  beforeEach(() => {
    resetLimiter(deploymentsWriteLimiter);
  });

  it('two routes mounting the same limiter share one budget', async () => {
    // Mirrors how index.routes.ts and env-vars.routes.ts both mount
    // deploymentsWriteLimiter — calls to either route count toward the
    // same per-IP budget.
    const app = express();
    app.use(express.json());
    app.post('/a', deploymentsWriteLimiter, (_req, res) => res.json({ ok: true }));
    app.post('/b', deploymentsWriteLimiter, (_req, res) => res.json({ ok: true }));

    // Spread the budget across the two routes.
    for (let i = 0; i < PER_CATEGORY_LIMIT; i++) {
      const path = i % 2 === 0 ? '/a' : '/b';
      await request(app).post(path).send({}).expect(200);
    }
    // The next call to either route is rejected.
    await request(app).post('/a').send({}).expect(429);
    await request(app).post('/b').send({}).expect(429);
  });
});

describe('INSFORGE_DISABLE_WRITE_RATE_LIMIT bypass', () => {
  const ORIGINAL = process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT;

  beforeEach(() => {
    resetLimiter(functionsWriteLimiter);
  });

  afterEach(() => {
    if (ORIGINAL === undefined) {
      delete process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT;
    } else {
      process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT = ORIGINAL;
    }
  });

  it('lets unlimited POSTs through when set to "1"', async () => {
    process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT = '1';
    const app = buildApp(functionsWriteLimiter);
    // Well past the per-category cap; would normally 429 long before this.
    for (let i = 0; i < PER_CATEGORY_LIMIT * 3; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
  });

  it('does not bypass for other truthy values like "true"', async () => {
    process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT = 'true';
    const app = buildApp(functionsWriteLimiter);
    for (let i = 0; i < PER_CATEGORY_LIMIT; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
    await request(app).post('/x').send({}).expect(429);
  });
});
