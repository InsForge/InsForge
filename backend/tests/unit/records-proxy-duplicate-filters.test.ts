import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import request from 'supertest';

const { received } = vi.hoisted(() => {
  process.env.POSTGREST_BASE_URL = 'http://127.0.0.1:54329';
  return { received: [] as string[] };
});

vi.mock('@/api/middlewares/auth.js', () => ({
  verifyUser: (req: { user?: unknown }, _res: unknown, next: () => void) => {
    req.user = { id: '00000000-0000-0000-0000-000000000001', role: 'authenticated' };
    next();
  },
}));
vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      generatePostgrestAdminToken: () => 'admin-token',
      generatePostgrestAnonToken: () => 'anon-token',
      generatePostgrestUserToken: () => 'user-token',
    }),
  },
}));
vi.mock('@/services/dashboard/dashboard-event.service.js', () => ({
  dashboardEventService: { publishDataUpdate: vi.fn() },
}));

import { databaseRecordsRouter } from '@/api/routes/database/records.routes.js';

let stub: http.Server;

beforeAll(async () => {
  stub = http.createServer((req, res) => {
    received.push(req.url ?? '');
    res.setHeader('content-type', 'application/json');
    res.end('[]');
  });
  await new Promise<void>((resolve) => stub.listen(54329, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

describe('records proxy', () => {
  it('forwards two filters on one column as repeated keys', async () => {
    const app = express();
    app.use('/api/database/records', databaseRecordsRouter);

    const res = await request(app).get('/api/database/records/people?age=gte.18&age=lte.30');

    expect(res.status).toBe(200);
    expect(decodeURIComponent(received[0])).toBe('/people?age=gte.18&age=lte.30');
  });
});
