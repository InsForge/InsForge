import { describe, expect, it } from 'vitest';
import {
  createPaymentPriceRequestSchema,
  createPaymentProductRequestSchema,
  listPaymentCatalogRequestSchema,
  listPaymentPricesRequestSchema,
  listPaymentProductsRequestSchema,
  syncPaymentsRequestSchema,
  updatePaymentPriceRequestSchema,
  updatePaymentProductRequestSchema,
  upsertPaymentsConfigRequestSchema,
} from '@insforge/shared-schemas';

describe('payments route schemas', () => {
  it('accepts test, live, and all sync targets', () => {
    expect(syncPaymentsRequestSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(syncPaymentsRequestSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(syncPaymentsRequestSchema.parse({ environment: 'all' })).toEqual({
      environment: 'all',
    });
  });

  it('defaults sync to all environments', () => {
    expect(syncPaymentsRequestSchema.parse({})).toEqual({ environment: 'all' });
  });

  it('rejects unknown sync environments', () => {
    expect(() => syncPaymentsRequestSchema.parse({ environment: 'prod' })).toThrow();
  });

  it('accepts optional catalog environment filters', () => {
    expect(listPaymentCatalogRequestSchema.parse({})).toEqual({});
    expect(listPaymentCatalogRequestSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
  });

  it('accepts Stripe key configuration requests', () => {
    expect(
      upsertPaymentsConfigRequestSchema.parse({
        environment: 'live',
        secretKey: 'sk_live_1234567890',
      })
    ).toEqual({
      environment: 'live',
      secretKey: 'sk_live_1234567890',
    });
  });

  it('rejects Stripe key configuration requests without a key', () => {
    expect(() =>
      upsertPaymentsConfigRequestSchema.parse({ environment: 'test', secretKey: '' })
    ).toThrow();
  });

  it('keeps products CRUD scoped to the test environment by rejecting environment input', () => {
    expect(listPaymentProductsRequestSchema.parse({})).toEqual({});
    expect(() => listPaymentProductsRequestSchema.parse({ environment: 'live' })).toThrow();

    expect(
      createPaymentProductRequestSchema.parse({
        name: 'Pro',
        description: null,
        active: true,
        metadata: { tier: 'pro' },
      })
    ).toEqual({
      name: 'Pro',
      description: null,
      active: true,
      metadata: { tier: 'pro' },
    });

    expect(() =>
      createPaymentProductRequestSchema.parse({ name: 'Pro', environment: 'live' })
    ).toThrow();
    expect(() => updatePaymentProductRequestSchema.parse({})).toThrow();
    expect(() =>
      updatePaymentProductRequestSchema.parse({ active: false, environment: 'live' })
    ).toThrow();
  });

  it('keeps prices CRUD scoped to the test environment by rejecting environment input', () => {
    expect(listPaymentPricesRequestSchema.parse({ stripeProductId: 'prod_123' })).toEqual({
      stripeProductId: 'prod_123',
    });
    expect(() => listPaymentPricesRequestSchema.parse({ environment: 'live' })).toThrow();

    expect(
      createPaymentPriceRequestSchema.parse({
        stripeProductId: 'prod_123',
        currency: 'USD',
        unitAmount: 2000,
        recurring: { interval: 'month', intervalCount: 1 },
      })
    ).toEqual({
      stripeProductId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      recurring: { interval: 'month', intervalCount: 1 },
    });

    expect(() =>
      createPaymentPriceRequestSchema.parse({
        stripeProductId: 'prod_123',
        currency: 'usd',
        unitAmount: 2000,
        environment: 'live',
      })
    ).toThrow();
    expect(() => updatePaymentPriceRequestSchema.parse({})).toThrow();
    expect(() =>
      updatePaymentPriceRequestSchema.parse({ active: false, environment: 'live' })
    ).toThrow();
  });
});
