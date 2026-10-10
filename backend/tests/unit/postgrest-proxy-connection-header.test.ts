/**
 * postgrest-proxy-connection-header.test.ts
 *
 * The client's `Connection` header must not reach PostgREST: a forwarded
 * `Connection: close` makes PostgREST close a pooled keep-alive socket, and
 * the next request that reuses it fails with "socket hang up".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => requestMock),
    },
  };
});

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

import { PostgrestProxyService } from '../../src/services/database/postgrest-proxy.service';

describe('PostgREST proxy Connection header', () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ data: [], status: 200, headers: {} });
  });

  it('does not forward the client Connection header to PostgREST', async () => {
    await PostgrestProxyService.getInstance().forwardAsAnon({
      method: 'POST',
      path: '/rpc/list_items',
      headers: {
        connection: 'close',
        'content-type': 'application/json',
        prefer: 'return=representation',
      },
      body: {},
    });

    const forwarded = requestMock.mock.calls[0][0].headers;
    expect(forwarded.connection).toBeUndefined();
    expect(forwarded['content-type']).toBe('application/json');
    expect(forwarded.prefer).toBe('return=representation');
  });
});
