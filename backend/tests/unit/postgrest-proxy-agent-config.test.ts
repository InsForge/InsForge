/**
 * postgrest-proxy-agent-config.test.ts
 *
 * Verifies the HTTP agent construction of the PostgREST proxy: both agents
 * are agentkeepalive agents (so idle sockets are proactively closed after
 * freeSocketTimeout instead of lingering until the server resets them), pool
 * sizes and freeSocketTimeout come from app config, and maxFreeSockets is
 * clamped to maxSockets when misconfigured (e.g.
 * POSTGREST_MAX_FREE_SOCKETS=25 with POSTGREST_MAX_SOCKETS=10).
 */

import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { HttpAgent, HttpsAgent, HttpOptions } from 'agentkeepalive';

vi.mock('@/infra/config/app.config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/infra/config/app.config')>();
  return {
    ...actual,
    appConfig: {
      ...actual.appConfig,
      database: {
        ...actual.appConfig.database,
        postgrestMaxSockets: 10,
        postgrestMaxFreeSockets: 25,
        postgrestFreeSocketTimeoutMs: 3000,
      },
    },
  };
});

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return {
    ...actual,
    default: {
      ...actual.default,
      create: vi.fn(() => vi.fn()),
    },
  };
});

describe('PostgREST proxy agent construction', () => {
  it('builds keep-alive agents from app config with clamped maxFreeSockets', async () => {
    await import('../../src/services/database/postgrest-proxy.service');

    const createMock = vi.mocked(axios.create);
    const call = createMock.mock.calls.find(([options]) => options && 'httpAgent' in options);
    expect(call).toBeDefined();

    const { httpAgent, httpsAgent } = call![0] as {
      httpAgent: HttpAgent;
      httpsAgent: HttpsAgent;
    };
    expect(httpAgent).toBeInstanceOf(HttpAgent);
    expect(httpsAgent).toBeInstanceOf(HttpsAgent);
    expect(httpAgent.maxSockets).toBe(10);
    expect(httpAgent.maxFreeSockets).toBe(10);
    expect(httpsAgent.maxSockets).toBe(10);
    expect(httpsAgent.maxFreeSockets).toBe(10);
    expect((httpAgent.options as HttpOptions).freeSocketTimeout).toBe(3000);
    expect((httpsAgent.options as HttpOptions).freeSocketTimeout).toBe(3000);
  });
});
