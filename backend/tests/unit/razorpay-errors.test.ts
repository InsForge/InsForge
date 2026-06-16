import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors';
import { RazorpayKeyValidationError } from '../../src/providers/payments/razorpay.provider';
import { normalizeRazorpayError } from '../../src/providers/payments/razorpay-errors';

describe('normalizeRazorpayError', () => {
  it('maps local Razorpay key validation errors to payment config errors', () => {
    const normalized = normalizeRazorpayError(new RazorpayKeyValidationError('bad key'));

    expect(normalized).toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'bad key',
    });
  });

  it('preserves existing AppError instances', () => {
    const appError = new AppError('configured', 400, ERROR_CODES.PAYMENT_CONFIG_INVALID);

    expect(normalizeRazorpayError(appError)).toBe(appError);
  });

  it('passes through errors that are not Razorpay SDK errors', () => {
    const plain = new Error('boom');

    expect(normalizeRazorpayError(plain)).toBe(plain);
  });

  it('maps Razorpay rate limits to RATE_LIMITED', () => {
    const normalized = normalizeRazorpayError({
      statusCode: 429,
      error: { code: 'BAD_REQUEST_ERROR', description: 'Too many requests' },
    });

    expect(normalized).toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests',
    });
  });

  it('maps Razorpay auth errors to payment config errors', () => {
    const normalized = normalizeRazorpayError({
      statusCode: 401,
      error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' },
    });

    expect(normalized).toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'Authentication failed',
    });
  });

  it('maps Razorpay forbidden errors to payment config errors', () => {
    const normalized = normalizeRazorpayError({
      statusCode: 403,
      error: { code: 'BAD_REQUEST_ERROR', description: 'Forbidden' },
    });

    expect(normalized).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'Forbidden',
    });
  });

  it('maps generic Razorpay API errors to upstream failures using the nested description', () => {
    const normalized = normalizeRazorpayError({
      statusCode: 500,
      error: { code: 'SERVER_ERROR', description: 'Razorpay is unavailable' },
    });

    expect(normalized).toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Razorpay is unavailable',
    });
  });

  it('falls back to the top-level message when the nested description is blank', () => {
    const normalized = normalizeRazorpayError({
      statusCode: 500,
      error: { code: 'SERVER_ERROR', description: '   ' },
      message: 'top-level failure',
    });

    expect(normalized).toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'top-level failure',
    });
  });

  it('falls back to a literal message when neither description nor message is usable', () => {
    const normalized = normalizeRazorpayError({
      statusCode: 500,
      error: { code: 'SERVER_ERROR' },
    });

    expect(normalized).toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Razorpay request failed',
    });
  });
});
