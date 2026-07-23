/**
 * postgrest-proxy-retry.test.ts
 *
 * Unit tests for PostgrestProxyService.isRetryableError — the retry policy of
 * the PostgREST proxy.
 *
 * Policy under test:
 *   - Any error carrying an HTTP response (4xx/5xx) is NOT retried.
 *   - Timeout-class errors (ECONNABORTED, ETIMEDOUT) are NOT retried: the
 *     request may already be executing in PostgREST, so retrying risks
 *     duplicate writes and amplifies load while the database is saturated.
 *   - Connection-class errors without a response (ECONNREFUSED, ECONNRESET,
 *     DNS failures) ARE retried: the request never reached PostgREST.
 *   - Non-axios errors are NOT retried.
 */

import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { PostgrestProxyService } from '../../src/services/database/postgrest-proxy.service';

function makeAxiosError(code?: string, status?: number): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response =
    status !== undefined
      ? ({ status, data: {}, headers: {}, config, statusText: '' } as AxiosResponse)
      : undefined;
  return new AxiosError(`test error ${code ?? status}`, code, config, {}, response);
}

describe('PostgrestProxyService.isRetryableError', () => {
  it('retries connection-class errors where the request never reached PostgREST', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']) {
      expect(PostgrestProxyService.isRetryableError(makeAxiosError(code))).toBe(true);
    }
  });

  it('does not retry timeout-class errors', () => {
    expect(PostgrestProxyService.isRetryableError(makeAxiosError('ECONNABORTED'))).toBe(false);
    expect(PostgrestProxyService.isRetryableError(makeAxiosError('ETIMEDOUT'))).toBe(false);
  });

  it('does not retry errors that carry an HTTP response', () => {
    expect(PostgrestProxyService.isRetryableError(makeAxiosError('ERR_BAD_RESPONSE', 500))).toBe(
      false
    );
    expect(PostgrestProxyService.isRetryableError(makeAxiosError('ERR_BAD_REQUEST', 400))).toBe(
      false
    );
    expect(PostgrestProxyService.isRetryableError(makeAxiosError(undefined, 504))).toBe(false);
  });

  it('retries network errors without a specific code', () => {
    expect(PostgrestProxyService.isRetryableError(makeAxiosError(undefined))).toBe(true);
  });

  it('does not retry non-axios errors', () => {
    expect(PostgrestProxyService.isRetryableError(new Error('boom'))).toBe(false);
    expect(PostgrestProxyService.isRetryableError(undefined)).toBe(false);
    expect(PostgrestProxyService.isRetryableError('ECONNRESET')).toBe(false);
  });
});
