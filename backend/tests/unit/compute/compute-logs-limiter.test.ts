import { describe, it, expect, beforeEach } from 'vitest';
import express, { type RequestHandler } from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { computeLogsRateLimiter } from '@/api/middlewares/rate-limiters.js';

// express-rate-limit keeps in-memory state per limiter instance; reset the
// bucket between tests. supertest's default remote address is the key below.
const DEFAULT_KEY = '::ffff:127.0.0.1';
const BUDGET = 120; // keep in sync with computeLogsRateLimiter `max`

function resetLimiter(limiter: RequestHandler): void {
  (limiter as unknown as { resetKey: (k: string) => void }).resetKey(DEFAULT_KEY);
}

function buildApp() {
  const app = express();
  // logs is a GET endpoint — model it as such.
  app.get('/logs', computeLogsRateLimiter, (_req, res) => {
    res.json({ ok: true });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const status =
      (err as { statusCode?: number; status?: number }).statusCode ??
      (err as { status?: number }).status ??
      500;
    res.status(status).json({ error: err.message });
  });
  return app;
}

describe('computeLogsRateLimiter', () => {
  beforeEach(() => {
    resetLimiter(computeLogsRateLimiter);
  });

  it(`allows up to ${BUDGET} GETs in the window from a single IP`, async () => {
    const app = buildApp();
    for (let i = 0; i < BUDGET; i++) {
      await request(app).get('/logs').expect(200);
    }
  });

  it(`rejects GET #${BUDGET + 1} with 429`, async () => {
    const app = buildApp();
    for (let i = 0; i < BUDGET; i++) {
      await request(app).get('/logs').expect(200);
    }
    const r = await request(app).get('/logs');
    expect(r.status).toBe(429);
  });

  it('is generous enough for live 2s polling (≈30/min ≪ budget)', () => {
    // A live tail polls ~30 times/min; the limiter must not throttle that.
    expect(BUDGET).toBeGreaterThanOrEqual(30 * 2);
  });
});
