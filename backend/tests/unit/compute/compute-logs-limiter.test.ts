import { describe, it, expect, beforeEach } from 'vitest';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { computeLogsRateLimiter } from '@/api/middlewares/rate-limiters.js';

// express-rate-limit keeps in-memory state per limiter instance; reset the
// bucket between tests. supertest's default remote address is the key below.
const DEFAULT_KEY = '::ffff:127.0.0.1';
const BUDGET = 120; // keep in sync with computeLogsRateLimiter `max`

function resetLimiter(limiter: RequestHandler): void {
  (limiter as unknown as { resetKey: (k: string) => void }).resetKey(DEFAULT_KEY);
}

/**
 * Spend the whole budget.
 *
 * Concurrent rather than sequential: the memory store increments synchronously per
 * request, so each of these takes a distinct slot 1..BUDGET regardless of ordering,
 * and 120 sequential supertest round-trips were slow enough to time out on a loaded
 * machine — a bound that says nothing about the limiter.
 */
async function spendBudget(app: express.Express): Promise<void> {
  const results = await Promise.all(
    Array.from({ length: BUDGET }, () => request(app).get('/logs'))
  );
  expect(results.map((r) => r.status)).toEqual(Array.from({ length: BUDGET }, () => 200));
}

function buildApp() {
  const app = express();
  // logs is a GET endpoint — model it as such.
  app.get('/logs', computeLogsRateLimiter, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe('computeLogsRateLimiter', () => {
  beforeEach(() => {
    resetLimiter(computeLogsRateLimiter);
  });

  it(`allows up to ${BUDGET} GETs in the window from a single IP`, async () => {
    await spendBudget(buildApp());
  });

  it(`rejects GET #${BUDGET + 1} with 429`, async () => {
    const app = buildApp();
    await spendBudget(app);
    const r = await request(app).get('/logs');
    expect(r.status).toBe(429);
  });

  it('is generous enough for live 2s polling (≈30/min ≪ budget)', () => {
    // A live tail polls ~30 times/min; the limiter must not throttle that.
    expect(BUDGET).toBeGreaterThanOrEqual(30 * 2);
  });
});
