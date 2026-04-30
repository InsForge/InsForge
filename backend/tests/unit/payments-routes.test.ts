import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createCheckoutSessionRequestSchema,
  createCustomerPortalSessionRequestSchema,
  createPaymentPriceRequestSchema,
  createPaymentProductRequestSchema,
  listPaymentCatalogRequestSchema,
  listPaymentHistoryRequestSchema,
  listPaymentPricesRequestSchema,
  listPaymentProductsRequestSchema,
  listSubscriptionsRequestSchema,
  syncPaymentsRequestSchema,
  updatePaymentPriceRequestSchema,
  updatePaymentProductRequestSchema,
  upsertPaymentsConfigRequestSchema,
} from '@insforge/shared-schemas';

const FAKE_LIVE_SECRET_KEY = 'stripe_live_secret_placeholder';

describe('payments route schemas', () => {
  const paymentsRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/index.routes.ts'),
    'utf-8'
  );

  it('keeps checkout session creation on runtime auth before admin-only payments routes', () => {
    expect(paymentsRouteSource).toContain('verifyAdmin, verifyUser');
    expect(paymentsRouteSource).toMatch(
      /router\.post\(\s*'\/checkout-sessions'[\s\S]*verifyUser[\s\S]*createCheckoutSession/
    );
    expect(paymentsRouteSource.indexOf("'/checkout-sessions'")).toBeLessThan(
      paymentsRouteSource.indexOf('router.use(verifyAdmin)')
    );
    expect(paymentsRouteSource).toContain('Checkout session creation requires a user token');
  });

  it('keeps customer portal session creation on runtime auth before admin-only payments routes', () => {
    expect(paymentsRouteSource).toMatch(
      /router\.post\(\s*'\/customer-portal-sessions'[\s\S]*verifyUser[\s\S]*createCustomerPortalSession/
    );
    expect(paymentsRouteSource.indexOf("'/customer-portal-sessions'")).toBeLessThan(
      paymentsRouteSource.indexOf('router.use(verifyAdmin)')
    );
    expect(paymentsRouteSource).toContain('Customer portal session creation requires a user token');
  });

  it('accepts test, live, and all unified sync targets', () => {
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

  it('defaults unified payment sync to all environments', () => {
    expect(syncPaymentsRequestSchema.parse({})).toEqual({ environment: 'all' });
  });

  it('keeps unified payment sync behind the admin-only route guard', () => {
    expect(paymentsRouteSource.indexOf("'/sync'")).toBeGreaterThan(
      paymentsRouteSource.indexOf('router.use(verifyAdmin)')
    );
    expect(paymentsRouteSource).toMatch(
      /router\.post\(\s*'\/sync'[\s\S]*syncPaymentsRequestSchema[\s\S]*syncPayments/
    );
    expect(paymentsRouteSource).not.toContain("'/catalog/sync'");
    expect(paymentsRouteSource).not.toContain("'/subscriptions/sync'");
  });

  it('keeps managed webhook configuration behind the admin-only route guard', () => {
    expect(paymentsRouteSource.indexOf("'/webhooks/:environment/configure'")).toBeGreaterThan(
      paymentsRouteSource.indexOf('router.use(verifyAdmin)')
    );
    expect(paymentsRouteSource).toMatch(
      /router\.post\(\s*'\/webhooks\/:environment\/configure'[\s\S]*stripeEnvironmentSchema[\s\S]*configureWebhook/
    );
  });

  it('rejects unknown unified sync environments', () => {
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
        secretKey: FAKE_LIVE_SECRET_KEY,
      })
    ).toEqual({
      environment: 'live',
      secretKey: FAKE_LIVE_SECRET_KEY,
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
        idempotencyKey: 'agent-product-123',
      })
    ).toEqual({
      environment: 'test',
      name: 'Pro',
      description: null,
      active: true,
      metadata: { tier: 'pro' },
      idempotencyKey: 'agent-product-123',
    });

    expect(() => createPaymentProductRequestSchema.parse({ name: 'Pro' })).toThrow();
    expect(() =>
      createPaymentProductRequestSchema.parse({
        environment: 'test',
        name: 'Pro',
        idempotencyKey: 'x'.repeat(201),
      })
    ).toThrow(/200 characters/i);
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
        idempotencyKey: 'agent-price-123',
      })
    ).toEqual({
      environment: 'test',
      stripeProductId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      recurring: { interval: 'month', intervalCount: 1 },
      idempotencyKey: 'agent-price-123',
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
        idempotencyKey: 'checkout-123',
      })
    ).toEqual({
      environment: 'test',
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: 'buyer@example.com',
      idempotencyKey: 'checkout-123',
    });
  });

  it('rejects caller-provided InsForge-reserved checkout metadata', () => {
    expect(() =>
      createCheckoutSessionRequestSchema.parse({
        environment: 'test',
        mode: 'payment',
        lineItems: [{ stripePriceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        metadata: {
          insforge_subject_type: 'team',
          insforge_subject_id: 'team_victim',
        },
      })
    ).toThrow(/reserved/i);
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

  it('requires customer portal sessions to specify an environment and billing subject', () => {
    expect(
      createCustomerPortalSessionRequestSchema.parse({
        environment: 'test',
        subject: { type: 'team', id: 'team_123' },
        returnUrl: 'https://example.com/account',
        configuration: 'bpc_123',
      })
    ).toEqual({
      environment: 'test',
      subject: { type: 'team', id: 'team_123' },
      returnUrl: 'https://example.com/account',
      configuration: 'bpc_123',
    });

    expect(() =>
      createCustomerPortalSessionRequestSchema.parse({
        environment: 'test',
        returnUrl: 'https://example.com/account',
      })
    ).toThrow();
    expect(() =>
      createCustomerPortalSessionRequestSchema.parse({
        environment: 'test',
        subject: { type: 'team', id: 'team_123' },
        returnUrl: 'not-a-url',
      })
    ).toThrow(/valid URL/i);
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
});
