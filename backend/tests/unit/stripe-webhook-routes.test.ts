import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';
import { errorCodesSchema } from '@insforge/shared-schemas';
import { normalizeStripeWebhookError } from '../../src/api/routes/webhooks/stripe.routes';

describe('normalizeStripeWebhookError', () => {
  it('maps Stripe signature verification errors to invalid input app errors', () => {
    const error = new Error('Webhook signature verification failed');
    error.name = 'StripeSignatureVerificationError';

    const normalized = normalizeStripeWebhookError(error);

    expect(normalized).toBeInstanceOf(AppError);
    expect(normalized).toMatchObject({
      message: 'Webhook signature verification failed',
      statusCode: 400,
      code: errorCodesSchema.enum.INVALID_INPUT,
    });
  });

  it('passes through unrelated errors unchanged', () => {
    const error = new Error('Unexpected failure');

    expect(normalizeStripeWebhookError(error)).toBe(error);
  });
});
