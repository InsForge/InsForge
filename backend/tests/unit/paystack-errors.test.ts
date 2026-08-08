import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors';
import {
  PaystackApiError,
  PaystackKeyValidationError,
} from '../../src/providers/payments/paystack.provider';
import { normalizePaystackError } from '../../src/providers/payments/paystack-errors';

describe('normalizePaystackError', () => {
  it('maps local Paystack key validation errors to payment config errors', () => {
    const normalized = normalizePaystackError(new PaystackKeyValidationError('bad key'));

    expect(normalized).toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'bad key',
    });
  });

  it('preserves existing AppError instances', () => {
    const appError = new AppError('configured', 400, ERROR_CODES.PAYMENT_CONFIG_INVALID);

    expect(normalizePaystackError(appError)).toBe(appError);
  });

  it('passes through plain errors that are not Paystack API errors', () => {
    const plain = new Error('boom');

    expect(normalizePaystackError(plain)).toBe(plain);
  });

  it('wraps non-Error values in an upstream failure', () => {
    const normalized = normalizePaystackError('boom');

    expect(normalized).toBeInstanceOf(Error);
    expect(normalized).toMatchObject({
      statusCode: 502,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Paystack request failed',
    });
  });

  it('maps Paystack auth failures to payment config errors', () => {
    const normalized = normalizePaystackError(new PaystackApiError('Invalid key', 401));

    expect(normalized).toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'Invalid key',
    });
  });

  it('maps Paystack forbidden errors to payment config errors', () => {
    const normalized = normalizePaystackError(new PaystackApiError('Forbidden', 403));

    expect(normalized).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'Forbidden',
    });
  });

  it('maps Paystack rate limits to RATE_LIMITED', () => {
    const normalized = normalizePaystackError(new PaystackApiError('Too many requests', 429));

    expect(normalized).toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests',
    });
  });

  it('maps other Paystack API errors to upstream failures preserving the status', () => {
    const normalized = normalizePaystackError(new PaystackApiError('Paystack is unavailable', 500));

    expect(normalized).toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Paystack is unavailable',
    });
  });

  it('clamps API errors carrying a success status to a 502 upstream failure', () => {
    // Paystack can report a body-level failure ({ status: false }) on an HTTP
    // 200; emitting that status from the error middleware would look like
    // success to clients.
    const normalized = normalizePaystackError(new PaystackApiError('Transaction not found', 200));

    expect(normalized).toMatchObject({
      statusCode: 502,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Transaction not found',
    });
  });

  it('clamps any sub-400 API error status to 502', () => {
    const normalized = normalizePaystackError(new PaystackApiError('Moved', 302));

    expect(normalized).toMatchObject({
      statusCode: 502,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Moved',
    });
  });

  it('wraps provider network failures as upstream errors preserving the cause text', () => {
    const normalized = normalizePaystackError(
      new PaystackApiError(
        'Paystack request failed: fetch failed (getaddrinfo ENOTFOUND api.paystack.co)',
        502
      )
    );

    expect(normalized).toMatchObject({
      statusCode: 502,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Paystack request failed: fetch failed (getaddrinfo ENOTFOUND api.paystack.co)',
    });
  });

  it('maps provider timeouts to a 504 upstream failure', () => {
    const normalized = normalizePaystackError(
      new PaystackApiError('Paystack request timed out after 30000ms', 504)
    );

    expect(normalized).toMatchObject({
      statusCode: 504,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Paystack request timed out after 30000ms',
    });
  });

  it('falls back to a literal message when the API error message is blank', () => {
    const normalized = normalizePaystackError(new PaystackApiError('   ', 500));

    expect(normalized).toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Paystack request failed',
    });
  });
});
