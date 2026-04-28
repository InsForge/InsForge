import { describe, expect, it } from 'vitest';
import {
  createCheckoutSessionRequestSchema,
  createPaymentPriceRequestSchema,
  createPaymentProductRequestSchema,
  listPaymentCatalogRequestSchema,
  listPaymentHistoryRequestSchema,
  listPaymentPricesRequestSchema,
  listPaymentProductsRequestSchema,
  listSubscriptionsRequestSchema,
  syncPaymentCatalogRequestSchema,
  syncPaymentSubscriptionsRequestSchema,
  updatePaymentPriceRequestSchema,
  updatePaymentProductRequestSchema,
  upsertPaymentsConfigRequestSchema,
} from '@insforge/shared-schemas';

describe('payments route schemas', () => {
  it('accepts test, live, and all catalog sync targets', () => {
    expect(syncPaymentCatalogRequestSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(syncPaymentCatalogRequestSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(syncPaymentCatalogRequestSchema.parse({ environment: 'all' })).toEqual({
      environment: 'all',
    });
  });

  it('defaults catalog sync to all environments', () => {
    expect(syncPaymentCatalogRequestSchema.parse({})).toEqual({ environment: 'all' });
  });

  it('rejects unknown catalog sync environments', () => {
    expect(() => syncPaymentCatalogRequestSchema.parse({ environment: 'prod' })).toThrow();
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

  it('requires products CRUD callers to specify the target Stripe environment', () => {
    expect(listPaymentProductsRequestSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(() => listPaymentProductsRequestSchema.parse({})).toThrow();

    expect(
      createPaymentProductRequestSchema.parse({
        environment: 'test',
        name: 'Pro',
        description: null,
        active: true,
        metadata: { tier: 'pro' },
      })
    ).toEqual({
      environment: 'test',
      name: 'Pro',
      description: null,
      active: true,
      metadata: { tier: 'pro' },
    });

    expect(() => createPaymentProductRequestSchema.parse({ name: 'Pro' })).toThrow();
    expect(() => updatePaymentProductRequestSchema.parse({})).toThrow();
    expect(() => updatePaymentProductRequestSchema.parse({ environment: 'live' })).toThrow();
    expect(updatePaymentProductRequestSchema.parse({ active: false, environment: 'live' })).toEqual(
      {
        active: false,
        environment: 'live',
      }
    );
  });

  it('requires prices CRUD callers to specify the target Stripe environment', () => {
    expect(
      listPaymentPricesRequestSchema.parse({ environment: 'test', stripeProductId: 'prod_123' })
    ).toEqual({
      environment: 'test',
      stripeProductId: 'prod_123',
    });
    expect(() => listPaymentPricesRequestSchema.parse({ stripeProductId: 'prod_123' })).toThrow();

    expect(
      createPaymentPriceRequestSchema.parse({
        environment: 'test',
        stripeProductId: 'prod_123',
        currency: 'USD',
        unitAmount: 2000,
        recurring: { interval: 'month', intervalCount: 1 },
      })
    ).toEqual({
      environment: 'test',
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
      })
    ).toThrow();
    expect(() => updatePaymentPriceRequestSchema.parse({})).toThrow();
    expect(() => updatePaymentPriceRequestSchema.parse({ environment: 'live' })).toThrow();
    expect(updatePaymentPriceRequestSchema.parse({ active: false, environment: 'live' })).toEqual({
      active: false,
      environment: 'live',
    });
  });

  it('allows anonymous one-time checkout sessions', () => {
    expect(
      createCheckoutSessionRequestSchema.parse({
        environment: 'test',
        mode: 'payment',
        lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'buyer@example.com',
      })
    ).toEqual({
      environment: 'test',
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: 'buyer@example.com',
    });
  });

  it('requires subscription checkout sessions to specify a billing subject', () => {
    expect(() =>
      createCheckoutSessionRequestSchema.parse({
        environment: 'test',
        mode: 'subscription',
        lineItems: [{ stripePriceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      })
    ).toThrow(/billing subject/i);

    expect(
      createCheckoutSessionRequestSchema.parse({
        environment: 'test',
        mode: 'subscription',
        lineItems: [{ stripePriceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        subject: { type: 'team', id: 'team_123' },
      })
    ).toEqual({
      environment: 'test',
      mode: 'subscription',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      subject: { type: 'team', id: 'team_123' },
    });
  });

  it('requires runtime list filters to specify explicit environment and complete subject filters', () => {
    expect(listPaymentHistoryRequestSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
      limit: 50,
    });
    expect(
      listSubscriptionsRequestSchema.parse({
        environment: 'test',
        subjectType: 'organization',
        subjectId: 'org_123',
        limit: '25',
      })
    ).toEqual({
      environment: 'test',
      subjectType: 'organization',
      subjectId: 'org_123',
      limit: 25,
    });

    expect(() => listPaymentHistoryRequestSchema.parse({})).toThrow();
    expect(() =>
      listSubscriptionsRequestSchema.parse({ environment: 'test', subjectType: 'team' })
    ).toThrow(/provided together/i);
  });

  it('requires subscription sync callers to specify the target Stripe environment', () => {
    expect(syncPaymentSubscriptionsRequestSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(() => syncPaymentSubscriptionsRequestSchema.parse({})).toThrow();
  });
});
