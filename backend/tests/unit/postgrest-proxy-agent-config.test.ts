/**
 * postgrest-proxy-agent-config.test.ts
 *
 * Verifies the HTTP agent construction of the PostgREST proxy: pool sizes
 * come from app config, and maxFreeSockets is clamped to maxSockets when
 * misconfigured (e.g. POSTGREST_MAX_FREE_SOCKETS=25 with
 * POSTGREST_MAX_SOCKETS=10).
 */

import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import http from 'http';
import https from 'https';

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
  it('clamps maxFreeSockets to maxSockets on both agents', async () => {
    await import('../../src/services/database/postgrest-proxy.service');

    const createMock = vi.mocked(axios.create);
    const call = createMock.mock.calls.find(([options]) => options && 'httpAgent' in options);
    expect(call).toBeDefined();

    const { httpAgent, httpsAgent } = call![0] as {
      httpAgent: http.Agent;
      httpsAgent: https.Agent;
    };
    expect(httpAgent.maxSockets).toBe(10);
    expect(httpAgent.maxFreeSockets).toBe(10);
    expect(httpsAgent.maxSockets).toBe(10);
    expect(httpsAgent.maxFreeSockets).toBe(10);
  });
});
