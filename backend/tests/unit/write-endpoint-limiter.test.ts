import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import {
  functionsWriteLimiter,
  deploymentsWriteLimiter,
  computeWriteLimiter,
  DEFAULT_WRITE_ENDPOINT_LIMITS,
  applyWriteEndpointLimits,
  resetWriteEndpointLimitsToDefaults,
  type WriteLimiterCategory,
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

const limiters: Array<[name: string, category: WriteLimiterCategory, limiter: RequestHandler]> = [
  ['functionsWriteLimiter', 'functions', functionsWriteLimiter],
  ['deploymentsWriteLimiter', 'deployments', deploymentsWriteLimiter],
  ['computeWriteLimiter', 'compute', computeWriteLimiter],
];

describe.each(limiters)('%s', (_name, category, limiter) => {
  const budget = DEFAULT_WRITE_ENDPOINT_LIMITS[category];

  beforeEach(() => {
    resetWriteEndpointLimitsToDefaults();
    resetLimiter(limiter);
  });

  it(`allows up to ${budget} POSTs in 5min from a single IP`, async () => {
    const app = buildApp(limiter);
    for (let i = 0; i < budget; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
  });

  it(`rejects POST #${budget + 1} with 429`, async () => {
    const app = buildApp(limiter);
    for (let i = 0; i < budget; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
    const r = await request(app).post('/x').send({});
    expect(r.status).toBe(429);
  });
});

describe('per-category buckets are independent', () => {
  beforeEach(() => {
    resetWriteEndpointLimitsToDefaults();
    resetLimiter(functionsWriteLimiter);
    resetLimiter(deploymentsWriteLimiter);
    resetLimiter(computeWriteLimiter);
  });

  it('exhausting functions does not affect deployments or compute', async () => {
    const fnApp = buildApp(functionsWriteLimiter);
    for (let i = 0; i < DEFAULT_WRITE_ENDPOINT_LIMITS.functions; i++) {
      await request(fnApp).post('/x').send({}).expect(200);
    }
    await request(fnApp).post('/x').send({}).expect(429);

    // Other categories still have a full budget.
    await request(buildApp(deploymentsWriteLimiter)).post('/x').send({}).expect(200);
    await request(buildApp(computeWriteLimiter)).post('/x').send({}).expect(200);
  });
});

describe('within a category the bucket is shared across routes', () => {
  const budget = DEFAULT_WRITE_ENDPOINT_LIMITS.deployments;

  beforeEach(() => {
    resetWriteEndpointLimitsToDefaults();
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
    for (let i = 0; i < budget; i++) {
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
  const budget = DEFAULT_WRITE_ENDPOINT_LIMITS.functions;

  beforeEach(() => {
    resetWriteEndpointLimitsToDefaults();
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
    for (let i = 0; i < budget * 3; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
  });

  it('does not bypass for other truthy values like "true"', async () => {
    process.env.INSFORGE_DISABLE_WRITE_RATE_LIMIT = 'true';
    const app = buildApp(functionsWriteLimiter);
    for (let i = 0; i < budget; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
    await request(app).post('/x').send({}).expect(429);
  });
});

describe('applyWriteEndpointLimits override', () => {
  beforeEach(() => {
    resetWriteEndpointLimitsToDefaults();
    resetLimiter(functionsWriteLimiter);
    resetLimiter(deploymentsWriteLimiter);
  });

  afterEach(() => {
    resetWriteEndpointLimitsToDefaults();
    resetLimiter(functionsWriteLimiter);
    resetLimiter(deploymentsWriteLimiter);
  });

  it('takes effect on the next request without rebuilding the limiter', async () => {
    applyWriteEndpointLimits({ functions: 2 });
    const app = buildApp(functionsWriteLimiter);
    await request(app).post('/x').send({}).expect(200);
    await request(app).post('/x').send({}).expect(200);
    await request(app).post('/x').send({}).expect(429);
  });

  it('only overrides the categories present in the partial config', async () => {
    applyWriteEndpointLimits({ functions: 3 });
    // deployments retained its default 25-request budget.
    const depApp = buildApp(deploymentsWriteLimiter);
    for (let i = 0; i < DEFAULT_WRITE_ENDPOINT_LIMITS.deployments; i++) {
      await request(depApp).post('/x').send({}).expect(200);
    }
    await request(depApp).post('/x').send({}).expect(429);
  });

  it('ignores invalid values and keeps the previous (or default) budget', async () => {
    applyWriteEndpointLimits({
      functions: -1 as unknown as number,
      compute: 'lots' as unknown as number,
      deployments: 1.5 as unknown as number,
    });
    // None of the malformed values should have stuck — defaults remain.
    const fnApp = buildApp(functionsWriteLimiter);
    for (let i = 0; i < DEFAULT_WRITE_ENDPOINT_LIMITS.functions; i++) {
      await request(fnApp).post('/x').send({}).expect(200);
    }
    await request(fnApp).post('/x').send({}).expect(429);
  });
});
