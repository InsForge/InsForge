import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeAccount, StripePrice, StripeProduct } from '../../src/types/payments';

const { mockPool, mockProvider, mockGetSecretByKey, mockEncrypt } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockProvider: {
    syncCatalog: vi.fn(),
    createProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    createPrice: vi.fn(),
    updatePrice: vi.fn(),
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

  it('upserts encrypted Stripe keys into the canonical secret names', async () => {
    await PaymentService.getInstance().setStripeSecretKey('test', ' sk_test_newsecret1234 ');

    expect(mockEncrypt).toHaveBeenCalledWith('sk_test_newsecret1234');
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringMatching(/system\.secrets/i), [
      'STRIPE_TEST_SECRET_KEY',
      'encrypted-secret',
    ]);
  });

  it('soft-removes Stripe keys from the secret store', async () => {
    await expect(PaymentService.getInstance().removeStripeSecretKey('live')).resolves.toBe(true);

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringMatching(/UPDATE system\.secrets/i), [
      'STRIPE_LIVE_SECRET_KEY',
    ]);
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
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient);
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
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.prices/i),
      ['test', expect.any(Date)]
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM payments\.products/i),
      ['test', expect.any(Date)]
    );
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });

  it('lists test products from the local Stripe mirror', async () => {
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

    await expect(PaymentService.getInstance().listTestProducts()).resolves.toEqual({
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

  it('creates products only with the Stripe test key and refreshes the test mirror', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValueOnce(mockClient);
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

    const result = await PaymentService.getInstance().createTestProduct({
      name: 'New Product',
      active: true,
      metadata: { tier: 'new' },
    });

    expect(mockProvider.createProduct).toHaveBeenCalledWith({
      name: 'New Product',
      active: true,
      metadata: { tier: 'new' },
    });
    expect(mockGetSecretByKey).toHaveBeenCalledWith('STRIPE_TEST_SECRET_KEY');
    expect(mockGetSecretByKey).not.toHaveBeenCalledWith('STRIPE_LIVE_SECRET_KEY');
    expect(mockProvider.syncCatalog).toHaveBeenCalledTimes(1);
    expect(result.product).toMatchObject({
      environment: 'test',
      stripeProductId: 'prod_new',
      name: 'New Product',
      active: true,
    });
  });

  it('updates and deletes products through the Stripe test provider', async () => {
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
      PaymentService.getInstance().updateTestProduct('prod_123', {
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

    await expect(PaymentService.getInstance().deleteTestProduct('prod_123')).resolves.toEqual({
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

  it('lists test prices from the local Stripe mirror with an optional product filter', async () => {
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
      PaymentService.getInstance().listTestPrices({ stripeProductId: 'prod_123' })
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

  it('creates, updates, and archives prices through the Stripe test provider', async () => {
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
      PaymentService.getInstance().createTestPrice({
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
      PaymentService.getInstance().updateTestPrice('price_123', {
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

    await expect(PaymentService.getInstance().archiveTestPrice('price_123')).resolves.toMatchObject(
      {
        price: {
          environment: 'test',
          stripePriceId: 'price_123',
          active: false,
        },
        archived: true,
      }
    );

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
});
