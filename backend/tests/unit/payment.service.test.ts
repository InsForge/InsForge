import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeAccount, StripePrice, StripeProduct } from '../../src/types/payments';

const { mockPool, mockProvider, mockGetSecretByKey, mockEncrypt } = vi.hoisted(() => ({
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
    createCheckoutSession: vi.fn(),
    constructWebhookEvent: vi.fn(),
    listWebhookEndpoints: vi.fn(),
    createWebhookEndpoint: vi.fn(),
    deleteWebhookEndpoint: vi.fn(),
  },
  mockGetSecretByKey: vi.fn(),
  mockEncrypt: vi.fn(),
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

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { PaymentService } from '../../src/services/payments/payment.service';

describe('PaymentService', () => {
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

  it('upserts encrypted Stripe keys into the canonical secret names and syncs immediately', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_123', hasPaymentRows: true }],
    });

    await PaymentService.getInstance().setStripeSecretKey('test', ' sk_test_newsecret1234 ');

    expect(mockProvider.retrieveAccount).toHaveBeenCalledTimes(1);
    expect(mockEncrypt).toHaveBeenCalledWith('sk_test_newsecret1234');
    expect(mockProvider.listWebhookEndpoints).toHaveBeenCalledTimes(1);
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledWith({
      url: 'http://localhost:7130/api/webhooks/stripe/test',
      enabledEvents: [
        'checkout.session.completed',
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
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
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
  });

  it('recreates existing InsForge-managed Stripe webhooks when saving an environment key', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeAccountId: 'acct_123', hasPaymentRows: true }],
    });
    mockProvider.listWebhookEndpoints.mockResolvedValueOnce([
      {
        id: 'we_old',
        object: 'webhook_endpoint',
        url: 'http://localhost:7130/api/webhooks/stripe/test',
        metadata: {
          managed_by: 'insforge',
          insforge_webhook: 'stripe_payments',
          insforge_environment: 'test',
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
    expect(mockProvider.deleteWebhookEndpoint).not.toHaveBeenCalledWith('we_developer');
    expect(mockProvider.createWebhookEndpoint).toHaveBeenCalledTimes(1);
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
        rows: [{ stripeAccountId: 'acct_old', hasPaymentRows: true }],
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

  it('soft-removes Stripe keys from the secret store', async () => {
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
    expect(mockClient.query).toHaveBeenCalledWith(
      'DELETE FROM payments.prices WHERE environment = $1',
      ['live']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
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

    const result = await PaymentService.getInstance().syncEnvironment('live');

    expect(result.status).toBe('unconfigured');
    expect(result.lastSyncStatus).toBe('failed');
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
    mockPool.connect.mockResolvedValueOnce(mockLockClient).mockResolvedValueOnce(mockSyncClient);
    mockPool.query.mockResolvedValueOnce({
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

    const result = await PaymentService.getInstance().syncEnvironment('test');

    expect(result.status).toBe('connected');
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

  it('creates products with the requested Stripe key and refreshes that environment mirror', async () => {
    mockGetSecretByKey.mockResolvedValue('sk_live_1234567890');
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient);
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
    });

    expect(mockProvider.createProduct).toHaveBeenCalledWith({
      name: 'New Product',
      active: true,
      metadata: { tier: 'new' },
    });
    expect(mockGetSecretByKey).toHaveBeenCalledWith('STRIPE_LIVE_SECRET_KEY');
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
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
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(2);
  });

  it('lists prices from the requested local Stripe mirror with an optional product filter', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
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
        {
          environment: 'test',
          stripePriceId: 'price_other',
          stripeProductId: 'prod_other',
          active: true,
          currency: 'usd',
          unitAmount: 2500,
          unitAmountDecimal: null,
          type: 'one_time',
          lookupKey: null,
          billingScheme: 'per_unit',
          taxBehavior: null,
          recurringInterval: null,
          recurringIntervalCount: null,
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
    });
    expect(mockProvider.updatePrice).toHaveBeenCalledWith('price_123', {
      active: false,
      metadata: { archived: 'true' },
    });
    expect(mockProvider.updatePrice).toHaveBeenCalledWith('price_123', { active: false });
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(3);
  });

  it('rejects subscription checkout without a billing subject', async () => {
    await expect(
      PaymentService.getInstance().createCheckoutSession({
        environment: 'test',
        mode: 'subscription',
        lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      })
    ).rejects.toThrow(/billing subject/i);

    expect(mockProvider.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('creates a Stripe customer mapping before identified checkout', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
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
      PaymentService.getInstance().createCheckoutSession({
        environment: 'test',
        mode: 'subscription',
        lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        customerEmail: 'buyer@example.com',
        subject: { type: 'team', id: 'team_123' },
        metadata: { plan: 'pro' },
      })
    ).resolves.toMatchObject({
      checkoutSession: {
        environment: 'test',
        stripeCheckoutSessionId: 'cs_test_123',
        mode: 'subscription',
        stripeCustomerId: 'cus_123',
      },
    });

    expect(mockProvider.createCustomer).toHaveBeenCalledWith({
      email: 'buyer@example.com',
      metadata: {
        plan: 'pro',
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_123',
      },
    });
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.stripe_customer_mappings/i),
      [
        'test',
        'team',
        'team_123',
        'cus_123',
        'buyer@example.com',
        {
          plan: 'pro',
          insforge_subject_type: 'team',
          insforge_subject_id: 'team_123',
        },
        expect.objectContaining({ id: 'cus_123' }),
      ]
    );
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith({
      mode: 'subscription',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerId: 'cus_123',
      customerEmail: null,
      metadata: {
        plan: 'pro',
        insforge_subject_type: 'team',
        insforge_subject_id: 'team_123',
      },
    });
  });

  it('reuses an existing Stripe customer mapping for identified checkout', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(mockClient);
    mockPool.query.mockResolvedValueOnce({
      rows: [{ stripeCustomerId: 'cus_existing' }],
    });

    await PaymentService.getInstance().createCheckoutSession({
      environment: 'test',
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      subject: { type: 'organization', id: 'org_123' },
    });

    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_existing',
        customerEmail: null,
        metadata: {
          insforge_subject_type: 'organization',
          insforge_subject_id: 'org_123',
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

    await PaymentService.getInstance().createCheckoutSession({
      environment: 'test',
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerEmail: 'anon@example.com',
    });

    expect(mockProvider.createCustomer).not.toHaveBeenCalled();
    expect(mockProvider.createCheckoutSession).toHaveBeenCalledWith({
      mode: 'payment',
      lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
      customerId: null,
      customerEmail: 'anon@example.com',
      metadata: {},
    });
    expect(mockPool.query).not.toHaveBeenCalledWith(
      expect.stringMatching(/payments\.stripe_customer_mappings/i),
      expect.any(Array)
    );
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
      expect.stringMatching(/INSERT INTO payments\.payment_history/i),
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
        expect.any(Date),
        new Date('2026-04-28T00:00:00.000Z'),
        expect.objectContaining({ id: 'cs_test_123' }),
      ]
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
