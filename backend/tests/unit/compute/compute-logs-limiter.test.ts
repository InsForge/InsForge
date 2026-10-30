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
 * Batched rather than one-at-a-time or all-at-once. 120 sequential round-trips took
 * over the 10s test timeout when the machine was busy; 120 simultaneous sockets got
 * connections dropped instead, which failed fast and looked like a limiter bug. Ten in
 * flight at a time is neither.
 *
 * Asserted by count, not by position: the memory store increments synchronously per
 * request, so a batch of ten takes ten distinct slots whatever order they land in.
 */
const BATCH = 10;

async function spendBudget(app: express.Express): Promise<void> {
  const statuses: number[] = [];
  for (let sent = 0; sent < BUDGET; sent += BATCH) {
    const batch = Math.min(BATCH, BUDGET - sent);
    const results = await Promise.all(
      Array.from({ length: batch }, () => request(app).get('/logs'))
    );
    statuses.push(...results.map((r) => r.status));
  }
  expect(statuses.filter((s) => s === 200)).toHaveLength(BUDGET);
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
