/**
 * postgrest-proxy-stale-pool-replay.test.ts
 *
 * Regression test for the stale-socket replay, exercised over real sockets
 * against a fake PostgREST (no axios mock): the mocked forward-loop tests can
 * only pin the config handed to axios, not that a per-request agent override
 * is honored and actually opens a new connection.
 *
 * The fake server resets any request arriving on a socket it has already
 * served, so every pooled keep-alive socket is dead on reuse — the state
 * described in the bug report, where a batch of idle sockets is closed
 * together — while a fresh connection is served normally. Nothing here
 * depends on idle timing.
 *
 * Before the fix the single replay was drawn from the same pool that had just
 * produced a dead socket, so this POST failed with "socket hang up".
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import type { PostgrestProxyService as PostgrestProxyServiceType } from '../../src/services/database/postgrest-proxy.service';

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      generatePostgrestAdminToken: () => 'admin-token',
      generatePostgrestAnonToken: () => 'anon-token',
      generatePostgrestUserToken: () => 'user-token',
    }),
  },
}));

vi.mock('@/utils/logger.js', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const servedSockets = new WeakSet<Socket>();
let connectionsServed = 0;
let resets = 0;
let server: http.Server;
let proxy: PostgrestProxyServiceType;
let previousBaseUrl: string | undefined;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (servedSockets.has(req.socket)) {
      resets++;
      req.socket.resetAndDestroy();
      return;
    }
    servedSockets.add(req.socket);
    connectionsServed++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  // The proxy reads the base URL at module load, so point it at the fake
  // server before importing it.
  previousBaseUrl = process.env.POSTGREST_BASE_URL;
  process.env.POSTGREST_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { PostgrestProxyService } =
    await import('../../src/services/database/postgrest-proxy.service');
  proxy = PostgrestProxyService.getInstance();
});

afterAll(async () => {
  if (previousBaseUrl === undefined) {
    delete process.env.POSTGREST_BASE_URL;
  } else {
    process.env.POSTGREST_BASE_URL = previousBaseUrl;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('PostgREST proxy replay when the whole keep-alive pool is stale', () => {
  it('completes a POST whose pooled sockets are all dead on reuse', async () => {
    // Three parallel requests leave three free sockets in the pool, so the one
    // permitted replay has other stale sockets available to be wasted on.
    await Promise.all([
      proxy.forward({ method: 'GET', path: '/items' }),
      proxy.forward({ method: 'GET', path: '/items' }),
      proxy.forward({ method: 'GET', path: '/items' }),
    ]);
    expect(connectionsServed).toBe(3);

    const response = await proxy.forward({
      method: 'POST',
      path: '/rpc/claim_job',
      body: { id: 1 },
    });

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    // One reset (the stale pooled socket the first attempt took) and one new
    // connection (the replay), rather than a second reset from the pool.
    expect(resets).toBe(1);
    expect(connectionsServed).toBe(4);
  });
});
