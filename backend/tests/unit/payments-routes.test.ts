import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  createCheckoutSessionBodySchema,
  createCustomerPortalSessionBodySchema,
  createPaymentPriceBodySchema,
  createPaymentProductBodySchema,
  listPaymentCatalogQuerySchema,
  listPaymentCustomersQuerySchema,
  listPaymentHistoryQuerySchema,
  listPaymentPricesQuerySchema,
  listPaymentProductsQuerySchema,
  listSubscriptionsQuerySchema,
  paymentEnvironmentParamsSchema,
  updatePaymentPriceBodySchema,
  updatePaymentProductBodySchema,
  upsertPaymentsConfigBodySchema,
} from '@insforge/shared-schemas';

const FAKE_LIVE_SECRET_KEY = 'stripe_live_secret_placeholder';

describe('payments route schemas', () => {
  const paymentsRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/index.routes.ts'),
    'utf-8'
  );
  const configRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/config.routes.ts'),
    'utf-8'
  );
  const catalogRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/catalog.routes.ts'),
    'utf-8'
  );

  it('keeps checkout session creation on runtime auth before environment admin routes', () => {
    const adminGuardIndex = paymentsRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(paymentsRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/checkout-sessions'[\s\S]*verifyUser[\s\S]*createCheckoutSessionBodySchema/
    );
    expect(paymentsRouteSource.indexOf("'/checkout-sessions'")).toBeLessThan(adminGuardIndex);
    expect(paymentsRouteSource).toContain('Checkout session creation requires a user token');
  });

  it('keeps customer portal session creation on runtime auth before environment admin routes', () => {
    const adminGuardIndex = paymentsRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(paymentsRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/customer-portal-sessions'[\s\S]*verifyUser[\s\S]*createCustomerPortalSessionBodySchema/
    );
    expect(paymentsRouteSource.indexOf("'/customer-portal-sessions'")).toBeLessThan(
      adminGuardIndex
    );
    expect(paymentsRouteSource).toContain('Customer portal session creation requires a user token');
  });

  it('keeps global admin config routes explicit and admin-guarded', () => {
    expect(paymentsRouteSource).toMatch(/router\.get\(\s*'\/status',\s*verifyAdmin/);
    expect(paymentsRouteSource).toMatch(/router\.get\(\s*'\/config',\s*verifyAdmin/);
    expect(paymentsRouteSource).toMatch(
      /router\.post\(\s*'\/sync',\s*verifyAdmin[\s\S]*environment: 'all'/
    );
  });

  it('mounts all environment-scoped payments routes under one shared environment router', () => {
    expect(paymentsRouteSource).toContain(
      'const environmentRouter = Router({ mergeParams: true });'
    );
    expect(paymentsRouteSource).toContain("router.use('/:environment', environmentRouter)");
  });

  it('keeps environment-scoped config, catalog, and admin reads behind the environment admin guard', () => {
    const adminGuardIndex = paymentsRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(paymentsRouteSource.indexOf('environmentRouter.use(configRouter)')).toBeGreaterThan(
      adminGuardIndex
    );
    expect(
      paymentsRouteSource.indexOf("environmentRouter.use('/catalog', catalogRouter)")
    ).toBeGreaterThan(adminGuardIndex);
    expect(paymentsRouteSource.indexOf("'/payment-history'")).toBeGreaterThan(adminGuardIndex);
    expect(paymentsRouteSource.indexOf("'/subscriptions'")).toBeGreaterThan(adminGuardIndex);
    expect(paymentsRouteSource.indexOf("'/customers'")).toBeGreaterThan(adminGuardIndex);
    expect(paymentsRouteSource).toMatch(
      /environmentRouter\.get\(\s*'\/customers'[\s\S]*listPaymentCustomersQuerySchema[\s\S]*listCustomers/
    );
  });

  it('keeps environment-scoped config routes in the dedicated config router', () => {
    expect(configRouteSource).toContain('const router = Router({ mergeParams: true });');
    expect(configRouteSource).toMatch(
      /router\.put\(\s*'\/config'[\s\S]*upsertPaymentsConfigBodySchema/
    );
    expect(configRouteSource).toMatch(/router\.delete\(\s*'\/config'/);
    expect(configRouteSource).toMatch(/router\.post\(\s*'\/sync'/);
    expect(configRouteSource).toMatch(/router\.post\(\s*'\/webhook'/);
    expect(configRouteSource).not.toMatch(/router\.get\(\s*'\/status'/);
    expect(configRouteSource).not.toMatch(/router\.get\(\s*'\/config'/);
  });

  it('keeps products and prices consolidated in the catalog router', () => {
    expect(catalogRouteSource).toMatch(/router\.get\(\s*'\/'[\s\S]*listCatalog/);
    expect(catalogRouteSource).toMatch(/router\.get\(\s*'\/products'/);
    expect(catalogRouteSource).toMatch(/router\.get\(\s*'\/prices'/);
    expect(catalogRouteSource).toMatch(
      /router\.post\(\s*'\/products'[\s\S]*createPaymentProductBodySchema/
    );
    expect(catalogRouteSource).toMatch(
      /router\.post\(\s*'\/prices'[\s\S]*createPaymentPriceBodySchema/
    );
    expect(catalogRouteSource).not.toContain('products.routes');
    expect(catalogRouteSource).not.toContain('prices.routes');
  });

  it('requires environment path params for environment-scoped routes', () => {
    expect(paymentEnvironmentParamsSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(paymentEnvironmentParamsSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(() => paymentEnvironmentParamsSchema.parse({ environment: 'prod' })).toThrow();
  });

  it('accepts empty catalog and products query strings for environment-scoped reads', () => {
    expect(listPaymentCatalogQuerySchema.parse({})).toEqual({});
    expect(listPaymentProductsQuerySchema.parse({})).toEqual({});
    expect(() => listPaymentCatalogQuerySchema.parse({ environment: 'test' })).toThrow();
  });

  it('accepts Stripe key configuration bodies without embedding environment in the body', () => {
    expect(
      upsertPaymentsConfigBodySchema.parse({
        secretKey: FAKE_LIVE_SECRET_KEY,
      })
    ).toEqual({
      secretKey: FAKE_LIVE_SECRET_KEY,
    });
    expect(() => upsertPaymentsConfigBodySchema.parse({ secretKey: '' })).toThrow();
    expect(() =>
      upsertPaymentsConfigBodySchema.parse({
        environment: 'live',
        secretKey: FAKE_LIVE_SECRET_KEY,
      })
    ).toThrow();
  });

  it('accepts product CRUD bodies without embedding environment in the body', () => {
    expect(
      createPaymentProductBodySchema.parse({
        name: 'Pro',
        description: null,
        active: true,
        metadata: { tier: 'pro' },
        idempotencyKey: 'agent-product-123',
      })
    ).toEqual({
      name: 'Pro',
      description: null,
      active: true,
      metadata: { tier: 'pro' },
      idempotencyKey: 'agent-product-123',
    });

    expect(() =>
      createPaymentProductBodySchema.parse({ name: 'Pro', environment: 'test' })
    ).toThrow();
    expect(() =>
      createPaymentProductBodySchema.parse({
        name: 'Pro',
        idempotencyKey: 'x'.repeat(201),
      })
    ).toThrow(/200 characters/i);
    expect(() => updatePaymentProductBodySchema.parse({})).toThrow();
    expect(updatePaymentProductBodySchema.parse({ active: false })).toEqual({
      active: false,
    });
    expect(() => updatePaymentProductBodySchema.parse({ environment: 'live' })).toThrow();
  });

  it('accepts price CRUD bodies and query filters without embedding environment in the body', () => {
    expect(listPaymentPricesQuerySchema.parse({ stripeProductId: 'prod_123' })).toEqual({
      stripeProductId: 'prod_123',
    });
    expect(
      createPaymentPriceBodySchema.parse({
        stripeProductId: 'prod_123',
        currency: 'USD',
        unitAmount: 2000,
        recurring: { interval: 'month', intervalCount: 1 },
        idempotencyKey: 'agent-price-123',
      })
    ).toEqual({
      stripeProductId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      recurring: { interval: 'month', intervalCount: 1 },
      idempotencyKey: 'agent-price-123',
    });
    expect(() =>
      createPaymentPriceBodySchema.parse({
        stripeProductId: 'prod_123',
        currency: 'usd',
        unitAmount: 2000,
        environment: 'test',
      })
    ).toThrow();
    expect(() => updatePaymentPriceBodySchema.parse({})).toThrow();
    expect(updatePaymentPriceBodySchema.parse({ active: false })).toEqual({ active: false });
    expect(() => updatePaymentPriceBodySchema.parse({ environment: 'live' })).toThrow();
  });

  it('allows anonymous one-time checkout sessions without embedding environment in the body', () => {
    expect(
      createCheckoutSessionBodySchema.parse({
        mode: 'payment',
        lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'buyer@example.com',
        idempotencyKey: 'checkout-123',
      })
    ).toEqual({
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
      createCheckoutSessionBodySchema.parse({
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
      createCheckoutSessionBodySchema.parse({
        mode: 'subscription',
        lineItems: [{ stripePriceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      })
    ).toThrow(/billing subject/i);

    expect(
      createCheckoutSessionBodySchema.parse({
        mode: 'subscription',
        lineItems: [{ stripePriceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        subject: { type: 'team', id: 'team_123' },
      })
    ).toEqual({
      mode: 'subscription',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      subject: { type: 'team', id: 'team_123' },
    });
  });

  it('requires customer portal session bodies to specify a billing subject without embedding environment', () => {
    expect(
      createCustomerPortalSessionBodySchema.parse({
        subject: { type: 'team', id: 'team_123' },
        returnUrl: 'https://example.com/account',
        configuration: 'bpc_123',
      })
    ).toEqual({
      subject: { type: 'team', id: 'team_123' },
      returnUrl: 'https://example.com/account',
      configuration: 'bpc_123',
    });

    expect(() =>
      createCustomerPortalSessionBodySchema.parse({
        returnUrl: 'https://example.com/account',
      })
    ).toThrow();
    expect(() =>
      createCustomerPortalSessionBodySchema.parse({
        subject: { type: 'team', id: 'team_123' },
        returnUrl: 'not-a-url',
      })
    ).toThrow(/valid URL/i);
    expect(() =>
      createCustomerPortalSessionBodySchema.parse({
        environment: 'test',
        subject: { type: 'team', id: 'team_123' },
      })
    ).toThrow();
  });

  it('requires runtime list query filters to omit environment and keep complete subject filters', () => {
    expect(listPaymentHistoryQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      listSubscriptionsQuerySchema.parse({
        subjectType: 'organization',
        subjectId: 'org_123',
        limit: '25',
      })
    ).toEqual({
      subjectType: 'organization',
      subjectId: 'org_123',
      limit: 25,
    });

    expect(() => listPaymentHistoryQuerySchema.parse({ environment: 'live' })).toThrow();
    expect(() => listSubscriptionsQuerySchema.parse({ subjectType: 'team' })).toThrow(
      /provided together/i
    );
  });

  it('requires admin customer mirror reads to omit environment from the query and normalize limit', () => {
    expect(
      listPaymentCustomersQuerySchema.parse({
        limit: '25',
      })
    ).toEqual({
      limit: 25,
    });

    expect(listPaymentCustomersQuerySchema.parse({})).toEqual({
      limit: 50,
    });

    expect(() => listPaymentCustomersQuerySchema.parse({ environment: 'test' })).toThrow();
    expect(() => listPaymentCustomersQuerySchema.parse({ limit: 0 })).toThrow();
  });
});
