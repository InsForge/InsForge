import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  StripeAccount,
  StripeCharge,
  StripeInvoice,
  StripePaymentIntent,
  StripePrice,
  StripeProduct,
  StripeSubscription,
} from '../../src/types/payments';

const { mockPool, mockProvider, mockGetSecretByKey, mockEncrypt, mockLogger } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockProvider: {
    retrieveAccount: vi.fn(),
    syncCatalog: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    createPrice: vi.fn(),
    updatePrice: vi.fn(),
    createCustomer: vi.fn(),
    createCustomerPortalSession: vi.fn(),
    createCheckoutSession: vi.fn(),
    constructWebhookEvent: vi.fn(),
    listWebhookEndpoints: vi.fn(),
    createWebhookEndpoint: vi.fn(),
    deleteWebhookEndpoint: vi.fn(),
    listSubscriptions: vi.fn(),
    listSubscriptionItems: vi.fn(),
    retrievePaymentIntent: vi.fn(),
    retrieveCharge: vi.fn(),
    retrieveInvoiceByPaymentIntent: vi.fn(),
  },
  mockGetSecretByKey: vi.fn(),
  mockEncrypt: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/providers/payments/stripe.provider', () => ({
  StripeProvider: vi.fn(() => mockProvider),
  maskStripeKey: (apiKey: string) => `masked:${apiKey.slice(-4)}`,
  validateStripeSecretKey: (environment: 'test' | 'live', value: string) => {
    const prefix = environment === 'test' ? 'sk_test_' : 'sk_live_';
    if (!value.startsWith(prefix)) {
      throw new Error(`STRIPE_${environment.toUpperCase()}_SECRET_KEY must start with ${prefix}`);
    }
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => ({
      getSecretByKey: mockGetSecretByKey,
    }),
  },
}));

vi.mock('../../src/infra/security/encryption.manager', () => ({
  EncryptionManager: {
    encrypt: mockEncrypt,
  },
}));

vi.mock('../../src/utils/logger', () => ({ default: mockLogger }));

import { PaymentService } from '../../src/services/payments/payment.service';

describe('PaymentService', () => {
  const connectedTestConnectionRow = {
    environment: 'test',
    status: 'connected',
    stripeAccountId: 'acct_123',
    stripeAccountEmail: 'owner@example.com',
    accountLivemode: false,
    webhookEndpointId: 'we_123',
    webhookEndpointUrl: 'http://localhost:7130/api/webhooks/stripe/test',
    webhookConfiguredAt: new Date('2026-04-27T00:00:00.000Z'),
    lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
    lastSyncStatus: 'succeeded',
    lastSyncError: null,
    lastSyncCounts: { products: 1, prices: 1 },
  };
  const checkoutUser = {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'buyer@example.com',
    role: 'authenticated' as const,
  };
  const anonCheckoutUser = {
    id: '12345678-1234-5678-90ab-cdef12345678',
    email: 'anon@insforge.com',
    role: 'anon' as const,
  };
  const checkoutSessionRow = {
    id: '2a22bd54-2e90-4d33-94bd-e1fb59dfb111',
    environment: 'test',
    mode: 'subscription',
    status: 'open',
    paymentStatus: 'unpaid',
    subjectType: 'team',
    subjectId: 'team_123',
    customerEmail: 'buyer@example.com',
    stripeCheckoutSessionId: 'cs_test_123',
    stripeCustomerId: 'cus_123',
    stripePaymentIntentId: null,
    stripeSubscriptionId: null,
    url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    lastError: null,
    createdAt: new Date('2026-04-28T00:00:00.000Z'),
    updatedAt: new Date('2026-04-28T00:00:00.000Z'),
  };
  const customerPortalSessionRow = {
    id: '5d0d37dc-6304-4be5-8424-0a3de87d01d8',
    environment: 'test',
    status: 'initialized',
    subjectType: 'team',
    subjectId: 'team_123',
    stripeCustomerId: null,
    returnUrl: 'https://example.com/account',
    configuration: 'bpc_123',
    url: null,
    lastError: null,
    createdAt: new Date('2026-04-29T00:00:00.000Z'),
    updatedAt: new Date('2026-04-29T00:00:00.000Z'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    mockGetSecretByKey.mockResolvedValue('sk_test_1234567890');
    mockEncrypt.mockReturnValue('encrypted-secret');
    mockPool.query.mockResolvedValue({ rowCount: 1, rows: [] });
    mockPool.connect.mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    });
    mockProvider.retrieveAccount.mockResolvedValue({
      id: 'acct_123',
      object: 'account',
      email: 'owner@example.com',
      charges_enabled: true,
      details_submitted: true,
    } as unknown as StripeAccount);
    mockProvider.createProduct.mockResolvedValue({
      id: 'prod_new',
      object: 'product',
      name: 'New Product',
      active: true,
      description: null,
      default_price: null,
      metadata: {},
    } as unknown as StripeProduct);
    mockProvider.updateProduct.mockResolvedValue({
      id: 'prod_123',
      object: 'product',
      name: 'Updated Product',
      active: false,
      description: 'Updated description',
      default_price: null,
      metadata: { tier: 'updated' },
    } as unknown as StripeProduct);
    mockProvider.deleteProduct.mockResolvedValue({
      id: 'prod_123',
      deleted: true,
    });
    mockProvider.createPrice.mockResolvedValue({
      id: 'price_new',
      object: 'price',
      product: 'prod_123',
      active: true,
      currency: 'usd',
      unit_amount: 2000,
      unit_amount_decimal: null,
      type: 'recurring',
      lookup_key: 'pro_monthly',
      billing_scheme: 'per_unit',
      tax_behavior: 'exclusive',
      recurring: { interval: 'month', interval_count: 1 },
      metadata: {},
    } as unknown as StripePrice);
    mockProvider.updatePrice.mockResolvedValue({
      id: 'price_123',
      object: 'price',
      product: 'prod_123',
      active: false,
      currency: 'usd',
      unit_amount: 1000,
      unit_amount_decimal: null,
      type: 'recurring',
      lookup_key: 'pro_monthly',
      billing_scheme: 'per_unit',
      tax_behavior: 'exclusive',
      recurring: { interval: 'month', interval_count: 1 },
      metadata: { archived: 'true' },
    } as unknown as StripePrice);
    mockProvider.createCustomer.mockResolvedValue({
      id: 'cus_123',
      object: 'customer',
      email: 'buyer@example.com',
      metadata: { insforge_subject_type: 'team', insforge_subject_id: 'team_123' },
    });
    mockProvider.createCustomerPortalSession.mockResolvedValue({
      id: 'bps_123',
      object: 'billing_portal.session',
      customer: 'cus_123',
      return_url: 'https://example.com/account',
      url: 'https://billing.stripe.com/p/session/test_123',
    });
    mockProvider.createCheckoutSession.mockResolvedValue({
      id: 'cs_test_123',
      object: 'checkout.session',
      mode: 'payment',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      status: 'open',
      payment_status: 'unpaid',
      customer: 'cus_123',
      payment_intent: null,
      subscription: null,
    });
    mockProvider.listWebhookEndpoints.mockResolvedValue([]);
    mockProvider.createWebhookEndpoint.mockResolvedValue({
      id: 'we_new',
      object: 'webhook_endpoint',
      url: 'http://localhost:7130/api/webhooks/stripe/test',
      secret: 'whsec_new',
    });
    mockProvider.listSubscriptions.mockResolvedValue([]);
    mockProvider.listSubscriptionItems.mockResolvedValue([]);
    mockProvider.retrievePaymentIntent.mockResolvedValue({
      id: 'pi_123',
      object: 'payment_intent',
      status: 'succeeded',
      customer: 'cus_123',
      latest_charge: 'ch_123',
      amount: 5000,
      amount_received: 5000,
      currency: 'usd',
      description: null,
      receipt_email: 'buyer@example.com',
      created: 1777334400,
      metadata: {},
    } as unknown as StripePaymentIntent);
    mockProvider.retrieveCharge.mockResolvedValue({
      id: 'ch_123',
      object: 'charge',
      customer: 'cus_123',
      payment_intent: 'pi_123',
      amount_refunded: 0,
      refunded: false,
      refunds: { data: [] },
      billing_details: { email: 'buyer@example.com' },
      description: null,
      metadata: {},
    } as unknown as StripeCharge);
    mockProvider.retrieveInvoiceByPaymentIntent.mockResolvedValue(null as StripeInvoice | null);
    mockProvider.syncCatalog.mockResolvedValue({
      account: {
        id: 'acct_123',
        object: 'account',
        email: 'owner@example.com',
        charges_enabled: true,
        details_submitted: true,
      } as unknown as StripeAccount,
      products: [
        {
          id: 'prod_123',
          object: 'product',
          name: 'Pro',
          active: true,
          metadata: {},
        },
      ] as unknown as StripeProduct[],
      prices: [
        {
          id: 'price_123',
          object: 'price',
          product: 'prod_123',
          active: true,
          currency: 'usd',
          type: 'recurring',
          lookup_key: 'pro_monthly_usd',
          recurring: { interval: 'month', interval_count: 1 },
          metadata: {},
        },
      ] as unknown as StripePrice[],
    });
  });

  it('reports Stripe key configuration from the secret store', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('sk_test_secret1234')
      .mockResolvedValueOnce('sk_live_secret5678');

    await expect(PaymentService.getInstance().getConfig()).resolves.toEqual({
      keys: [
        {
          environment: 'test',
          hasKey: true,
          maskedKey: 'masked:1234',
        },
        {
          environment: 'live',
          hasKey: true,
          maskedKey: 'masked:5678',
        },
      ],
    });

    expect(mockGetSecretByKey).toHaveBeenCalledWith('STRIPE_TEST_SECRET_KEY');
    expect(mockGetSecretByKey).toHaveBeenCalledWith('STRIPE_LIVE_SECRET_KEY');
  });

  it('upserts encrypted Stripe keys into the canonical secret names and syncs payments immediately', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockGetSecretByKey.mockResolvedValue(null);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_123' }],
      })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] });

    await PaymentService.getInstance().setStripeSecretKey('test', ' sk_test_newsecret1234 ');

    expect(mockProvider.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(mockEncrypt).toHaveBeenCalledWith('sk_test_newsecret1234');
    expect(mockProvider.listWebhookEndpoints).toHaveBeenCalledTimes(1);
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledWith({
      url: 'http://localhost:7130/api/webhooks/stripe/test',
      enabledEvents: [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
        'checkout.session.expired',
        'invoice.paid',
        'invoice.payment_failed',
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'charge.refunded',
        'refund.created',
        'refund.updated',
        'refund.failed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
        'customer.subscription.paused',
        'customer.subscription.resumed',
      ],
      metadata: {
        managed_by: 'insforge',
        insforge_webhook: 'stripe_payments',
        insforge_environment: 'test',
        insforge_endpoint_path: '/api/webhooks/stripe/test',
        insforge_endpoint_url: 'http://localhost:7130/api/webhooks/stripe/test',
      },
    });
    expect(mockEncrypt).toHaveBeenCalledWith('whsec_new');
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_SECRET_KEY',
      'encrypted-secret',
    ]);
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_WEBHOOK_SECRET',
      'encrypted-secret',
    ]);
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.subscription_items WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.subscriptions WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.products WHERE environment = $1',
      ['test']
    );
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
    expect(mockProvider.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('saves Stripe keys even when managed webhook setup fails', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockGetSecretByKey.mockResolvedValue(null);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_123' }],
      })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] });
    mockProvider.createWebhookEndpoint.mockRejectedValueOnce(
      new Error(
        'Invalid URL: URL must be publicly accessible. Consider using a tool like the Stripe CLI to test webhooks locally.'
      )
    );

    await expect(
      PaymentService.getInstance().setStripeSecretKey('test', 'sk_test_newsecret1234')
    ).resolves.toBeUndefined();

    expect(mockProvider.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_SECRET_KEY',
      'encrypted-secret',
    ]);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE system\.secrets/i),
      ['STRIPE_TEST_WEBHOOK_SECRET']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.stripe_connections/i),
      [
        'test',
        'acct_123',
        'owner@example.com',
        false,
        null,
        null,
        expect.objectContaining({ id: 'acct_123' }),
        false,
      ]
    );
    expect(mockEncrypt).not.toHaveBeenCalledWith('whsec_new');
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
    expect(mockProvider.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('recreates existing InsForge-managed Stripe webhooks even when the stored endpoint URL is stale', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockGetSecretByKey.mockResolvedValue(null);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_123' }],
    });
    mockProvider.listWebhookEndpoints.mockResolvedValueOnce([
      {
        id: 'we_old',
        object: 'webhook_endpoint',
        url: 'https://old.example.com/api/webhooks/stripe/test',
        metadata: {
          managed_by: 'insforge',
          insforge_webhook: 'stripe_payments',
          insforge_environment: 'test',
        },
      },
      {
        id: 'we_live',
        object: 'webhook_endpoint',
        url: 'https://old.example.com/api/webhooks/stripe/live',
        metadata: {
          managed_by: 'insforge',
          insforge_webhook: 'stripe_payments',
          insforge_environment: 'live',
        },
      },
      {
        id: 'we_developer',
        object: 'webhook_endpoint',
        metadata: { managed_by: 'developer' },
      },
    ]);

    await PaymentService.getInstance().setStripeSecretKey('test', 'sk_test_newsecret1234');

    expect(mockProvider.deleteWebhookEndpoint).toHaveBeenCalledWith('we_old');
    expect(mockProvider.deleteWebhookEndpoint).not.toHaveBeenCalledWith('we_live');
    expect(mockProvider.deleteWebhookEndpoint).not.toHaveBeenCalledWith('we_developer');
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledTimes(1);
  });

  it('skips webhook recreation and sync when saving the same Stripe key', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_123' }],
    });

    await PaymentService.getInstance().setStripeSecretKey('test', ' sk_test_1234567890 ');

    expect(mockProvider.retrieveAccount).not.toHaveBeenCalled();
    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(mockProvider.listWebhookEndpoints).not.toHaveBeenCalled();
    expect(mockProvider.createWebhookEndpoint).not.toHaveBeenCalled();
    expect(mockProvider.syncCatalog).not.toHaveBeenCalled();
    expect(mockProvider.listSubscriptions).not.toHaveBeenCalled();
  });

  it('configures managed Stripe webhooks on demand using the stored key', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/RETURNING\s+environment/i.test(sql)) {
          return Promise.resolve({
            rows: [
              {
                ...connectedTestConnectionRow,
                webhookEndpointId: 'we_new',
                webhookEndpointUrl: 'http://localhost:7130/api/webhooks/stripe/test',
                webhookConfiguredAt: new Date('2026-04-28T00:00:00.000Z'),
              },
            ],
          });
        }

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_123' }],
    });

    const result = await PaymentService.getInstance().configureWebhook('test');

    expect(mockProvider.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(mockProvider.listWebhookEndpoints).toHaveBeenCalledTimes(1);
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledTimes(1);
    expect(mockProvider.syncCatalog).not.toHaveBeenCalled();
    expect(mockProvider.listSubscriptions).not.toHaveBeenCalled();
    expect(mockEncrypt).toHaveBeenCalledWith('whsec_new');
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_WEBHOOK_SECRET',
      'encrypted-secret',
    ]);
    expect(result.connection.webhookEndpointId).toBe('we_new');
    expect(result.connection.webhookConfiguredAt).toBe('2026-04-28T00:00:00.000Z');
  });

  it('clears the payment mirror when on-demand webhook configuration finds another Stripe account', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/RETURNING\s+environment/i.test(sql)) {
          return Promise.resolve({
            rows: [
              {
                ...connectedTestConnectionRow,
                stripeAccountId: 'acct_new',
                stripeAccountEmail: 'new-owner@example.com',
                webhookEndpointId: 'we_new',
                webhookEndpointUrl: 'http://localhost:7130/api/webhooks/stripe/test',
                webhookConfiguredAt: new Date('2026-04-28T00:00:00.000Z'),
                lastSyncedAt: null,
                lastSyncStatus: null,
                lastSyncError: null,
                lastSyncCounts: {},
              },
            ],
          });
        }

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_old' }],
    });
    mockProvider.retrieveAccount.mockResolvedValueOnce({
      id: 'acct_new',
      object: 'account',
      email: 'new-owner@example.com',
    } as unknown as StripeAccount);

    const result = await PaymentService.getInstance().configureWebhook('test');

    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.subscription_items WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.subscriptions WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.payment_history WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.checkout_sessions WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.products WHERE environment = $1',
      ['test']
    );
    expect(result.connection.stripeAccountId).toBe('acct_new');
  });

  it('requires a configured Stripe key before configuring managed webhooks', async () => {
    mockGetSecretByKey.mockResolvedValueOnce(null);

    await expect(PaymentService.getInstance().configureWebhook('test')).rejects.toThrow(
      'STRIPE_TEST_SECRET_KEY is not configured'
    );

    expect(mockProvider.retrieveAccount).not.toHaveBeenCalled();
    expect(mockProvider.listWebhookEndpoints).not.toHaveBeenCalled();
    expect(mockProvider.createWebhookEndpoint).not.toHaveBeenCalled();
  });

  it('treats a missing stored Stripe account id as unknown and re-syncs', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: null }],
      })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] });

    await PaymentService.getInstance().setStripeSecretKey('test', 'sk_test_1234567890');

    expect(mockProvider.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledTimes(1);
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.subscription_items WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.subscriptions WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.prices WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.products WHERE environment = $1',
      ['test']
    );
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
    expect(mockProvider.listSubscriptions).toHaveBeenCalledTimes(1);
  });

  it('persists rotated keys without recreating webhooks or syncing when the Stripe account is unchanged', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockGetSecretByKey.mockResolvedValue('sk_test_oldsecret1234');
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_123' }],
    });

    await PaymentService.getInstance().setStripeSecretKey('test', 'sk_test_rotated1234');

    expect(mockProvider.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(mockEncrypt).toHaveBeenCalledWith('sk_test_rotated1234');
    expect(mockProvider.listWebhookEndpoints).not.toHaveBeenCalled();
    expect(mockProvider.createWebhookEndpoint).not.toHaveBeenCalled();
    expect(mockProvider.syncCatalog).not.toHaveBeenCalled();
    expect(mockProvider.listSubscriptions).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_SECRET_KEY',
      'encrypted-secret',
    ]);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.any(String), [
      'STRIPE_TEST_WEBHOOK_SECRET',
    ]);
    expect(mockClient.query).not.toHaveBeenCalledWith(expect.any(String), [
      'STRIPE_TEST_WEBHOOK_SECRET',
      'encrypted-secret',
    ]);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.stripe_connections/i),
      ['test', 'acct_123', 'owner@example.com', false, expect.objectContaining({ id: 'acct_123' })]
    );
  });

  it('clears the environment catalog mirror when a new key points to another Stripe account', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockProvider.retrieveAccount.mockResolvedValueOnce({
      id: 'acct_new',
      object: 'account',
      email: 'new-owner@example.com',
    } as unknown as StripeAccount);
    mockProvider.syncCatalog.mockRejectedValueOnce(new Error('sync failed'));
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_old' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            status: 'error',
            stripeAccountId: 'acct_new',
            stripeAccountEmail: 'new-owner@example.com',
            accountLivemode: false,
            lastSyncedAt: null,
            lastSyncStatus: 'failed',
            lastSyncError: 'sync failed',
            lastSyncCounts: {},
          },
        ],
      });

    await expect(
      PaymentService.getInstance().setStripeSecretKey('test', 'sk_test_newsecret1234')
    ).resolves.toBeUndefined();

    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.subscription_items WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.subscriptions WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.prices WHERE environment = $1',
      ['test']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.products WHERE environment = $1',
      ['test']
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.stripe_connections/i),
      ['test', 'error', 'sync failed']
    );
  });

  it('soft-removes Stripe keys without clearing the mirrored payment data', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(PaymentService.getInstance().removeStripeSecretKey('live')).resolves.toBe(true);

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE system\.secrets/i),
      ['STRIPE_LIVE_SECRET_KEY']
    );
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.subscription_items WHERE environment = $1',
      ['live']
    );
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.subscriptions WHERE environment = $1',
      ['live']
    );
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.prices WHERE environment = $1',
      ['live']
    );
    expect(mockClient.query).not.toHaveBeenCalledWith(
      'DELETE FROM payments.products WHERE environment = $1',
      ['live']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.stripe_connections/i),
      ['live', 'STRIPE_LIVE_SECRET_KEY is not configured']
    );
  });

  it('seeds Stripe keys from environment variables', async () => {
    const originalEnv = { ...process.env };
    process.env.STRIPE_TEST_SECRET_KEY = 'sk_test_seed1234';
    process.env.STRIPE_LIVE_SECRET_KEY = 'sk_live_seed5678';
    mockGetSecretByKey.mockResolvedValue(null);

    try {
      await PaymentService.getInstance().seedStripeKeysFromEnv();
    } finally {
      process.env = originalEnv;
    }

    expect(mockEncrypt).toHaveBeenCalledWith('sk_test_seed1234');
    expect(mockEncrypt).toHaveBeenCalledWith('sk_live_seed5678');
  });

  it('does not overwrite active Stripe keys when seeding from environment variables', async () => {
    const originalEnv = { ...process.env };
    process.env.STRIPE_TEST_SECRET_KEY = 'sk_test_seed1234';
    mockGetSecretByKey.mockResolvedValue('sk_test_existing1234');

    try {
      await PaymentService.getInstance().seedStripeKeysFromEnv();
    } finally {
      process.env = originalEnv;
    }

    expect(mockEncrypt).not.toHaveBeenCalledWith('sk_test_seed1234');
  });

  it('does not seed Stripe webhook secrets from environment variables', async () => {
    const originalEnv = { ...process.env };
    delete process.env.STRIPE_TEST_SECRET_KEY;
    delete process.env.STRIPE_LIVE_SECRET_KEY;
    process.env.STRIPE_TEST_WEBHOOK_SECRET = 'whsec_test_seed1234';
    process.env.STRIPE_LIVE_WEBHOOK_SECRET = 'whsec_live_seed5678';
    mockGetSecretByKey.mockResolvedValue(null);

    try {
      await PaymentService.getInstance().seedStripeKeysFromEnv();
    } finally {
      process.env = originalEnv;
    }

    expect(mockEncrypt).not.toHaveBeenCalledWith('whsec_test_seed1234');
    expect(mockEncrypt).not.toHaveBeenCalledWith('whsec_live_seed5678');
    expect(mockPool.query).not.toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_WEBHOOK_SECRET',
      'encrypted-secret',
    ]);
    expect(mockPool.query).not.toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_LIVE_WEBHOOK_SECRET',
      'encrypted-secret',
    ]);
  });

  it('records an unconfigured status when an environment key is missing', async () => {
    mockGetSecretByKey.mockResolvedValue(null);
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          environment: 'live',
          status: 'unconfigured',
          stripeAccountId: null,
          stripeAccountEmail: null,
          accountLivemode: null,
          lastSyncedAt: null,
          lastSyncStatus: 'failed',
          lastSyncError: 'STRIPE_LIVE_SECRET_KEY is not configured',
          lastSyncCounts: {},
        },
      ],
    });

    const result = await PaymentService.getInstance().syncPayments({ environment: 'live' });

    expect(result.results[0]?.connection.status).toBe('unconfigured');
    expect(result.results[0]?.connection.lastSyncStatus).toBe('failed');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/payments\.stripe_connections/i),
      expect.any(Array)
    );
  });

  it('fetches Stripe products and prices and commits a successful sync', async () => {
    const mockLockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockSyncClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockSubscriptionsClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockPool.connect
      .mockResolvedValueOnce(mockLockClient)
      .mockResolvedValueOnce(mockSyncClient)
      .mockResolvedValueOnce(mockSubscriptionsClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_123' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            status: 'connected',
            stripeAccountId: 'acct_123',
            stripeAccountEmail: 'owner@example.com',
            accountLivemode: false,
            lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
            lastSyncStatus: 'succeeded',
            lastSyncError: null,
            lastSyncCounts: { products: 1, prices: 1 },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            status: 'connected',
            stripeAccountId: 'acct_123',
            stripeAccountEmail: 'owner@example.com',
            accountLivemode: false,
            lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
            lastSyncStatus: 'succeeded',
            lastSyncError: null,
            lastSyncCounts: { products: 1, prices: 1 },
          },
        ],
      });

    const result = await PaymentService.getInstance().syncPayments({ environment: 'test' });

    expect(result.results[0]?.connection.status).toBe('connected');
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
    expect(mockLockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_lock(hashtext($1))', [
      'payments_environment_test',
    ]);
    expect(mockLockClient.query).toHaveBeenCalledWith('SELECT pg_advisory_unlock(hashtext($1))', [
      'payments_environment_test',
    ]);
    expect(mockSyncClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.prices/i),
      ['test', ['price_123']]
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.products/i),
      ['test', ['prod_123']]
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('syncs payments by refreshing catalog before subscriptions', async () => {
    const mockLockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockCatalogClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockSubscriptionsClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    const connectedRow = {
      environment: 'test',
      status: 'connected',
      stripeAccountId: 'acct_123',
      stripeAccountEmail: 'owner@example.com',
      accountLivemode: false,
      webhookEndpointId: 'we_123',
      webhookEndpointUrl: 'https://example.com/api/webhooks/stripe/test',
      webhookConfiguredAt: new Date('2026-04-27T00:00:00.000Z'),
      lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
      lastSyncStatus: 'succeeded',
      lastSyncError: null,
      lastSyncCounts: { products: 1, prices: 1 },
    };

    mockPool.connect
      .mockResolvedValueOnce(mockLockClient)
      .mockResolvedValueOnce(mockCatalogClient)
      .mockResolvedValueOnce(mockSubscriptionsClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_123' }],
      })
      .mockResolvedValueOnce({ rows: [connectedRow] })
      .mockResolvedValueOnce({ rows: [connectedRow] });

    const result = await PaymentService.getInstance().syncPayments({ environment: 'test' });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      environment: 'test',
      connection: { status: 'connected', stripeAccountId: 'acct_123' },
      subscriptions: { environment: 'test', synced: 0, unmapped: 0, deleted: 0 },
    });
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
    expect(mockProvider.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockProvider.syncCatalog.mock.invocationCallOrder[0]).toBeLessThan(
      mockProvider.listSubscriptions.mock.invocationCallOrder[0]
    );
    expect(mockProvider.createWebhookEndpoint).not.toHaveBeenCalled();
    expect(mockSubscriptionsClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.subscriptions/i),
      ['test', []]
    );
  });

  it('clears account-scoped payment mirrors when catalog sync resolves to a different account', async () => {
    const mockLockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockSyncClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockSubscriptionsClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    mockPool.connect
      .mockResolvedValueOnce(mockLockClient)
      .mockResolvedValueOnce(mockSyncClient)
      .mockResolvedValueOnce(mockSubscriptionsClient);
    mockProvider.syncCatalog.mockResolvedValueOnce({
      account: {
        id: 'acct_new',
        object: 'account',
        email: 'new-owner@example.com',
        charges_enabled: true,
        details_submitted: true,
      } as unknown as StripeAccount,
      products: [],
      prices: [],
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_old' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            status: 'connected',
            stripeAccountId: 'acct_new',
            stripeAccountEmail: 'new-owner@example.com',
            accountLivemode: false,
            lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
            lastSyncStatus: 'succeeded',
            lastSyncError: null,
            lastSyncCounts: { products: 0, prices: 0 },
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            status: 'connected',
            stripeAccountId: 'acct_new',
            stripeAccountEmail: 'new-owner@example.com',
            accountLivemode: false,
            lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
            lastSyncStatus: 'succeeded',
            lastSyncError: null,
            lastSyncCounts: { products: 0, prices: 0 },
          },
        ],
      });

    await expect(
      PaymentService.getInstance().syncPayments({ environment: 'test' })
    ).resolves.toMatchObject({
      results: [
        {
          connection: {
            stripeAccountId: 'acct_new',
            status: 'connected',
          },
        },
      ],
    });

    expect(mockSyncClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.payment_history WHERE environment = $1',
      ['test']
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.checkout_sessions WHERE environment = $1',
      ['test']
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.stripe_customer_mappings WHERE environment = $1',
      ['test']
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.webhook_events WHERE environment = $1',
      ['test']
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.products WHERE environment = $1',
      ['test']
    );
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledTimes(1);
    expect(mockEncrypt).toHaveBeenCalledWith('whsec_new');
    expect(mockSyncClient.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_WEBHOOK_SECRET',
      'encrypted-secret',
    ]);
    expect(mockSyncClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.stripe_connections/i),
      [
        'test',
        'acct_new',
        'new-owner@example.com',
        false,
        { products: 0, prices: 0 },
        expect.objectContaining({ id: 'acct_new' }),
        'we_new',
        'http://localhost:7130/api/webhooks/stripe/test',
        true,
      ]
    );
    expect(mockSyncClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('lists products from the requested local Stripe mirror environment', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeProductId: 'prod_123',
            name: 'Pro',
            description: null,
            active: true,
            defaultPriceId: 'price_123',
            metadata: {},
            syncedAt: new Date('2026-04-27T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      PaymentService.getInstance().listProducts({ environment: 'test' })
    ).resolves.toEqual({
      products: [
        {
          environment: 'test',
          stripeProductId: 'prod_123',
          name: 'Pro',
          description: null,
          active: true,
          defaultPriceId: 'price_123',
          metadata: {},
          syncedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    });

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringMatching(/FROM payments\.products/i), [
      'test',
    ]);
  });

  it('creates products with the requested Stripe key and updates only the returned product mirror', async () => {
    mockGetSecretByKey.mockResolvedValue('sk_live_1234567890');
    const mockLockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    const mockMirrorClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockLockClient).mockResolvedValueOnce(mockMirrorClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          environment: 'live',
          status: 'connected',
          stripeAccountId: 'acct_123',
          stripeAccountEmail: 'owner@example.com',
          accountLivemode: true,
          lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
          lastSyncStatus: 'succeeded',
          lastSyncError: null,
          lastSyncCounts: { products: 1, prices: 1 },
        },
      ],
    });

    const result = await PaymentService.getInstance().createProduct({
      environment: 'live',
      name: 'New Product',
      active: true,
      metadata: { tier: 'new' },
      idempotencyKey: 'agent-product-123',
    });

    expect(mockProvider.createProduct).toHaveBeenCalledWith({
      name: 'New Product',
      active: true,
      metadata: { tier: 'new' },
      idempotencyKey: 'insforge:live:product:agent-product-123',
    });
    expect(mockGetSecretByKey).toHaveBeenCalledWith('STRIPE_LIVE_SECRET_KEY');
    expect(mockMirrorClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.products/i),
      expect.arrayContaining(['live', 'prod_new', 'New Product'])
    );
    expect(mockProvider.syncCatalog).not.toHaveBeenCalled();
    expect(result.product).toMatchObject({
      environment: 'live',
      stripeProductId: 'prod_new',
      name: 'New Product',
      active: true,
    });
  });

  it('updates and deletes products through the requested Stripe provider', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValue({
      rows: [
        {
          environment: 'test',
          status: 'connected',
          stripeAccountId: 'acct_123',
          stripeAccountEmail: 'owner@example.com',
          accountLivemode: false,
          lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
          lastSyncStatus: 'succeeded',
          lastSyncError: null,
          lastSyncCounts: { products: 1, prices: 1 },
        },
      ],
    });

    await expect(
      PaymentService.getInstance().updateProduct('prod_123', {
        environment: 'test',
        name: 'Updated Product',
        active: false,
      })
    ).resolves.toMatchObject({
      product: {
        environment: 'test',
        stripeProductId: 'prod_123',
        active: false,
      },
    });

    await expect(PaymentService.getInstance().deleteProduct('test', 'prod_123')).resolves.toEqual({
      stripeProductId: 'prod_123',
      deleted: true,
    });

    expect(mockProvider.updateProduct).toHaveBeenCalledWith('prod_123', {
      name: 'Updated Product',
      active: false,
    });
    expect(mockProvider.deleteProduct).toHaveBeenCalledWith('prod_123');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.products/i),
      expect.arrayContaining(['test', 'prod_123', 'Updated Product'])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.prices[\s\S]*stripe_product_id = \$2/i),
      ['test', 'prod_123']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.products[\s\S]*stripe_product_id = \$2/i),
      ['test', 'prod_123']
    );
    expect(mockProvider.syncCatalog).not.toHaveBeenCalled();
  });

  it('lists prices from the requested local Stripe mirror with an optional product filter', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          stripePriceId: 'price_123',
          stripeProductId: 'prod_123',
          active: true,
          currency: 'usd',
          unitAmount: 1000,
          unitAmountDecimal: null,
          type: 'recurring',
          lookupKey: 'pro_monthly',
          billingScheme: 'per_unit',
          taxBehavior: 'exclusive',
          recurringInterval: 'month',
          recurringIntervalCount: 1,
          metadata: {},
          syncedAt: new Date('2026-04-27T00:00:00.000Z'),
        },
      ],
    });

    await expect(
      PaymentService.getInstance().listPrices({ environment: 'test', stripeProductId: 'prod_123' })
    ).resolves.toEqual({
      prices: [
        {
          environment: 'test',
          stripePriceId: 'price_123',
          stripeProductId: 'prod_123',
          active: true,
          currency: 'usd',
          unitAmount: 1000,
          unitAmountDecimal: null,
          type: 'recurring',
          lookupKey: 'pro_monthly',
          billingScheme: 'per_unit',
          taxBehavior: 'exclusive',
          recurringInterval: 'month',
          recurringIntervalCount: 1,
          metadata: {},
          syncedAt: '2026-04-27T00:00:00.000Z',
        },
      ],
    });
  });

  it('creates, updates, and archives prices through the requested Stripe provider', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValue({
      rows: [
        {
          environment: 'test',
          status: 'connected',
          stripeAccountId: 'acct_123',
          stripeAccountEmail: 'owner@example.com',
          accountLivemode: false,
          lastSyncedAt: new Date('2026-04-27T00:00:00.000Z'),
          lastSyncStatus: 'succeeded',
          lastSyncError: null,
          lastSyncCounts: { products: 1, prices: 1 },
        },
      ],
    });

    await expect(
      PaymentService.getInstance().createPrice({
        environment: 'test',
        stripeProductId: 'prod_123',
        currency: 'usd',
        unitAmount: 2000,
        recurring: { interval: 'month', intervalCount: 1 },
        idempotencyKey: 'agent-price-123',
      })
    ).resolves.toMatchObject({
      price: {
        environment: 'test',
        stripePriceId: 'price_new',
        stripeProductId: 'prod_123',
        active: true,
      },
    });

    await expect(
      PaymentService.getInstance().updatePrice('price_123', {
        environment: 'test',
        active: false,
        metadata: { archived: 'true' },
      })
    ).resolves.toMatchObject({
      price: {
        environment: 'test',
        stripePriceId: 'price_123',
        active: false,
      },
    });

    await expect(
      PaymentService.getInstance().archivePrice('test', 'price_123')
    ).resolves.toMatchObject({
      price: {
        environment: 'test',
        stripePriceId: 'price_123',
        active: false,
      },
      archived: true,
    });

    expect(mockProvider.createPrice).toHaveBeenCalledWith({
      stripeProductId: 'prod_123',
      currency: 'usd',
      unitAmount: 2000,
      recurring: { interval: 'month', intervalCount: 1 },
      idempotencyKey: 'insforge:test:price:agent-price-123',
    });
    expect(mockProvider.updatePrice).toHaveBeenCalledWith('price_123', {
      active: false,
      metadata: { archived: 'true' },
    });
    expect(mockProvider.updatePrice).toHaveBeenCalledWith('price_123', { active: false });
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.prices/i),
      expect.arrayContaining(['test', 'price_new', 'prod_123', true, 'usd'])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.prices/i),
      expect.arrayContaining(['test', 'price_123', 'prod_123', false, 'usd'])
    );
    expect(mockProvider.syncCatalog).not.toHaveBeenCalled();
  });

  it('rejects subscription checkout without a billing subject', async () => {
    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'subscription',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        },
        checkoutUser
      )
    ).rejects.toThrow(/billing subject/i);

    expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('creates an authorized checkout row before identified Stripe checkout', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [checkoutSessionRow] });
    mockProvider.createCheckoutSession.mockResolvedValueOnce({
      id: 'cs_test_123',
      object: 'checkout.session',
      mode: 'subscription',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      status: 'open',
      payment_status: 'unpaid',
      customer: 'cus_123',
      payment_intent: null,
      subscription: null,
    });

    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'subscription',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerEmail: 'buyer@example.com',
          subject: { type: 'team', id: 'team_123' },
          metadata: { plan: 'pro' },
          idempotencyKey: 'checkout-123',
        },
        checkoutUser
      )
    ).resolves.toMatchObject({
      checkoutSession: {
        id: checkoutSessionRow.id,
        environment: 'test',
        stripeCheckoutSessionId: 'cs_test_123',
        mode: 'subscription',
        stripeCustomerId: 'cus_123',
      },
    });

    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET LOCAL ROLE authenticated/i)
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.checkout_sessions/i),
      expect.arrayContaining([
        'test',
        'subscription',
        'team',
        'team_123',
        'buyer@example.com',
        JSON.stringify([{ stripePriceId: 'price_123', quantity: 1 }]),
        'https://example.com/success',
        'https://example.com/cancel',
      ])
    );
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith({
      mode: 'subscription',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerId: null,
      customerEmail: 'buyer@example.com',
      clientReferenceId: expect.any(String),
      metadata: {
        plan: 'pro',
        insforge_checkout_mode: 'subscription',
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_123',
        insforge_checkout_session_id: expect.any(String),
      },
      idempotencyKey: 'insforge:test:checkout_session:checkout-123',
    });
  });

  it('returns an existing checkout session for matching caller idempotency retries', async () => {
    const existingCheckoutSessionRow = {
      ...checkoutSessionRow,
      id: 'f3478541-f24c-4833-a060-b81691a761ef',
      stripeCheckoutSessionId: 'cs_existing_123',
      url: 'https://checkout.stripe.com/c/pay/cs_existing_123',
    };
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.checkout_sessions/i.test(sql)) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }

        if (/FROM payments\.checkout_sessions[\s\S]*idempotency_key = \$2/i.test(sql)) {
          return Promise.resolve({ rows: [existingCheckoutSessionRow] });
        }

        return Promise.resolve({ rowCount: 1, rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'subscription',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerEmail: 'buyer@example.com',
          subject: { type: 'team', id: 'team_123' },
          idempotencyKey: 'checkout-123',
        },
        checkoutUser
      )
    ).resolves.toMatchObject({
      checkoutSession: {
        id: existingCheckoutSessionRow.id,
        stripeCheckoutSessionId: 'cs_existing_123',
      },
    });

    expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET LOCAL ROLE authenticated/i)
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM payments\.checkout_sessions[\s\S]*idempotency_key = \$2/i),
      [
        'test',
        'checkout-123',
        'subscription',
        'team',
        'team_123',
        'buyer@example.com',
        JSON.stringify([{ stripePriceId: 'price_123', quantity: 1 }]),
        'https://example.com/success',
        'https://example.com/cancel',
      ]
    );
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('resumes incomplete idempotent checkout rows instead of returning unusable rows', async () => {
    const existingCheckoutSessionRow = {
      ...checkoutSessionRow,
      id: 'f3478541-f24c-4833-a060-b81691a761ef',
      status: 'initialized',
      stripeCheckoutSessionId: null,
      stripeCustomerId: null,
      url: null,
    };
    const openedCheckoutSessionRow = {
      ...checkoutSessionRow,
      id: existingCheckoutSessionRow.id,
      stripeCheckoutSessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
    };
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.checkout_sessions/i.test(sql)) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }

        if (/FROM payments\.checkout_sessions[\s\S]*idempotency_key = \$2/i.test(sql)) {
          return Promise.resolve({ rows: [existingCheckoutSessionRow] });
        }

        return Promise.resolve({ rowCount: 1, rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockImplementation((sql: string) => {
      if (/SELECT stripe_customer_id AS "stripeCustomerId"/i.test(sql)) {
        return Promise.resolve({ rows: [] });
      }

      if (/UPDATE payments\.checkout_sessions/i.test(sql)) {
        return Promise.resolve({ rows: [openedCheckoutSessionRow] });
      }

      return Promise.resolve({ rowCount: 1, rows: [] });
    });

    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'subscription',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerEmail: 'buyer@example.com',
          subject: { type: 'team', id: 'team_123' },
          idempotencyKey: 'checkout-123',
        },
        checkoutUser
      )
    ).resolves.toMatchObject({
      checkoutSession: {
        id: existingCheckoutSessionRow.id,
        stripeCheckoutSessionId: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      },
    });

    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith({
      mode: 'subscription',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerId: null,
      customerEmail: 'buyer@example.com',
      clientReferenceId: existingCheckoutSessionRow.id,
      metadata: {
        insforge_checkout_mode: 'subscription',
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_123',
        insforge_checkout_session_id: existingCheckoutSessionRow.id,
      },
      idempotencyKey: 'insforge:test:checkout_session:checkout-123',
    });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.checkout_sessions/i),
      expect.arrayContaining([existingCheckoutSessionRow.id, expect.any(String)])
    );
  });

  it('does not expose idempotent checkout rows hidden by checkout session RLS', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.checkout_sessions/i.test(sql)) {
          return Promise.resolve({ rowCount: 0, rows: [] });
        }

        if (/FROM payments\.checkout_sessions[\s\S]*idempotency_key = \$2/i.test(sql)) {
          return Promise.resolve({ rows: [] });
        }

        return Promise.resolve({ rowCount: 1, rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'subscription',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerEmail: 'buyer@example.com',
          subject: { type: 'team', id: 'team_123' },
          idempotencyKey: 'checkout-123',
        },
        checkoutUser
      )
    ).rejects.toThrow(/Idempotency key is already used/);

    expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET LOCAL ROLE authenticated/i)
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM payments\.checkout_sessions[\s\S]*idempotency_key = \$2/i),
      [
        'test',
        'checkout-123',
        'subscription',
        'team',
        'team_123',
        'buyer@example.com',
        JSON.stringify([{ stripePriceId: 'price_123', quantity: 1 }]),
        'https://example.com/success',
        'https://example.com/cancel',
      ]
    );
    expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('reuses an existing Stripe customer mapping for identified checkout', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeCustomerId: 'cus_existing' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            ...checkoutSessionRow,
            id: '0dd01831-1742-4f1f-9622-f2274ca7f6c5',
            mode: 'payment',
            subjectType: 'organization',
            subjectId: 'org_123',
            stripeCustomerId: 'cus_existing',
          },
        ],
      });

    await PaymentService.getInstance().createCheckoutSession(
      {
        environment: 'test',
        mode: 'payment',
        lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        subject: { type: 'organization', id: 'org_123' },
      },
      checkoutUser
    );

    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_existing',
        customerEmail: null,
        metadata: {
          insforge_checkout_mode: 'payment',
          insforge_subject_type: 'organization',
          insforge_subject_id: 'org_123',
          insforge_checkout_session_id: expect.any(String),
        },
        clientReferenceId: expect.any(String),
        idempotencyKey: expect.stringMatching(/^insforge:test:checkout_session:/),
      })
    );
  });

  it('asks Stripe to create a Customer for identified one-time checkout without a mapping', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...checkoutSessionRow,
            id: '81b9f7aa-87c7-4f5a-8d3b-9112730f13af',
            mode: 'payment',
            subjectType: 'organization',
            subjectId: 'org_123',
            customerEmail: 'buyer@example.com',
            stripeCustomerId: 'cus_123',
          },
        ],
      });

    await PaymentService.getInstance().createCheckoutSession(
      {
        environment: 'test',
        mode: 'payment',
        lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'buyer@example.com',
        subject: { type: 'organization', id: 'org_123' },
      },
      checkoutUser
    );

    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        customerId: null,
        customerEmail: 'buyer@example.com',
        customerCreation: 'always',
        metadata: {
          insforge_checkout_mode: 'payment',
          insforge_subject_type: 'organization',
          insforge_subject_id: 'org_123',
          insforge_checkout_session_id: expect.any(String),
        },
      })
    );
  });

  it('allows anonymous one-time checkout without creating a customer mapping', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          ...checkoutSessionRow,
          id: '7b98f4d1-880f-4e2a-b9f2-414398e376a1',
          mode: 'payment',
          subjectType: null,
          subjectId: null,
          customerEmail: 'anon@example.com',
        },
      ],
    });

    await PaymentService.getInstance().createCheckoutSession(
      {
        environment: 'test',
        mode: 'payment',
        lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'anon@example.com',
      },
      anonCheckoutUser
    );

    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith({
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerId: null,
      customerEmail: 'anon@example.com',
      clientReferenceId: expect.any(String),
      metadata: {
        insforge_checkout_mode: 'payment',
        insforge_checkout_session_id: expect.any(String),
      },
      idempotencyKey: expect.stringMatching(/^insforge:test:checkout_session:/),
    });
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/payments\.stripe_customer_mappings/i),
      expect.any(Array)
    );
  });

  it('rejects caller-controlled InsForge checkout metadata before creating Stripe checkout', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'payment',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          customerEmail: 'anon@example.com',
          metadata: {
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_victim',
          },
        },
        anonCheckoutUser
      )
    ).rejects.toThrow(/reserved for InsForge/i);

    expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.checkout_sessions/i),
      expect.any(Array)
    );
  });

  it('does not call Stripe when checkout_sessions RLS denies the insert', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.checkout_sessions/i.test(sql)) {
          return Promise.reject({ code: '42501', message: 'new row violates row-level security' });
        }

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(
      PaymentService.getInstance().createCheckoutSession(
        {
          environment: 'test',
          mode: 'payment',
          lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          subject: { type: 'team', id: 'team_123' },
        },
        checkoutUser
      )
    ).rejects.toThrow(/RLS policies/i);

    expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
  });

  it('creates a Stripe customer portal session from an existing billing subject mapping', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.customer_portal_sessions/i.test(sql)) {
          return Promise.resolve({ rows: [customerPortalSessionRow] });
        }

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeCustomerId: 'cus_123' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            ...customerPortalSessionRow,
            status: 'created',
            stripeCustomerId: 'cus_123',
            url: 'https://billing.stripe.com/p/session/test_123',
          },
        ],
      });

    await expect(
      PaymentService.getInstance().createCustomerPortalSession(
        {
          environment: 'test',
          subject: { type: 'team', id: 'team_123' },
          returnUrl: 'https://example.com/account',
          configuration: 'bpc_123',
        },
        checkoutUser
      )
    ).resolves.toEqual({
      customerPortalSession: {
        id: customerPortalSessionRow.id,
        environment: 'test',
        status: 'created',
        subjectType: 'team',
        subjectId: 'team_123',
        stripeCustomerId: 'cus_123',
        returnUrl: 'https://example.com/account',
        configuration: 'bpc_123',
        url: 'https://billing.stripe.com/p/session/test_123',
        lastError: null,
        createdAt: '2026-04-29T00:00:00.000Z',
        updatedAt: '2026-04-29T00:00:00.000Z',
      },
    });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/SET LOCAL ROLE authenticated/i)
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.customer_portal_sessions/i),
      expect.arrayContaining([
        'test',
        'team',
        'team_123',
        'https://example.com/account',
        'bpc_123',
      ])
    );
    expect(mockProvider.createCustomerPortalSession).toHaveBeenCalledWith({
      customerId: 'cus_123',
      returnUrl: 'https://example.com/account',
      configuration: 'bpc_123',
    });
  });

  it('rejects customer portal sessions when the billing subject has no Stripe customer mapping', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.customer_portal_sessions/i.test(sql)) {
          return Promise.resolve({
            rows: [{ ...customerPortalSessionRow, subjectId: 'missing_team' }],
          });
        }

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValue({ rows: [] });

    await expect(
      PaymentService.getInstance().createCustomerPortalSession(
        {
          environment: 'test',
          subject: { type: 'team', id: 'missing_team' },
          returnUrl: 'https://example.com/account',
        },
        checkoutUser
      )
    ).rejects.toThrow(/No Stripe customer is mapped/i);

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.customer_portal_sessions/i),
      expect.any(Array)
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE payments\.customer_portal_sessions/i),
      [expect.any(String), expect.stringMatching(/No Stripe customer is mapped/i)]
    );
    expect(mockProvider.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it('does not call Stripe when customer_portal_sessions RLS denies the insert', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql: string) => {
        if (/INSERT INTO payments\.customer_portal_sessions/i.test(sql)) {
          return Promise.reject({ code: '42501', message: 'new row violates row-level security' });
        }

        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);

    await expect(
      PaymentService.getInstance().createCustomerPortalSession(
        {
          environment: 'test',
          subject: { type: 'team', id: 'team_123' },
          returnUrl: 'https://example.com/account',
        },
        checkoutUser
      )
    ).rejects.toThrow(/customer_portal_sessions RLS policies/i);

    expect(mockProvider.createCustomerPortalSession).not.toHaveBeenCalled();
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/stripe_customer_mappings/i),
      expect.any(Array)
    );
  });

  it('rejects anonymous customer portal sessions', async () => {
    await expect(
      PaymentService.getInstance().createCustomerPortalSession(
        {
          environment: 'test',
          subject: { type: 'team', id: 'team_123' },
          returnUrl: 'https://example.com/account',
        },
        anonCheckoutUser
      )
    ).rejects.toThrow(/authenticated user/i);

    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/stripe_customer_mappings/i),
      expect.any(Array)
    );
    expect(mockProvider.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it('stores duplicate processed Stripe webhook events without reprocessing', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_123',
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: { id: 'cs_test_123', object: 'checkout.session' } },
    });
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          stripeEventId: 'evt_123',
          eventType: 'checkout.session.completed',
          livemode: false,
          stripeAccountId: null,
          objectType: 'checkout.session',
          objectId: 'cs_test_123',
          processingStatus: 'processed',
          attemptCount: 1,
          lastError: null,
          receivedAt: new Date('2026-04-28T00:00:00.000Z'),
          processedAt: new Date('2026-04-28T00:00:01.000Z'),
          createdAt: new Date('2026-04-28T00:00:00.000Z'),
          updatedAt: new Date('2026-04-28T00:00:01.000Z'),
        },
      ],
    });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({
      received: true,
      handled: false,
      event: {
        stripeEventId: 'evt_123',
        processingStatus: 'processed',
      },
    });

    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.payment_history/i),
      expect.any(Array)
    );
  });

  it('records one-time payment history from checkout.session.completed webhooks', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_123',
      type: 'checkout.session.completed',
      created: 1777334700,
      livemode: false,
      data: {
        object: {
          id: 'cs_test_123',
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 4500,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          customer_details: { email: 'buyer@example.com' },
          payment_intent: 'pi_123',
          subscription: null,
          metadata: {
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_123',
          },
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({
      received: true,
      handled: true,
      event: {
        stripeEventId: 'evt_123',
        processingStatus: 'processed',
      },
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_payment_intent_id\)[\s\S]*AND type <> 'refund'/i
      ),
      [
        'test',
        'succeeded',
        'team',
        'team_123',
        'cus_123',
        'buyer@example.com',
        'cs_test_123',
        'pi_123',
        null,
        4500,
        'usd',
        null,
        new Date('2026-04-28T00:05:00.000Z'),
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'cs_test_123' }),
      ]
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/WITH refund_totals[\s\S]*UPDATE payments\.payment_history original/i),
      ['test', 'pi_123', null]
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.stripe_customer_mappings/i),
      ['test', 'team', 'team_123', 'cus_123']
    );
  });

  it('maps customer identity for completed delayed checkout sessions before payment settles', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_delayed_completed_123',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_delayed_123',
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'unpaid',
          amount_total: 4500,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          customer_details: { email: 'buyer@example.com' },
          payment_intent: 'pi_delayed_123',
          subscription: null,
          metadata: {
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_123',
          },
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_delayed_completed_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_delayed_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_delayed_completed_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_delayed_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_delayed_completed_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.stripe_customer_mappings/i),
      ['test', 'team', 'team_123', 'cus_123']
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_payment_intent_id\)[\s\S]*AND type <> 'refund'/i
      ),
      expect.arrayContaining(['test', 'pending', 'team', 'team_123', 'cus_123'])
    );
  });

  it('deduplicates one-time checkout history by checkout session when PaymentIntent is absent', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_no_payment_required_123',
      type: 'checkout.session.completed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_no_payment_required_123',
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'no_payment_required',
          amount_total: 0,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          customer_details: { email: 'buyer@example.com' },
          payment_intent: null,
          subscription: null,
          metadata: {
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_123',
          },
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_no_payment_required_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_no_payment_required_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_no_payment_required_123',
            eventType: 'checkout.session.completed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_no_payment_required_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_no_payment_required_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_checkout_session_id\)[\s\S]*AND type <> 'refund'/i
      ),
      [
        'test',
        'pending',
        'team',
        'team_123',
        'cus_123',
        'buyer@example.com',
        'cs_test_no_payment_required_123',
        null,
        null,
        0,
        'usd',
        null,
        null,
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'cs_test_no_payment_required_123' }),
      ]
    );
  });

  it('records failed delayed checkout payments from async failure webhooks', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_async_failed_123',
      type: 'checkout.session.async_payment_failed',
      livemode: false,
      data: {
        object: {
          id: 'cs_test_async_123',
          object: 'checkout.session',
          mode: 'payment',
          payment_status: 'unpaid',
          amount_total: 4500,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          customer_details: { email: 'buyer@example.com' },
          payment_intent: 'pi_async_123',
          subscription: null,
          metadata: {
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_123',
          },
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_async_failed_123',
            eventType: 'checkout.session.async_payment_failed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_async_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_async_failed_123',
            eventType: 'checkout.session.async_payment_failed',
            livemode: false,
            stripeAccountId: null,
            objectType: 'checkout.session',
            objectId: 'cs_test_async_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_async_failed_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_payment_intent_id\)[\s\S]*AND type <> 'refund'/i
      ),
      [
        'test',
        'failed',
        'team',
        'team_123',
        'cus_123',
        'buyer@example.com',
        'cs_test_async_123',
        'pi_async_123',
        null,
        4500,
        'usd',
        null,
        null,
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'cs_test_async_123' }),
      ]
    );
  });

  it('records subscription invoice payment history from invoice webhooks', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_invoice_123',
      type: 'invoice.paid',
      livemode: false,
      data: {
        object: {
          id: 'in_123',
          object: 'invoice',
          amount_due: 9900,
          amount_paid: 9900,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          customer_email: 'buyer@example.com',
          description: 'Subscription invoice',
          number: 'INV-123',
          metadata: {},
          status_transitions: { paid_at: 1777334500 },
          parent: {
            type: 'subscription_details',
            quote_details: null,
            subscription_details: {
              subscription: 'sub_123',
              metadata: {
                insforge_subject_type: 'organization',
                insforge_subject_id: 'org_123',
              },
            },
          },
          payments: {
            data: [
              {
                payment: {
                  type: 'payment_intent',
                  payment_intent: 'pi_invoice_123',
                },
              },
            ],
          },
          lines: {
            data: [
              {
                pricing: {
                  price_details: {
                    product: 'prod_123',
                    price: 'price_123',
                  },
                },
              },
            ],
          },
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_invoice_123',
            eventType: 'invoice.paid',
            livemode: false,
            stripeAccountId: null,
            objectType: 'invoice',
            objectId: 'in_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_invoice_123',
            eventType: 'invoice.paid',
            livemode: false,
            stripeAccountId: null,
            objectType: 'invoice',
            objectId: 'in_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_invoice_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_invoice_id\)[\s\S]*AND type <> 'refund'/i
      ),
      [
        'test',
        'subscription_invoice',
        'succeeded',
        'organization',
        'org_123',
        'cus_123',
        'buyer@example.com',
        'pi_invoice_123',
        'in_123',
        'sub_123',
        'prod_123',
        'price_123',
        9900,
        'usd',
        'Subscription invoice',
        new Date('2026-04-28T00:01:40.000Z'),
        null,
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'in_123' }),
      ]
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /stripe_payment_intent_id = COALESCE\(EXCLUDED\.stripe_payment_intent_id, payment_history\.stripe_payment_intent_id\)/i
      ),
      expect.any(Array)
    );
  });

  it('ignores PaymentIntent webhooks that are not InsForge one-time checkout payments', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_pi_invoice_123',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: {
        object: {
          id: 'pi_invoice_123',
          object: 'payment_intent',
          amount: 9900,
          amount_received: 9900,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          latest_charge: 'ch_123',
          metadata: {},
          receipt_email: null,
          description: null,
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_pi_invoice_123',
            eventType: 'payment_intent.succeeded',
            livemode: false,
            stripeAccountId: null,
            objectType: 'payment_intent',
            objectId: 'pi_invoice_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_pi_invoice_123',
            eventType: 'payment_intent.succeeded',
            livemode: false,
            stripeAccountId: null,
            objectType: 'payment_intent',
            objectId: 'pi_invoice_123',
            processingStatus: 'ignored',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_pi_invoice_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({
      received: true,
      handled: false,
      event: { processingStatus: 'ignored' },
    });

    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.payment_history/i),
      expect.any(Array)
    );
  });

  it('records InsForge one-time PaymentIntent webhooks with non-refund uniqueness', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_pi_checkout_123',
      type: 'payment_intent.succeeded',
      livemode: false,
      data: {
        object: {
          id: 'pi_checkout_123',
          object: 'payment_intent',
          amount: 4500,
          amount_received: 4500,
          currency: 'usd',
          created: 1777334400,
          customer: 'cus_123',
          latest_charge: 'ch_123',
          metadata: {
            insforge_checkout_mode: 'payment',
            insforge_subject_type: 'team',
            insforge_subject_id: 'team_123',
          },
          receipt_email: 'buyer@example.com',
          description: 'One-time checkout',
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_pi_checkout_123',
            eventType: 'payment_intent.succeeded',
            livemode: false,
            stripeAccountId: null,
            objectType: 'payment_intent',
            objectId: 'pi_checkout_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_pi_checkout_123',
            eventType: 'payment_intent.succeeded',
            livemode: false,
            stripeAccountId: null,
            objectType: 'payment_intent',
            objectId: 'pi_checkout_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_pi_checkout_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_payment_intent_id\)[\s\S]*AND type <> 'refund'/i
      ),
      [
        'test',
        'one_time_payment',
        'succeeded',
        'team',
        'team_123',
        'cus_123',
        'buyer@example.com',
        'pi_checkout_123',
        'ch_123',
        4500,
        'usd',
        'One-time checkout',
        new Date('2026-04-28T00:00:00.000Z'),
        null,
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'pi_checkout_123' }),
      ]
    );
  });

  it('records refund history and copies context from the original payment', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_refund_123',
      type: 'refund.created',
      livemode: false,
      data: {
        object: {
          id: 're_123',
          object: 'refund',
          amount: 2500,
          currency: 'usd',
          created: 1777334600,
          charge: 'ch_123',
          payment_intent: 'pi_invoice_123',
          reason: 'requested_by_customer',
          description: null,
          status: 'succeeded',
          metadata: {},
        },
      },
    });
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_refund_123',
            eventType: 'refund.created',
            livemode: false,
            stripeAccountId: null,
            objectType: 'refund',
            objectId: 're_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            subjectType: 'organization',
            subjectId: 'org_123',
            stripeCustomerId: 'cus_123',
            customerEmailSnapshot: 'buyer@example.com',
            stripeInvoiceId: 'in_123',
            stripeSubscriptionId: 'sub_123',
            stripeProductId: 'prod_123',
            stripePriceId: 'price_123',
            description: 'Subscription invoice',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_refund_123',
            eventType: 'refund.created',
            livemode: false,
            stripeAccountId: null,
            objectType: 'refund',
            objectId: 're_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_refund_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_refund_id\)/i
      ),
      [
        'test',
        'refunded',
        'organization',
        'org_123',
        'cus_123',
        'buyer@example.com',
        'pi_invoice_123',
        'in_123',
        'ch_123',
        're_123',
        'sub_123',
        'prod_123',
        'price_123',
        2500,
        'usd',
        'requested_by_customer',
        new Date('2026-04-28T00:03:20.000Z'),
        new Date('2026-04-28T00:03:20.000Z'),
        expect.objectContaining({ id: 're_123' }),
      ]
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DO UPDATE SET[\s\S]*subject_type = COALESCE\(EXCLUDED\.subject_type, payment_history\.subject_type\)[\s\S]*stripe_invoice_id = COALESCE\(EXCLUDED\.stripe_invoice_id, payment_history\.stripe_invoice_id\)[\s\S]*stripe_price_id = COALESCE\(EXCLUDED\.stripe_price_id, payment_history\.stripe_price_id\)/i
      ),
      expect.any(Array)
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/WITH refund_totals[\s\S]*UPDATE payments\.payment_history original/i),
      ['test', 'pi_invoice_123', 'ch_123']
    );
  });

  it('hydrates refund context from Stripe when refund arrives before the payment event', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_refund_early_123',
      type: 'refund.created',
      livemode: false,
      data: {
        object: {
          id: 're_early_123',
          object: 'refund',
          amount: 1500,
          currency: 'usd',
          created: 1777334600,
          charge: 'ch_early_123',
          payment_intent: 'pi_early_123',
          reason: 'requested_by_customer',
          description: null,
          status: 'succeeded',
          metadata: {},
        },
      },
    });
    mockProvider.retrievePaymentIntent.mockResolvedValueOnce({
      id: 'pi_early_123',
      object: 'payment_intent',
      status: 'succeeded',
      customer: 'cus_early_123',
      latest_charge: 'ch_early_123',
      amount: 4500,
      amount_received: 4500,
      currency: 'usd',
      description: 'Early checkout',
      receipt_email: 'early@example.com',
      created: 1777334400,
      metadata: {
        insforge_checkout_mode: 'payment',
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_early_123',
      },
    } as unknown as StripePaymentIntent);
    mockProvider.retrieveCharge.mockResolvedValueOnce({
      id: 'ch_early_123',
      object: 'charge',
      customer: 'cus_early_123',
      payment_intent: 'pi_early_123',
      amount_refunded: 1500,
      refunded: false,
      refunds: { data: [] },
      billing_details: { email: 'early@example.com' },
      description: 'Early checkout',
      metadata: {},
    } as unknown as StripeCharge);
    mockProvider.retrieveInvoiceByPaymentIntent.mockResolvedValueOnce(null);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_refund_early_123',
            eventType: 'refund.created',
            livemode: false,
            stripeAccountId: null,
            objectType: 'refund',
            objectId: 're_early_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            subjectType: 'team',
            subjectId: 'team_early_123',
            stripeCustomerId: 'cus_early_123',
            customerEmailSnapshot: 'early@example.com',
            stripeInvoiceId: null,
            stripeSubscriptionId: null,
            stripeProductId: null,
            stripePriceId: null,
            description: 'Early checkout',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_refund_early_123',
            eventType: 'refund.created',
            livemode: false,
            stripeAccountId: null,
            objectType: 'refund',
            objectId: 're_early_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_refund_early_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockProvider.retrievePaymentIntent).toHaveBeenCalledWith('pi_early_123');
    expect(mockProvider.retrieveCharge).toHaveBeenCalledWith('ch_early_123');
    expect(mockProvider.retrieveInvoiceByPaymentIntent).toHaveBeenCalledWith('pi_early_123');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_payment_intent_id\)/i
      ),
      [
        'test',
        'one_time_payment',
        'succeeded',
        'team',
        'team_early_123',
        'cus_early_123',
        'early@example.com',
        'pi_early_123',
        'ch_early_123',
        4500,
        'usd',
        'Early checkout',
        new Date('2026-04-28T00:00:00.000Z'),
        null,
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'pi_early_123' }),
      ]
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.payment_history[\s\S]*stripe_refund_id/i),
      expect.arrayContaining([
        'test',
        'refunded',
        'team',
        'team_early_123',
        'cus_early_123',
        'early@example.com',
        'pi_early_123',
        'ch_early_123',
        're_early_123',
      ])
    );
  });

  it('hydrates subscription refund context from Stripe invoice payments when refund arrives first', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_refund_sub_early_123',
      type: 'refund.created',
      livemode: false,
      data: {
        object: {
          id: 're_sub_early_123',
          object: 'refund',
          amount: 3300,
          currency: 'usd',
          created: 1777334600,
          charge: 'ch_sub_early_123',
          payment_intent: 'pi_sub_early_123',
          reason: 'requested_by_customer',
          description: null,
          status: 'succeeded',
          metadata: {},
        },
      },
    });
    mockProvider.retrievePaymentIntent.mockResolvedValueOnce({
      id: 'pi_sub_early_123',
      object: 'payment_intent',
      status: 'succeeded',
      customer: 'cus_sub_early_123',
      latest_charge: 'ch_sub_early_123',
      amount: 9900,
      amount_received: 9900,
      currency: 'usd',
      description: null,
      receipt_email: null,
      created: 1777334400,
      metadata: {},
    } as unknown as StripePaymentIntent);
    mockProvider.retrieveCharge.mockResolvedValueOnce({
      id: 'ch_sub_early_123',
      object: 'charge',
      customer: 'cus_sub_early_123',
      payment_intent: 'pi_sub_early_123',
      amount_refunded: 3300,
      refunded: false,
      refunds: { data: [] },
      billing_details: { email: 'subscription@example.com' },
      description: null,
      metadata: {},
    } as unknown as StripeCharge);
    mockProvider.retrieveInvoiceByPaymentIntent.mockResolvedValueOnce({
      id: 'in_sub_early_123',
      object: 'invoice',
      amount_due: 9900,
      amount_paid: 9900,
      currency: 'usd',
      created: 1777334400,
      customer: 'cus_sub_early_123',
      customer_email: 'subscription@example.com',
      description: 'Subscription invoice',
      number: 'INV-SUB-123',
      metadata: {},
      status_transitions: { paid_at: 1777334500 },
      parent: {
        type: 'subscription_details',
        quote_details: null,
        subscription_details: {
          subscription: 'sub_early_123',
          metadata: {
            insforge_subject_type: 'organization',
            insforge_subject_id: 'org_early_123',
          },
        },
      },
      payments: {
        data: [
          {
            id: 'inpay_sub_early_123',
            payment: {
              type: 'payment_intent',
              payment_intent: 'pi_sub_early_123',
            },
          },
        ],
      },
      lines: {
        data: [
          {
            pricing: {
              price_details: {
                product: 'prod_sub_early_123',
                price: 'price_sub_early_123',
              },
            },
          },
        ],
      },
    } as unknown as StripeInvoice);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_refund_sub_early_123',
            eventType: 'refund.created',
            livemode: false,
            stripeAccountId: null,
            objectType: 'refund',
            objectId: 're_sub_early_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_refund_sub_early_123',
            eventType: 'refund.created',
            livemode: false,
            stripeAccountId: null,
            objectType: 'refund',
            objectId: 're_sub_early_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_refund_sub_early_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockProvider.retrieveInvoiceByPaymentIntent).toHaveBeenCalledWith('pi_sub_early_123');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.payment_history[\s\S]*ON CONFLICT \(environment, stripe_invoice_id\)/i
      ),
      expect.arrayContaining([
        'test',
        'subscription_invoice',
        'succeeded',
        'organization',
        'org_early_123',
        'cus_sub_early_123',
        'subscription@example.com',
        'pi_sub_early_123',
        'in_sub_early_123',
        'sub_early_123',
        'prod_sub_early_123',
        'price_sub_early_123',
      ])
    );
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.payment_history[\s\S]*stripe_refund_id/i),
      expect.arrayContaining([
        'test',
        'refunded',
        'organization',
        'org_early_123',
        'cus_sub_early_123',
        'subscription@example.com',
        'pi_sub_early_123',
        'in_sub_early_123',
        'ch_sub_early_123',
        're_sub_early_123',
        'sub_early_123',
        'prod_sub_early_123',
        'price_sub_early_123',
      ])
    );
  });

  it('upserts subscription projections from subscription webhooks', async () => {
    mockGetSecretByKey
      .mockResolvedValueOnce('whsec_test_123')
      .mockResolvedValueOnce('sk_test_1234567890');
    mockProvider.constructWebhookEvent.mockReturnValueOnce({
      id: 'evt_sub_123',
      type: 'customer.subscription.updated',
      livemode: false,
      data: {
        object: {
          id: 'sub_123',
          object: 'subscription',
          customer: 'cus_123',
          status: 'active',
          current_period_start: 1777334400,
          current_period_end: 1779926400,
          cancel_at_period_end: false,
          cancel_at: null,
          canceled_at: null,
          trial_start: null,
          trial_end: null,
          latest_invoice: 'in_123',
          metadata: {
            insforge_subject_type: 'organization',
            insforge_subject_id: 'org_123',
          },
          items: {
            data: [
              {
                id: 'si_123',
                object: 'subscription_item',
                quantity: 1,
                metadata: {},
                price: {
                  id: 'price_123',
                  product: 'prod_123',
                },
              },
            ],
          },
        },
      },
    });
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_sub_123',
            eventType: 'customer.subscription.updated',
            livemode: false,
            stripeAccountId: null,
            objectType: 'subscription',
            objectId: 'sub_123',
            processingStatus: 'pending',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: null,
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeEventId: 'evt_sub_123',
            eventType: 'customer.subscription.updated',
            livemode: false,
            stripeAccountId: null,
            objectType: 'subscription',
            objectId: 'sub_123',
            processingStatus: 'processed',
            attemptCount: 1,
            lastError: null,
            receivedAt: new Date('2026-04-28T00:00:00.000Z'),
            processedAt: new Date('2026-04-28T00:00:01.000Z'),
            createdAt: new Date('2026-04-28T00:00:00.000Z'),
            updatedAt: new Date('2026-04-28T00:00:01.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().handleStripeWebhook(
        'test',
        Buffer.from('{"id":"evt_sub_123"}'),
        'sig_123'
      )
    ).resolves.toMatchObject({ received: true, handled: true });

    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.subscriptions/i),
      expect.arrayContaining(['test', 'sub_123', 'cus_123', 'organization', 'org_123', 'active'])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.subscription_items/i),
      expect.arrayContaining(['test', 'si_123', 'sub_123', 'prod_123', 'price_123', 1])
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('syncs existing Stripe subscriptions as unmapped when no billing subject exists', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 0, rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{ stripeAccountId: 'acct_123' }],
      })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [connectedTestConnectionRow] });
    mockProvider.listSubscriptions.mockResolvedValueOnce([
      {
        id: 'sub_existing',
        object: 'subscription',
        customer: 'cus_existing',
        status: 'active',
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false,
        cancel_at: null,
        canceled_at: null,
        trial_start: null,
        trial_end: null,
        latest_invoice: 'in_existing',
        metadata: {},
        items: {
          has_more: true,
          data: [
            {
              id: 'si_existing',
              object: 'subscription_item',
              current_period_start: 1777334400,
              current_period_end: 1779926400,
              quantity: 1,
              metadata: {},
              price: {
                id: 'price_existing',
                product: 'prod_existing',
              },
            },
          ],
        },
      } as unknown as StripeSubscription,
    ]);
    mockProvider.listSubscriptionItems.mockResolvedValueOnce([
      {
        id: 'si_existing',
        object: 'subscription_item',
        current_period_start: 1777334400,
        current_period_end: 1779926400,
        quantity: 1,
        metadata: {},
        price: {
          id: 'price_existing',
          product: 'prod_existing',
        },
      },
      {
        id: 'si_extra',
        object: 'subscription_item',
        current_period_start: 1777248000,
        current_period_end: 1780012800,
        quantity: 2,
        metadata: {},
        price: {
          id: 'price_extra',
          product: 'prod_extra',
        },
      },
    ]);

    await expect(
      PaymentService.getInstance().syncPayments({ environment: 'test' })
    ).resolves.toMatchObject({
      results: [
        {
          subscriptions: {
            environment: 'test',
            synced: 1,
            unmapped: 1,
            deleted: 0,
          },
        },
      ],
    });

    expect(mockProvider.listSubscriptions).toHaveBeenCalledTimes(1);
    expect(mockProvider.listSubscriptionItems).toHaveBeenCalledWith('sub_existing');
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'Stripe subscription projection is missing InsForge billing subject',
      expect.any(Object)
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.subscriptions/i),
      expect.arrayContaining(['test', 'sub_existing', 'cus_existing', null, null, 'active'])
    );
    const subscriptionInsertCall = mockClient.query.mock.calls.find(([sql]) =>
      /INSERT INTO payments\.subscriptions/i.test(String(sql))
    );
    expect(subscriptionInsertCall?.[1]).toEqual(
      expect.arrayContaining([new Date(1777248000 * 1000), new Date(1780012800 * 1000)])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.subscription_items/i),
      expect.arrayContaining([
        'test',
        'si_existing',
        'sub_existing',
        'prod_existing',
        'price_existing',
        1,
      ])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.subscription_items/i),
      expect.arrayContaining([
        'test',
        'si_extra',
        'sub_existing',
        'prod_extra',
        'price_extra',
        2,
      ])
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM payments\.subscription_items[\s\S]*NOT \(stripe_subscription_item_id = ANY/i
      ),
      ['test', 'sub_existing', ['si_existing', 'si_extra']]
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM payments\.subscriptions[\s\S]*NOT \(stripe_subscription_id = ANY/i
      ),
      ['test', ['sub_existing']]
    );
  });

  it('lists payment history for an environment and billing subject', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          type: 'one_time_payment',
          status: 'succeeded',
          subjectType: 'team',
          subjectId: 'team_123',
          stripeCustomerId: 'cus_123',
          customerEmailSnapshot: 'buyer@example.com',
          stripeCheckoutSessionId: 'cs_test_123',
          stripePaymentIntentId: 'pi_123',
          stripeInvoiceId: null,
          stripeChargeId: null,
          stripeRefundId: null,
          stripeSubscriptionId: null,
          stripeProductId: null,
          stripePriceId: 'price_123',
          amount: '4500',
          amountRefunded: null,
          currency: 'usd',
          description: null,
          paidAt: new Date('2026-04-28T00:00:00.000Z'),
          failedAt: null,
          refundedAt: null,
          stripeCreatedAt: new Date('2026-04-28T00:00:00.000Z'),
          createdAt: new Date('2026-04-28T00:00:01.000Z'),
          updatedAt: new Date('2026-04-28T00:00:01.000Z'),
        },
      ],
    });

    await expect(
      PaymentService.getInstance().listPaymentHistory({
        environment: 'test',
        subjectType: 'team',
        subjectId: 'team_123',
        limit: 25,
      })
    ).resolves.toEqual({
      paymentHistory: [
        {
          environment: 'test',
          type: 'one_time_payment',
          status: 'succeeded',
          subjectType: 'team',
          subjectId: 'team_123',
          stripeCustomerId: 'cus_123',
          customerEmailSnapshot: 'buyer@example.com',
          stripeCheckoutSessionId: 'cs_test_123',
          stripePaymentIntentId: 'pi_123',
          stripeInvoiceId: null,
          stripeChargeId: null,
          stripeRefundId: null,
          stripeSubscriptionId: null,
          stripeProductId: null,
          stripePriceId: 'price_123',
          amount: 4500,
          amountRefunded: null,
          currency: 'usd',
          description: null,
          paidAt: '2026-04-28T00:00:00.000Z',
          failedAt: null,
          refundedAt: null,
          stripeCreatedAt: '2026-04-28T00:00:00.000Z',
          createdAt: '2026-04-28T00:00:01.000Z',
          updatedAt: '2026-04-28T00:00:01.000Z',
        },
      ],
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/FROM payments\.payment_history/i),
      ['test', 'team', 'team_123', 25]
    );
  });

  it('lists subscriptions with their subscription items', async () => {
    mockPool.query
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeSubscriptionId: 'sub_123',
            stripeCustomerId: 'cus_123',
            subjectType: 'organization',
            subjectId: 'org_123',
            status: 'active',
            currentPeriodStart: new Date('2026-04-28T00:00:00.000Z'),
            currentPeriodEnd: new Date('2026-05-28T00:00:00.000Z'),
            cancelAtPeriodEnd: false,
            cancelAt: null,
            canceledAt: null,
            trialStart: null,
            trialEnd: null,
            latestInvoiceId: 'in_123',
            metadata: { plan: 'pro' },
            syncedAt: new Date('2026-04-28T00:00:02.000Z'),
            createdAt: new Date('2026-04-28T00:00:01.000Z'),
            updatedAt: new Date('2026-04-28T00:00:02.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            environment: 'test',
            stripeSubscriptionItemId: 'si_123',
            stripeSubscriptionId: 'sub_123',
            stripeProductId: 'prod_123',
            stripePriceId: 'price_123',
            quantity: '1',
            metadata: {},
            createdAt: new Date('2026-04-28T00:00:01.000Z'),
            updatedAt: new Date('2026-04-28T00:00:02.000Z'),
          },
        ],
      });

    await expect(
      PaymentService.getInstance().listSubscriptions({
        environment: 'test',
        subjectType: 'organization',
        subjectId: 'org_123',
        limit: 10,
      })
    ).resolves.toMatchObject({
      subscriptions: [
        {
          environment: 'test',
          stripeSubscriptionId: 'sub_123',
          subjectType: 'organization',
          subjectId: 'org_123',
          status: 'active',
          items: [
            {
              stripeSubscriptionItemId: 'si_123',
              stripeProductId: 'prod_123',
              stripePriceId: 'price_123',
              quantity: 1,
            },
          ],
        },
      ],
    });
  });
});
