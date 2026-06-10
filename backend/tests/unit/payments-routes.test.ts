import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  cancelRazorpaySubscriptionBodySchema,
  createCheckoutSessionBodySchema,
  createCustomerPortalSessionBodySchema,
  createRazorpayItemBodySchema,
  createRazorpayOrderBodySchema,
  createRazorpayPlanBodySchema,
  createRazorpaySubscriptionBodySchema,
  createStripePriceBodySchema,
  createStripeProductBodySchema,
  getRazorpayWebhookSetupResponseSchema,
  listStripeCatalogQuerySchema,
  listPaymentCustomersQuerySchema,
  listPaymentTransactionsQuerySchema,
  listStripePricesQuerySchema,
  listStripeProductsQuerySchema,
  listRazorpaySubscriptionsQuerySchema,
  listStripeSubscriptionsQuerySchema,
  paymentEnvironmentParamsSchema,
  pauseRazorpaySubscriptionBodySchema,
  razorpayEnvironmentParamsSchema,
  razorpaySubscriptionParamsSchema,
  getRazorpayConfigResponseSchema,
  getRazorpayStatusResponseSchema,
  razorpayWebhookParamsSchema,
  resumeRazorpaySubscriptionBodySchema,
  syncRazorpayPaymentsResponseSchema,
  updateStripePriceBodySchema,
  updateStripeProductBodySchema,
  upsertStripeConfigBodySchema,
  upsertRazorpayConfigBodySchema,
  updateRazorpayItemBodySchema,
  verifyRazorpayOrderBodySchema,
  verifyRazorpaySubscriptionBodySchema,
} from '@insforge/shared-schemas';

const FAKE_LIVE_SECRET_KEY = 'stripe_live_secret_placeholder';

describe('payments route schemas', () => {
  const paymentsRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/index.routes.ts'),
    'utf-8'
  );
  const paymentsApiSchemaSource = readFileSync(
    resolve(__dirname, '../../../packages/shared-schemas/src/payments-api.schema.ts'),
    'utf-8'
  );
  const stripeRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/stripe/index.routes.ts'),
    'utf-8'
  );
  const stripeConfigRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/stripe/config.routes.ts'),
    'utf-8'
  );
  const stripeCatalogRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/stripe/catalog.routes.ts'),
    'utf-8'
  );
  const paymentHelpersSource = readFileSync(
    resolve(__dirname, '../../src/services/payments/helpers.ts'),
    'utf-8'
  );
  const razorpayRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/razorpay/index.routes.ts'),
    'utf-8'
  );
  const razorpayConfigRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/razorpay/config.routes.ts'),
    'utf-8'
  );
  const razorpayCatalogRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/payments/razorpay/catalog.routes.ts'),
    'utf-8'
  );
  const webhooksRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/webhooks/index.routes.ts'),
    'utf-8'
  );
  const razorpayWebhookRouteSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/webhooks/razorpay.routes.ts'),
    'utf-8'
  );
  const razorpayWebhookServiceSource = readFileSync(
    resolve(__dirname, '../../src/services/payments/razorpay/webhook.service.ts'),
    'utf-8'
  );
  const razorpaySyncServiceSource = readFileSync(
    resolve(__dirname, '../../src/services/payments/razorpay/sync.service.ts'),
    'utf-8'
  );
  const razorpayConfigServiceSource = readFileSync(
    resolve(__dirname, '../../src/services/payments/razorpay/config.service.ts'),
    'utf-8'
  );
  const razorpayProviderSource = readFileSync(
    resolve(__dirname, '../../src/providers/payments/razorpay.provider.ts'),
    'utf-8'
  );

  it('keeps checkout session creation on runtime auth before environment admin routes', () => {
    const adminGuardIndex = stripeRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(stripeRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/checkout-sessions'[\s\S]*verifyUser[\s\S]*createCheckoutSessionBodySchema/
    );
    expect(stripeRouteSource.indexOf("'/checkout-sessions'")).toBeLessThan(adminGuardIndex);
    expect(stripeRouteSource).toContain('Checkout session creation requires a user token');
  });

  it('keeps customer portal session creation on runtime auth before environment admin routes', () => {
    const adminGuardIndex = stripeRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(stripeRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/customer-portal-sessions'[\s\S]*verifyUser[\s\S]*createCustomerPortalSessionBodySchema/
    );
    expect(stripeRouteSource.indexOf("'/customer-portal-sessions'")).toBeLessThan(adminGuardIndex);
    expect(stripeRouteSource).toContain('Customer portal session creation requires a user token');
  });

  it('keeps global admin config routes explicit and admin-guarded', () => {
    expect(stripeRouteSource).toMatch(/router\.get\(\s*'\/status',\s*verifyAdmin/);
    expect(stripeRouteSource).toMatch(/router\.get\(\s*'\/config',\s*verifyAdmin/);
    expect(razorpayRouteSource).toMatch(/router\.get\(\s*'\/status',\s*verifyAdmin/);
    expect(razorpayRouteSource).toMatch(/router\.get\(\s*'\/config',\s*verifyAdmin/);
    expect(paymentsRouteSource).toMatch(/router\.use\(\s*'\/stripe',\s*stripeRouter/);
    expect(stripeRouteSource).toMatch(
      /router\.post\(\s*'\/sync',\s*verifyAdmin[\s\S]*environment: 'all'/
    );
    expect(razorpayRouteSource).toMatch(
      /router\.post\(\s*'\/sync',\s*verifyAdmin[\s\S]*syncAll\('all'\)/
    );
  });

  it('mounts Stripe environment-scoped payments routes under the Stripe router', () => {
    expect(stripeRouteSource).toContain('const environmentRouter = Router({ mergeParams: true });');
    expect(stripeRouteSource).toContain("router.use('/:environment', environmentRouter)");
    expect(paymentsRouteSource).toContain("router.use('/stripe', stripeRouter)");
    expect(paymentsRouteSource).toContain("router.use('/razorpay', razorpayRouter)");
    expect(paymentsRouteSource).toContain("from './stripe/index.routes.js'");
    expect(paymentsRouteSource).toContain("from './razorpay/index.routes.js'");
    expect(paymentsRouteSource).not.toContain("router.use('/:environment'");
  });

  it('mounts Razorpay environment-scoped config routes under the Razorpay admin guard', () => {
    const adminGuardIndex = razorpayRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(razorpayRouteSource).toContain(
      'const environmentRouter = Router({ mergeParams: true });'
    );
    expect(
      razorpayRouteSource.indexOf('environmentRouter.use(razorpayConfigRouter)')
    ).toBeGreaterThan(adminGuardIndex);
    expect(razorpayRouteSource).toContain("router.use('/:environment', environmentRouter)");
    expect(razorpayRouteSource).toContain("from './config.routes.js'");
    expect(razorpayRouteSource).not.toContain("router.put('/:environment/config'");
    expect(razorpayRouteSource).not.toContain('paymentEnvironmentSchema');
  });

  it('mounts Razorpay admin reads under provider-specific services', () => {
    const adminGuardIndex = razorpayRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(
      razorpayRouteSource.indexOf("environmentRouter.use('/catalog', razorpayCatalogRouter)")
    ).toBeGreaterThan(adminGuardIndex);
    expect(razorpayRouteSource.indexOf("'/customers'")).toBeGreaterThan(adminGuardIndex);
    expect(razorpayRouteSource.indexOf("'/transactions'")).toBeGreaterThan(adminGuardIndex);
    expect(
      razorpayRouteSource.match(/environmentRouter\.get\(\s*'\/subscriptions'/)?.index
    ).toBeGreaterThan(adminGuardIndex);
    expect(razorpayCatalogRouteSource).toContain('RazorpayCatalogService');
    expect(razorpayRouteSource).toContain('RazorpaySubscriptionService');
    expect(razorpayRouteSource).toContain('PaymentTransactionService');
    expect(razorpayRouteSource).not.toContain('ProjectionService');
    expect(razorpayCatalogRouteSource).toMatch(/catalogService\.listCatalog\(environment\)/);
    expect(razorpayCatalogRouteSource).toMatch(/router\.post\(\s*'\/items'/);
    expect(razorpayCatalogRouteSource).toMatch(/router\.patch\(\s*'\/items\/:itemId'/);
    expect(razorpayCatalogRouteSource).toMatch(/router\.post\(\s*'\/plans'/);
    expect(razorpayRouteSource).toMatch(
      /customerService\.listCustomers\(\{ environment, \.\.\.query \},\s*'razorpay'\)/
    );
    expect(razorpayRouteSource).toMatch(
      /transactionService\.listTransactions\(\s*\{[\s\S]*environment,[\s\S]*\.\.\.query,[\s\S]*\},\s*'razorpay'/
    );
    expect(razorpayRouteSource).toMatch(
      /subscriptionService\.listSubscriptions\(\{ environment, \.\.\.query \}\)/
    );
  });

  it('mounts Razorpay native checkout flows under user auth before admin routes', () => {
    const adminGuardIndex = razorpayRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);

    for (const route of [
      "'/orders'",
      "'/orders/verify'",
      "'/subscriptions'",
      "'/subscriptions/verify'",
      "'/subscriptions/:subscriptionId/cancel'",
      "'/subscriptions/:subscriptionId/pause'",
      "'/subscriptions/:subscriptionId/resume'",
    ]) {
      expect(razorpayRouteSource.indexOf(route)).toBeGreaterThan(-1);
      expect(razorpayRouteSource.indexOf(route)).toBeLessThan(adminGuardIndex);
    }

    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/orders'[\s\S]*verifyUser[\s\S]*createRazorpayOrderBodySchema/
    );
    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/orders\/verify'[\s\S]*verifyUser[\s\S]*verifyRazorpayOrderBodySchema/
    );
    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/subscriptions'[\s\S]*verifyUser[\s\S]*createRazorpaySubscriptionBodySchema/
    );
    expect(razorpayRouteSource).toMatch(
      /subscriptionService\.createSubscription\(\s*\{[\s\S]*environment,[\s\S]*\.\.\.body,[\s\S]*\},\s*req\.user\s*\)/
    );
    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/subscriptions\/verify'[\s\S]*verifyUser[\s\S]*verifyRazorpaySubscriptionBodySchema/
    );
    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/subscriptions\/:subscriptionId\/cancel'[\s\S]*verifyUser[\s\S]*cancelRazorpaySubscriptionBodySchema/
    );
    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/subscriptions\/:subscriptionId\/pause'[\s\S]*verifyUser[\s\S]*pauseRazorpaySubscriptionBodySchema/
    );
    expect(razorpayRouteSource).toMatch(
      /environmentRouter\.post\(\s*'\/subscriptions\/:subscriptionId\/resume'[\s\S]*verifyUser[\s\S]*resumeRazorpaySubscriptionBodySchema/
    );
    expect(razorpayRouteSource).toContain('RazorpayOrderService');
    expect(razorpayRouteSource).not.toContain('checkout-sessions');
    expect(razorpayRouteSource).not.toContain('payment-links');
  });

  it('keeps Razorpay route validation schemas in shared-schemas', () => {
    expect(paymentsApiSchemaSource).toContain('razorpayEnvironmentParamsSchema');
    expect(paymentsApiSchemaSource).toContain('razorpayWebhookParamsSchema');
    expect(paymentsApiSchemaSource).toContain('upsertRazorpayConfigBodySchema');
    expect(paymentsApiSchemaSource).toContain('getRazorpayWebhookSetupResponseSchema');
    expect(paymentsApiSchemaSource).toContain('regenerateRazorpayWebhookSecretResponseSchema');
    expect(paymentsApiSchemaSource).toContain('getRazorpayStatusResponseSchema');
    expect(paymentsApiSchemaSource).toContain('getRazorpayConfigResponseSchema');
    expect(paymentsApiSchemaSource).toContain('syncRazorpayPaymentsResponseSchema');
    expect(paymentsApiSchemaSource).toContain('createRazorpayOrderBodySchema');
    expect(paymentsApiSchemaSource).toContain('verifyRazorpayOrderBodySchema');
    expect(paymentsApiSchemaSource).toContain('createRazorpaySubscriptionBodySchema');
    expect(paymentsApiSchemaSource).toContain('verifyRazorpaySubscriptionBodySchema');
    expect(paymentsApiSchemaSource).toContain('cancelRazorpaySubscriptionBodySchema');
    expect(paymentsApiSchemaSource).toContain('pauseRazorpaySubscriptionBodySchema');
    expect(paymentsApiSchemaSource).toContain('resumeRazorpaySubscriptionBodySchema');
    expect(paymentsApiSchemaSource).toContain('createRazorpayItemBodySchema');
    expect(paymentsApiSchemaSource).toContain('createRazorpayPlanBodySchema');
    expect(razorpayConfigRouteSource).toContain('parseZodSchema');
    expect(razorpayConfigRouteSource).toContain('upsertRazorpayConfigBodySchema');
    expect(razorpayRouteSource).toContain('createRazorpayOrderBodySchema');
    expect(razorpayCatalogRouteSource).toContain('createRazorpayItemBodySchema');
    expect(razorpayCatalogRouteSource).toContain('createRazorpayPlanBodySchema');
    expect(razorpayConfigRouteSource).not.toContain("from 'zod'");
    expect(razorpayConfigRouteSource).not.toContain('paymentEnvironmentSchema');
    expect(razorpayConfigRouteSource).not.toContain('function getEnvironment');
  });

  it('keeps environment-scoped config, catalog, and admin reads behind the environment admin guard', () => {
    const adminGuardIndex = stripeRouteSource.indexOf('environmentRouter.use(verifyAdmin)');
    expect(adminGuardIndex).toBeGreaterThan(-1);
    expect(stripeRouteSource.indexOf('environmentRouter.use(stripeConfigRouter)')).toBeGreaterThan(
      adminGuardIndex
    );
    expect(
      stripeRouteSource.indexOf("environmentRouter.use('/catalog', stripeCatalogRouter)")
    ).toBeGreaterThan(adminGuardIndex);
    expect(stripeRouteSource.indexOf("'/transactions'")).toBeGreaterThan(adminGuardIndex);
    expect(stripeRouteSource.indexOf("'/subscriptions'")).toBeGreaterThan(adminGuardIndex);
    expect(stripeRouteSource.indexOf("'/customers'")).toBeGreaterThan(adminGuardIndex);
    expect(stripeRouteSource).toMatch(
      /environmentRouter\.get\(\s*'\/customers'[\s\S]*listPaymentCustomersQuerySchema[\s\S]*listCustomers/
    );
  });

  it('keeps environment-scoped config routes in the dedicated Stripe config router', () => {
    expect(stripeConfigRouteSource).toContain('const router = Router({ mergeParams: true });');
    expect(stripeConfigRouteSource).toMatch(
      /router\.put\(\s*'\/config'[\s\S]*upsertStripeConfigBodySchema/
    );
    expect(stripeConfigRouteSource).toMatch(/router\.delete\(\s*'\/config'/);
    expect(stripeConfigRouteSource).toMatch(/router\.post\(\s*'\/sync'/);
    expect(stripeConfigRouteSource).toMatch(/router\.post\(\s*'\/webhook'/);
    expect(stripeConfigRouteSource).toMatch(/export \{ router as stripeConfigRouter \}/);
    expect(stripeConfigRouteSource).not.toMatch(/router\.get\(\s*'\/status'/);
    expect(stripeConfigRouteSource).not.toMatch(/router\.get\(\s*'\/config'/);
  });

  it('uses the shared payments helper for environment path params', () => {
    expect(paymentHelpersSource).toContain('getPaymentEnvironment');
    expect(paymentHelpersSource).toContain('paymentEnvironmentParamsSchema');
    expect(paymentHelpersSource).toContain('ERROR_CODES.INVALID_INPUT');
    expect(stripeRouteSource).toContain("from '@/services/payments/helpers.js'");
    expect(stripeConfigRouteSource).toContain("from '@/services/payments/helpers.js'");
    expect(stripeCatalogRouteSource).toContain("from '@/services/payments/helpers.js'");
    expect(razorpayRouteSource).toContain("from '@/services/payments/helpers.js'");
    expect(razorpayCatalogRouteSource).toContain("from '@/services/payments/helpers.js'");
    expect(stripeRouteSource).not.toContain('function getEnvironment');
    expect(stripeConfigRouteSource).not.toContain('function getEnvironment');
    expect(stripeCatalogRouteSource).not.toContain('function getEnvironment');
    expect(razorpayRouteSource).not.toContain('function getEnvironment');
    expect(razorpayCatalogRouteSource).not.toContain('function getEnvironment');
    expect(stripeRouteSource).not.toContain("from './route-params.js'");
    expect(stripeConfigRouteSource).not.toContain("from './route-params.js'");
    expect(stripeCatalogRouteSource).not.toContain("from './route-params.js'");
  });

  it('keeps products and prices consolidated in the Stripe catalog router', () => {
    expect(stripeCatalogRouteSource).toMatch(
      /router\.get\(\s*'\/'[\s\S]*productService\.listProducts[\s\S]*priceService\.listPrices/
    );
    expect(stripeCatalogRouteSource).toMatch(/router\.get\(\s*'\/products'/);
    expect(stripeCatalogRouteSource).toMatch(/router\.get\(\s*'\/prices'/);
    expect(stripeCatalogRouteSource).toMatch(
      /router\.post\(\s*'\/products'[\s\S]*createStripeProductBodySchema/
    );
    expect(stripeCatalogRouteSource).toMatch(
      /router\.post\(\s*'\/prices'[\s\S]*createStripePriceBodySchema/
    );
    expect(stripeCatalogRouteSource).toMatch(/export \{ router as stripeCatalogRouter \}/);
    expect(stripeCatalogRouteSource).not.toContain('products.routes');
    expect(stripeCatalogRouteSource).not.toContain('prices.routes');
  });

  it('keeps Razorpay admin webhook setup aligned with the Stripe admin route shape', () => {
    expect(razorpayConfigRouteSource).toContain('const router = Router({ mergeParams: true });');
    expect(razorpayConfigRouteSource).toMatch(/router\.put\(\s*'\/config'/);
    expect(razorpayConfigRouteSource).toMatch(/router\.delete\(\s*'\/config'/);
    expect(razorpayConfigRouteSource).toMatch(/router\.post\(\s*'\/sync'/);
    expect(razorpayConfigRouteSource).toMatch(/router\.get\(\s*'\/webhook'/);
    expect(razorpayConfigRouteSource).toContain('configService.getWebhookSetup(environment)');
    expect(razorpayConfigRouteSource).toMatch(/router\.post\(\s*'\/webhook\/regenerate-secret'/);
    expect(razorpayConfigRouteSource).toContain(
      'configService.regenerateWebhookSecret(environment)'
    );
    expect(razorpayConfigRouteSource).not.toMatch(/router\.post\(\s*'\/webhook'/);
    expect(razorpayConfigRouteSource).toContain('successResponse(res, result)');
    expect(razorpayRouteSource).not.toContain('webhook-configure');
    expect(razorpayConfigRouteSource).not.toContain('webhook-configure');
    expect(razorpayConfigRouteSource).not.toContain('/webhook-secret');
    expect(razorpayConfigRouteSource).not.toContain('verifyAdmin');
    expect(razorpayRouteSource).not.toContain('x-razorpay-signature');
    expect(razorpayRouteSource).not.toContain('verifyWebhookSignature');
    expect(razorpayConfigRouteSource).toMatch(/export \{ router as razorpayConfigRouter \}/);
  });

  it('keeps Razorpay sync aligned with Stripe provider-level sync shape', () => {
    expect(razorpayRouteSource).toMatch(/router\.post\(\s*'\/sync',\s*verifyAdmin/);
    expect(razorpayConfigRouteSource).toMatch(/router\.post\(\s*'\/sync'/);
    expect(razorpayConfigRouteSource).toContain('syncService.syncAll(environment)');
    expect(razorpayConfigRouteSource).toContain('syncService.syncEnvironmentAfterKeyChange');
    expect(razorpayConfigRouteSource).not.toContain("result.status === 'failed'");
    expect(razorpaySyncServiceSource).toContain('withPaymentSessionAdvisoryLock');
    expect(razorpaySyncServiceSource).toContain('payments_razorpay_environment_');
    expect(razorpaySyncServiceSource).toContain('SyncRazorpayPaymentsResponse');
    expect(razorpaySyncServiceSource).not.toContain('syncPromises');
  });

  it('keeps Razorpay webhooks manual rather than half-managed through a provider API', () => {
    expect(razorpayConfigRouteSource).toContain('getWebhookSetup(environment)');
    expect(razorpayConfigRouteSource).toContain('regenerateWebhookSecret(environment)');
    expect(razorpayProviderSource).not.toContain('createWebhook(');
    expect(razorpayProviderSource).not.toContain('/v1/accounts/me/webhooks');
    expect(razorpayConfigServiceSource).toContain('manual');
    expect(razorpayConfigServiceSource).toContain('webhookSecret');
    expect(razorpayConfigServiceSource).not.toContain('manualSetupRequired');
  });

  it('mounts Razorpay inbound webhooks under the dedicated webhook router', () => {
    expect(webhooksRouteSource).toContain("router.use('/stripe', stripeWebhookRouter)");
    expect(webhooksRouteSource).toContain("router.use('/razorpay', razorpayWebhookRouter)");
    expect(razorpayWebhookRouteSource).toMatch(/router\.post\(\s*'\/:environment'/);
    expect(razorpayWebhookRouteSource).toContain('x-razorpay-signature');
    expect(razorpayWebhookRouteSource).toContain('razorpayWebhookParamsSchema');
    expect(razorpayWebhookRouteSource).toContain('handleRazorpayWebhook');
    expect(razorpayWebhookRouteSource).not.toContain('HANDLED_RAZORPAY_EVENTS');
    expect(razorpayWebhookRouteSource).not.toContain('parseRazorpayWebhookPayload');
    expect(razorpayWebhookRouteSource).not.toContain('getRazorpayPayloadEntityId');
    expect(razorpayWebhookRouteSource).not.toContain('isRecord');
    expect(razorpayWebhookRouteSource).not.toContain('RazorpayConfigService');
    expect(razorpayWebhookRouteSource).not.toContain('RazorpaySyncService');
    expect(razorpayWebhookRouteSource).not.toContain('logger');
    expect(razorpayWebhookRouteSource).not.toContain('verifyWebhookSignature');
    expect(razorpayWebhookRouteSource).not.toContain('recordWebhookEventStart');
    expect(razorpayWebhookServiceSource).toContain('HANDLED_RAZORPAY_EVENTS');
    expect(razorpayWebhookServiceSource).toContain('verifyWebhookSignature');
    expect(razorpayWebhookServiceSource).toContain('recordWebhookEventStart');
    expect(razorpayWebhookRouteSource).toMatch(/export \{ router as razorpayWebhookRouter \}/);
  });

  it('accepts only the supported payment environment path params', () => {
    expect(paymentEnvironmentParamsSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(paymentEnvironmentParamsSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(() => paymentEnvironmentParamsSchema.parse({ environment: 'prod' })).toThrow();
  });

  it('accepts Razorpay config and webhook request schemas from shared-schemas', () => {
    expect(razorpayEnvironmentParamsSchema.parse({ environment: 'test' })).toEqual({
      environment: 'test',
    });
    expect(razorpayWebhookParamsSchema.parse({ environment: 'live' })).toEqual({
      environment: 'live',
    });
    expect(() => razorpayEnvironmentParamsSchema.parse({ environment: 'prod' })).toThrow();
    expect(
      upsertRazorpayConfigBodySchema.parse({
        keyId: 'rzp_test_abc',
        keySecret: 'secret',
        webhookSecret: 'webhook_secret',
      })
    ).toEqual({
      keyId: 'rzp_test_abc',
      keySecret: 'secret',
      webhookSecret: 'webhook_secret',
    });
    expect(() =>
      upsertRazorpayConfigBodySchema.parse({ keyId: '', keySecret: 'secret' })
    ).toThrow();
    expect(
      getRazorpayStatusResponseSchema.parse({
        razorpayConnections: [
          {
            environment: 'test',
            status: 'unconfigured',
            accountId: null,
            merchantName: null,
            accountLivemode: null,
            webhookEndpointId: null,
            webhookEndpointUrl: null,
            webhookConfiguredAt: null,
            maskedKey: null,
            lastSyncedAt: null,
            lastSyncStatus: null,
            lastSyncError: null,
            lastSyncCounts: {},
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        razorpayConnections: expect.any(Array),
      })
    );
    expect(
      getRazorpayConfigResponseSchema.parse({
        razorpayKeys: [
          {
            environment: 'test',
            keyType: 'api_key',
            value: 'rzp_test_key1234',
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        razorpayKeys: expect.any(Array),
      })
    );
    expect(
      getRazorpayWebhookSetupResponseSchema.parse({
        connection: {
          environment: 'test',
          status: 'connected',
          accountId: 'acc_123',
          merchantName: 'Example Merchant',
          accountLivemode: false,
          webhookEndpointId: 'manual',
          webhookEndpointUrl: 'https://api.example.com/api/webhooks/razorpay/test',
          webhookConfiguredAt: null,
          maskedKey: 'rzp_test_****1234',
          lastSyncedAt: null,
          lastSyncStatus: null,
          lastSyncError: null,
          lastSyncCounts: {},
        },
        webhookUrl: 'https://api.example.com/api/webhooks/razorpay/test',
        webhookSecret: 'manual_secret',
      })
    ).toEqual(
      expect.objectContaining({
        webhookUrl: 'https://api.example.com/api/webhooks/razorpay/test',
        webhookSecret: 'manual_secret',
      })
    );
    expect(
      syncRazorpayPaymentsResponseSchema.parse({
        results: [
          {
            environment: 'test',
            status: 'failed',
            connection: {
              environment: 'test',
              status: 'unconfigured',
              accountId: null,
              merchantName: null,
              accountLivemode: null,
              webhookEndpointId: null,
              webhookEndpointUrl: null,
              webhookConfiguredAt: null,
              maskedKey: null,
              lastSyncedAt: null,
              lastSyncStatus: 'failed',
              lastSyncError: 'missing keys',
              lastSyncCounts: {},
            },
            syncCounts: {
              plans: 0,
              items: 0,
              customers: 0,
              subscriptions: 0,
              invoices: 0,
              payments: 0,
            },
            error: 'missing keys',
          },
        ],
      })
    ).toEqual(
      expect.objectContaining({
        results: expect.any(Array),
      })
    );
  });

  it('accepts empty catalog and products query strings for environment-scoped reads', () => {
    expect(listStripeCatalogQuerySchema.parse({})).toEqual({});
    expect(listStripeProductsQuerySchema.parse({})).toEqual({});
    expect(() => listStripeCatalogQuerySchema.parse({ environment: 'test' })).toThrow();
  });

  it('accepts Stripe key configuration bodies without embedding environment in the body', () => {
    expect(
      upsertStripeConfigBodySchema.parse({
        secretKey: FAKE_LIVE_SECRET_KEY,
      })
    ).toEqual({
      secretKey: FAKE_LIVE_SECRET_KEY,
    });
    expect(() => upsertStripeConfigBodySchema.parse({ secretKey: '' })).toThrow();
    expect(() =>
      upsertStripeConfigBodySchema.parse({
        environment: 'live',
        secretKey: FAKE_LIVE_SECRET_KEY,
      })
    ).toThrow();
  });

  it('accepts product CRUD bodies without embedding environment in the body', () => {
    expect(
      createStripeProductBodySchema.parse({
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
      createStripeProductBodySchema.parse({ name: 'Pro', environment: 'test' })
    ).toThrow();
    expect(() =>
      createStripeProductBodySchema.parse({
        name: 'Pro',
        idempotencyKey: 'x'.repeat(201),
      })
    ).toThrow(/200 characters/i);
    expect(() => updateStripeProductBodySchema.parse({})).toThrow();
    expect(updateStripeProductBodySchema.parse({ active: false })).toEqual({
      active: false,
    });
    expect(() => updateStripeProductBodySchema.parse({ environment: 'live' })).toThrow();
  });

  it('accepts price CRUD bodies and query filters without embedding environment in the body', () => {
    expect(listStripePricesQuerySchema.parse({ productId: 'prod_123' })).toEqual({
      productId: 'prod_123',
    });
    expect(
      createStripePriceBodySchema.parse({
        productId: 'prod_123',
        currency: 'USD',
        unitAmount: 2000,
        recurring: { interval: 'month', intervalCount: 1 },
        idempotencyKey: 'agent-price-123',
      })
    ).toEqual({
      productId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      recurring: { interval: 'month', intervalCount: 1 },
      idempotencyKey: 'agent-price-123',
    });
    expect(() =>
      createStripePriceBodySchema.parse({
        productId: 'prod_123',
        currency: 'usd',
        unitAmount: 2000,
        environment: 'test',
      })
    ).toThrow();
    expect(() => updateStripePriceBodySchema.parse({})).toThrow();
    expect(updateStripePriceBodySchema.parse({ active: false })).toEqual({ active: false });
    expect(() => updateStripePriceBodySchema.parse({ environment: 'live' })).toThrow();
  });

  it('accepts Razorpay native order and subscription checkout bodies', () => {
    expect(
      createRazorpayOrderBodySchema.parse({
        amount: 50000,
        currency: 'inr',
        receipt: 'order_123',
        subject: { type: 'team', id: 'team_123' },
        customerEmail: 'buyer@example.com',
      })
    ).toEqual({
      amount: 50000,
      currency: 'INR',
      receipt: 'order_123',
      subject: { type: 'team', id: 'team_123' },
      customerEmail: 'buyer@example.com',
    });

    expect(
      verifyRazorpayOrderBodySchema.parse({
        orderId: 'order_123',
        paymentId: 'pay_123',
        signature: 'signature',
      })
    ).toEqual({
      orderId: 'order_123',
      paymentId: 'pay_123',
      signature: 'signature',
    });

    expect(
      createRazorpaySubscriptionBodySchema.parse({
        planId: 'plan_123',
        totalCount: 12,
        subject: { type: 'team', id: 'team_123' },
        customerContact: '+919999999999',
      })
    ).toEqual({
      planId: 'plan_123',
      totalCount: 12,
      subject: { type: 'team', id: 'team_123' },
      customerContact: '+919999999999',
    });

    expect(() =>
      createRazorpaySubscriptionBodySchema.parse({
        planId: 'plan_123',
        subject: { type: 'team', id: 'team_123' },
      })
    ).toThrow(/totalCount or endAt/i);

    expect(
      verifyRazorpaySubscriptionBodySchema.parse({
        subscriptionId: 'sub_123',
        paymentId: 'pay_123',
        signature: 'signature',
      })
    ).toEqual({
      subscriptionId: 'sub_123',
      paymentId: 'pay_123',
      signature: 'signature',
    });

    expect(cancelRazorpaySubscriptionBodySchema.parse({})).toEqual({
      cancelAtCycleEnd: false,
    });
    expect(cancelRazorpaySubscriptionBodySchema.parse({ cancelAtCycleEnd: true })).toEqual({
      cancelAtCycleEnd: true,
    });
    expect(pauseRazorpaySubscriptionBodySchema.parse({})).toEqual({});
    expect(resumeRazorpaySubscriptionBodySchema.parse({})).toEqual({});
    expect(() => pauseRazorpaySubscriptionBodySchema.parse({ planId: 'plan_456' })).toThrow();
    expect(
      razorpaySubscriptionParamsSchema.parse({
        environment: 'test',
        subscriptionId: 'sub_123',
      })
    ).toEqual({
      environment: 'test',
      subscriptionId: 'sub_123',
    });
  });

  it('accepts Razorpay item and plan mutation bodies without pretending plans are editable', () => {
    expect(
      createRazorpayItemBodySchema.parse({
        name: 'Invoice item',
        amount: 25000,
        currency: 'inr',
      })
    ).toEqual({
      name: 'Invoice item',
      amount: 25000,
      currency: 'INR',
    });

    expect(updateRazorpayItemBodySchema.parse({ active: false })).toEqual({ active: false });
    expect(() => updateRazorpayItemBodySchema.parse({})).toThrow();

    expect(
      createRazorpayPlanBodySchema.parse({
        period: 'monthly',
        interval: 1,
        item: {
          name: 'Pro monthly',
          amount: 199900,
          currency: 'inr',
        },
        notes: { tier: 'pro' },
      })
    ).toEqual({
      period: 'monthly',
      interval: 1,
      item: {
        name: 'Pro monthly',
        amount: 199900,
        currency: 'INR',
      },
      notes: { tier: 'pro' },
    });

    expect(razorpayCatalogRouteSource).not.toMatch(/router\.patch\(\s*'\/plans/);
    expect(razorpayCatalogRouteSource).not.toMatch(/router\.delete\(\s*'\/plans/);
  });

  it('rejects caller-provided InsForge-reserved Razorpay notes', () => {
    expect(() =>
      createRazorpayOrderBodySchema.parse({
        amount: 50000,
        currency: 'INR',
        notes: {
          insforge_subject_type: 'team',
        },
      })
    ).toThrow(/reserved/i);

    expect(() =>
      createRazorpayPlanBodySchema.parse({
        period: 'monthly',
        interval: 1,
        item: {
          name: 'Pro monthly',
          amount: 199900,
          currency: 'INR',
        },
        notes: {
          insforge_subject_id: 'team_123',
        },
      })
    ).toThrow(/reserved/i);
  });

  it('allows anonymous one-time checkout sessions without embedding environment in the body', () => {
    expect(
      createCheckoutSessionBodySchema.parse({
        mode: 'payment',
        lineItems: [{ priceId: 'price_123', quantity: 2 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'buyer@example.com',
        idempotencyKey: 'checkout-123',
      })
    ).toEqual({
      mode: 'payment',
      lineItems: [{ priceId: 'price_123', quantity: 2 }],
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
        lineItems: [{ priceId: 'price_123' }],
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
        lineItems: [{ priceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      })
    ).toThrow(/billing subject/i);

    expect(
      createCheckoutSessionBodySchema.parse({
        mode: 'subscription',
        lineItems: [{ priceId: 'price_123' }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        subject: { type: 'team', id: 'team_123' },
      })
    ).toEqual({
      mode: 'subscription',
      lineItems: [{ priceId: 'price_123', quantity: 1 }],
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
    expect(listPaymentTransactionsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      listStripeSubscriptionsQuerySchema.parse({
        subjectType: 'organization',
        subjectId: 'org_123',
        limit: '25',
      })
    ).toEqual({
      subjectType: 'organization',
      subjectId: 'org_123',
      limit: 25,
    });
    expect(
      listRazorpaySubscriptionsQuerySchema.parse({
        subjectType: 'organization',
        subjectId: 'org_123',
        limit: '25',
      })
    ).toEqual({
      subjectType: 'organization',
      subjectId: 'org_123',
      limit: 25,
    });

    expect(() => listPaymentTransactionsQuerySchema.parse({ environment: 'live' })).toThrow();
    expect(() => listStripeSubscriptionsQuerySchema.parse({ subjectType: 'team' })).toThrow(
      /provided together/i
    );
    expect(() => listRazorpaySubscriptionsQuerySchema.parse({ subjectType: 'team' })).toThrow(
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
