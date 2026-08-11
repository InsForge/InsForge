/**
 * postgrest-proxy-stale-socket-retry.test.ts
 *
 * Verifies the forward-loop behavior for ECONNRESET on a reused keep-alive
 * socket (Node's `request.reusedSocket` pattern):
 *   - Any method — including POST — is replayed exactly once, immediately
 *     (no backoff timer), because the server closed the idle socket before
 *     the request was processed.
 *   - A second reused-socket reset falls through to the method-based policy,
 *     so a POST is not replayed again.
 *   - A reset on a fresh socket is not covered by the exception: a POST
 *     fails without any retry.
 *   - An idempotent method keeps its backoff retries after the one-shot
 *     immediate replay is spent.
 *
 * Fake timers are enabled throughout: if an "immediate" replay ever waited
 * on a backoff timer, the awaited promise would hang and the test would
 * time out.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, InternalAxiosRequestConfig } from 'axios';

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

import logger from '../../src/utils/logger';
import { PostgrestProxyService } from '../../src/services/database/postgrest-proxy.service';

function connectionReset(reusedSocket: boolean): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  return new AxiosError('socket hang up', 'ECONNRESET', config, { reusedSocket });
}

const okResponse = { data: { ok: true }, status: 200, headers: {} };

describe('PostgREST proxy stale keep-alive socket retry', () => {
  beforeEach(() => {
    requestMock.mockReset();
    vi.mocked(logger.warn).mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('replays a POST once, immediately, after a reset on a reused socket', async () => {
    requestMock.mockRejectedValueOnce(connectionReset(true)).mockResolvedValueOnce(okResponse);

    const result = await PostgrestProxyService.getInstance().forward({
      method: 'POST',
      path: '/rpc/claim_job',
    });

    expect(requestMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe(200);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a distinct, alertable message when a non-idempotent request is replayed', async () => {
    requestMock.mockRejectedValueOnce(connectionReset(true)).mockResolvedValueOnce(okResponse);

    await PostgrestProxyService.getInstance().forward({
      method: 'POST',
      path: '/rpc/claim_job',
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('stale-socket replay of non-idempotent request'),
      expect.objectContaining({ method: 'POST', staleSocketRetry: true })
    );
  });

  it('keeps the generic retry message for idempotent stale replays', async () => {
    requestMock.mockRejectedValueOnce(connectionReset(true)).mockResolvedValueOnce(okResponse);

    await PostgrestProxyService.getInstance().forward({ method: 'GET', path: '/items' });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('PostgREST request failed, retrying'),
      expect.objectContaining({ method: 'GET', staleSocketRetry: true })
    );
  });

  it('does not replay a POST a second time on consecutive reused-socket resets', async () => {
    requestMock.mockRejectedValue(connectionReset(true));

    await expect(
      PostgrestProxyService.getInstance().forward({ method: 'POST', path: '/rpc/claim_job' })
    ).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does not replay a POST at all after a reset on a fresh socket', async () => {
    requestMock.mockRejectedValue(connectionReset(false));

    await expect(
      PostgrestProxyService.getInstance().forward({ method: 'POST', path: '/rpc/claim_job' })
    ).rejects.toMatchObject({ code: 'ECONNRESET' });

    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('keeps backoff retries for GET after the one-shot immediate replay is spent', async () => {
    requestMock.mockRejectedValue(connectionReset(true));

    const pending = PostgrestProxyService.getInstance().forward({
      method: 'GET',
      path: '/items',
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'ECONNRESET' });
    await vi.runAllTimersAsync();
    await assertion;

    // attempt 1, immediate stale-socket replay, then one backoff replay
    expect(requestMock).toHaveBeenCalledTimes(3);
  });
});
