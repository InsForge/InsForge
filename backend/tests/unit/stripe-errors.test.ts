import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { AppError } from '../../src/utils/errors';
import { StripeKeyValidationError } from '../../src/providers/payments/stripe.provider';
import { normalizeStripeError } from '../../src/providers/payments/stripe-errors';

describe('normalizeStripeError', () => {
  it('maps local Stripe key validation errors to invalid input', () => {
    const normalized = normalizeStripeError(new StripeKeyValidationError('bad key'));

    expect(normalized).toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.INVALID_INPUT,
      message: 'bad key',
    });
  });

  it('preserves existing AppError instances', () => {
    const appError = new AppError('configured', 400, ERROR_CODES.PAYMENT_CONFIG_INVALID);

    expect(normalizeStripeError(appError)).toBe(appError);
  });

  it('maps Stripe rate limits to RATE_LIMITED', () => {
    const normalized = normalizeStripeError({
      type: 'StripeRateLimitError',
      statusCode: 429,
      message: 'Too many requests',
    });

    expect(normalized).toMatchObject({
      statusCode: 429,
      code: ERROR_CODES.RATE_LIMITED,
      message: 'Too many requests',
    });
  });

  it('maps Stripe auth errors to payment config errors', () => {
    const normalized = normalizeStripeError({
      type: 'StripeAuthenticationError',
      statusCode: 401,
      message: 'Invalid API Key provided',
    });

    expect(normalized).toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.PAYMENT_CONFIG_INVALID,
      message: 'Invalid API Key provided',
    });
  });

  it('maps generic Stripe API errors to upstream failures', () => {
    const normalized = normalizeStripeError({
      type: 'StripeAPIError',
      statusCode: 500,
      message: 'Stripe is unavailable',
    });

    expect(normalized).toMatchObject({
      statusCode: 500,
      code: ERROR_CODES.UPSTREAM_FAILURE,
      message: 'Stripe is unavailable',
    });
  });
});
