/**
 * postgrest-proxy-retry.test.ts
 *
 * Unit tests for PostgrestProxyService.isRetryableError — the retry policy of
 * the PostgREST proxy.
 *
 * Policy under test:
 *   - Any error carrying an HTTP response (4xx/5xx) is NOT retried.
 *   - Timeout-class errors (ECONNABORTED, ETIMEDOUT) are NOT retried for any
 *     method: the request may already be executing in PostgREST, so retrying
 *     risks duplicate writes and amplifies load while the database is
 *     saturated.
 *   - Connection-never-established errors (ECONNREFUSED, DNS failures) ARE
 *     retried for every method: the request cannot have reached PostgREST.
 *   - Ambiguous network errors (ECONNRESET, EPIPE, missing code) are retried
 *     only for idempotent methods (GET/HEAD/OPTIONS) — for writes the request
 *     may already have committed.
 *   - Exception (isStaleSocketReset): an ECONNRESET on a reused keep-alive
 *     socket proves the server closed the idle connection before the request
 *     was processed, so it is replayable for any method.
 *   - Response-less non-network axios errors (cancellation, bad config) and
 *     non-axios errors are NOT retried.
 */

import { describe, it, expect } from 'vitest';
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { PostgrestProxyService } from '../../src/services/database/postgrest-proxy.service';

function makeAxiosError(code?: string, status?: number, request: unknown = {}): AxiosError {
  const config = { headers: {} } as InternalAxiosRequestConfig;
  const response =
    status !== undefined
      ? ({ status, data: {}, headers: {}, config, statusText: '' } as AxiosResponse)
      : undefined;
  return new AxiosError(`test error ${code ?? status}`, code, config, request, response);
}

const ALL_METHODS = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PATCH', 'PUT', 'DELETE'];
const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];
const IDEMPOTENT_METHODS = ['GET', 'HEAD', 'OPTIONS'];

describe('PostgrestProxyService.isRetryableError', () => {
  it('retries connection-never-established errors for every method', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']) {
      for (const method of ALL_METHODS) {
        expect(PostgrestProxyService.isRetryableError(makeAxiosError(code), method)).toBe(true);
      }
    }
  });

  it('retries ambiguous network errors only for idempotent methods', () => {
    for (const code of ['ECONNRESET', 'EPIPE', undefined]) {
      for (const method of IDEMPOTENT_METHODS) {
        expect(PostgrestProxyService.isRetryableError(makeAxiosError(code), method)).toBe(true);
      }
      for (const method of WRITE_METHODS) {
        expect(PostgrestProxyService.isRetryableError(makeAxiosError(code), method)).toBe(false);
      }
    }
  });

  it('matches methods case-insensitively', () => {
    expect(PostgrestProxyService.isRetryableError(makeAxiosError('ECONNRESET'), 'get')).toBe(true);
    expect(PostgrestProxyService.isRetryableError(makeAxiosError('ECONNRESET'), 'post')).toBe(
      false
    );
  });

  it('does not retry timeout-class errors for any method', () => {
    for (const code of ['ECONNABORTED', 'ETIMEDOUT']) {
      for (const method of ALL_METHODS) {
        expect(PostgrestProxyService.isRetryableError(makeAxiosError(code), method)).toBe(false);
      }
    }
  });

  it('does not retry errors that carry an HTTP response', () => {
    expect(
      PostgrestProxyService.isRetryableError(makeAxiosError('ERR_BAD_RESPONSE', 500), 'GET')
    ).toBe(false);
    expect(
      PostgrestProxyService.isRetryableError(makeAxiosError('ERR_BAD_REQUEST', 400), 'GET')
    ).toBe(false);
    expect(PostgrestProxyService.isRetryableError(makeAxiosError(undefined, 504), 'GET')).toBe(
      false
    );
  });

  it('does not retry response-less non-network axios errors for any method', () => {
    for (const code of ['ERR_CANCELED', 'ERR_BAD_OPTION_VALUE', 'ERR_FR_TOO_MANY_REDIRECTS']) {
      for (const method of ALL_METHODS) {
        expect(PostgrestProxyService.isRetryableError(makeAxiosError(code), method)).toBe(false);
      }
    }
  });

  it('does not retry non-axios errors', () => {
    expect(PostgrestProxyService.isRetryableError(new Error('boom'), 'GET')).toBe(false);
    expect(PostgrestProxyService.isRetryableError(undefined, 'GET')).toBe(false);
    expect(PostgrestProxyService.isRetryableError('ECONNRESET', 'GET')).toBe(false);
  });
});

describe('PostgrestProxyService.isStaleSocketReset', () => {
  it('matches ECONNRESET on a reused keep-alive socket', () => {
    expect(
      PostgrestProxyService.isStaleSocketReset(
        makeAxiosError('ECONNRESET', undefined, { reusedSocket: true })
      )
    ).toBe(true);
  });

  it('does not match ECONNRESET on a fresh socket', () => {
    expect(PostgrestProxyService.isStaleSocketReset(makeAxiosError('ECONNRESET'))).toBe(false);
    expect(
      PostgrestProxyService.isStaleSocketReset(
        makeAxiosError('ECONNRESET', undefined, { reusedSocket: false })
      )
    ).toBe(false);
    expect(
      PostgrestProxyService.isStaleSocketReset(makeAxiosError('ECONNRESET', undefined, undefined))
    ).toBe(false);
  });

  it('does not match other error codes even on reused sockets', () => {
    for (const code of ['EPIPE', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNREFUSED', undefined]) {
      expect(
        PostgrestProxyService.isStaleSocketReset(
          makeAxiosError(code, undefined, { reusedSocket: true })
        )
      ).toBe(false);
    }
  });

  it('does not match errors that carry an HTTP response', () => {
    expect(
      PostgrestProxyService.isStaleSocketReset(
        makeAxiosError('ECONNRESET', 502, { reusedSocket: true })
      )
    ).toBe(false);
  });

  it('does not match non-axios errors', () => {
    expect(PostgrestProxyService.isStaleSocketReset(new Error('socket hang up'))).toBe(false);
    expect(PostgrestProxyService.isStaleSocketReset(undefined)).toBe(false);
  });
});
