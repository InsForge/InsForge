import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { writeEndpointLimiter } from '@/api/middlewares/rate-limiters.js';

describe('writeEndpointLimiter', () => {
  beforeEach(() => {
    // express-rate-limit keeps in-memory state PER LIMITER INSTANCE. Since
    // each test builds a fresh app but reuses the same exported limiter, we
    // reset the bucket between tests so each test exercises the limiter
    // freshly. The default supertest remote address is "::ffff:127.0.0.1".
    (writeEndpointLimiter as unknown as { resetKey: (k: string) => void }).resetKey(
      '::ffff:127.0.0.1'
    );
  });

  function buildApp() {
    const app = express();
    app.use(express.json());
    // Mount the limiter on a noop POST handler so we can exercise it
    // without booting the rest of the OSS.
    app.post('/x', writeEndpointLimiter, (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('allows up to 3 POSTs in 5min from a single IP', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
  });

  it('rejects the 4th POST with 429', async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) {
      await request(app).post('/x').send({}).expect(200);
    }
    const r = await request(app).post('/x').send({});
    expect(r.status).toBe(429);
  });
});
