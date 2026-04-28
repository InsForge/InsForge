import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeAccount, StripePrice, StripeProduct } from '../../src/types/payments';

const { mockPool, mockProvider, mockGetSecretByKey, mockEncrypt } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockProvider: {
    syncCatalog: vi.fn(),
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
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
  });
});
