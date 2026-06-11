import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockPool,
  mockClient,
  mockProvider,
  mockGetSecretByKey,
  mockEncrypt,
  mockWithPaymentSessionAdvisoryLock,
} = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockProvider: {
    retrieveAccount: vi.fn(),
  },
  mockGetSecretByKey: vi.fn(),
  mockEncrypt: vi.fn(),
  mockWithPaymentSessionAdvisoryLock: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/payments/payments-advisory-lock', () => ({
  withPaymentSessionAdvisoryLock: mockWithPaymentSessionAdvisoryLock,
}));

vi.mock('../../src/providers/payments/razorpay.provider', () => ({
  RazorpayProvider: vi.fn(function () {
    return mockProvider;
  }),
  validateRazorpayKey: (environment: 'test' | 'live', value: string) => {
    const prefix = environment === 'test' ? 'rzp_test_' : 'rzp_live_';
    if (!value.startsWith(prefix)) {
      throw new Error(`Razorpay key ID must start with ${prefix}`);
    }
  },
  maskRazorpayKey: (key: string) => `masked:${key.slice(-4)}`,
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
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { RazorpayConfigService } from '../../src/services/payments/razorpay/config.service';

function expectRazorpayScopedDelete(tableName: string, params: unknown[]) {
  expect(mockClient.query).toHaveBeenCalledWith(
    expect.stringMatching(
      new RegExp(`DELETE FROM payments\\.${tableName}[\\s\\S]*provider\\s*=\\s*\\$2`, 'i')
    ),
    params
  );
}

function expectRazorpayRuntimeDelete(tableName: string, params: unknown[]) {
  expect(mockClient.query).toHaveBeenCalledWith(
    expect.stringMatching(new RegExp(`DELETE FROM payments\\.${tableName}`, 'i')),
    params
  );
}

function expectRazorpayTransactionDelete() {
  expect(mockClient.query).toHaveBeenCalledWith(
    expect.stringMatching(/DELETE FROM payments\.transactions[\s\S]*provider\s*=\s*\$1/i),
    ['razorpay', 'test']
  );
}

describe('RazorpayConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_BASE_URL;
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockProvider.retrieveAccount.mockResolvedValue({
      id: 'rzp_test_new',
      merchantName: 'New Merchant',
      livemode: false,
    });
    mockEncrypt.mockImplementation((value: string) => `encrypted:${value}`);
    mockWithPaymentSessionAdvisoryLock.mockImplementation(
      async (_pool: unknown, _lockName: string, task: () => Promise<unknown>) => task()
    );
  });

  it('clears stale Razorpay data and syncs after an account key change', async () => {
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'RAZORPAY_TEST_KEY_ID') {
        return 'rzp_test_old';
      }
      if (key === 'RAZORPAY_TEST_KEY_SECRET') {
        return 'old_secret';
      }
      return null;
    });
    mockPool.query.mockResolvedValueOnce({ rows: [{ accountId: 'rzp_test_old' }], rowCount: 1 });
    const syncAfterKeyChange = vi.fn().mockResolvedValue(undefined);

    await RazorpayConfigService.getInstance().setRazorpayKeys(
      'test',
      'rzp_test_new',
      'new_secret',
      undefined,
      syncAfterKeyChange
    );

    expect(mockWithPaymentSessionAdvisoryLock).toHaveBeenCalledWith(
      mockPool,
      'payments_razorpay_environment_test',
      expect.any(Function)
    );
    expectRazorpayRuntimeDelete('razorpay_subscriptions', ['test']);
    expectRazorpayTransactionDelete();
    expectRazorpayRuntimeDelete('razorpay_orders', ['test']);
    expectRazorpayScopedDelete('customers', ['test', 'razorpay']);
    expectRazorpayScopedDelete('customer_mappings', ['test', 'razorpay']);
    expectRazorpayScopedDelete('webhook_events', ['test', 'razorpay']);
    expectRazorpayRuntimeDelete('razorpay_plans', ['test']);
    expectRazorpayRuntimeDelete('razorpay_items', ['test']);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.provider_connections/i),
      ['test', 'rzp_test_new', 'New Merchant', false, true]
    );
    expect(syncAfterKeyChange).toHaveBeenCalledWith('test', mockProvider);
  });

  it('does not clear or sync when the same Razorpay keys are saved again', async () => {
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'RAZORPAY_TEST_KEY_ID') {
        return 'rzp_test_same';
      }
      if (key === 'RAZORPAY_TEST_KEY_SECRET') {
        return 'same_secret';
      }
      return null;
    });
    mockPool.query.mockResolvedValueOnce({ rows: [{ accountId: 'rzp_test_same' }], rowCount: 1 });
    mockProvider.retrieveAccount.mockResolvedValue({
      id: 'rzp_test_same',
      merchantName: 'Same Merchant',
      livemode: false,
    });
    const syncAfterKeyChange = vi.fn().mockResolvedValue(undefined);

    await RazorpayConfigService.getInstance().setRazorpayKeys(
      'test',
      'rzp_test_same',
      'same_secret',
      undefined,
      syncAfterKeyChange
    );

    const executedSql = mockClient.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).not.toMatch(/DELETE FROM payments\.razorpay_/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.customers/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.customer_mappings/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.webhook_events/i);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.provider_connections/i),
      ['test', 'rzp_test_same', 'Same Merchant', false, false]
    );
    expect(syncAfterKeyChange).not.toHaveBeenCalled();
  });

  it('serializes Razorpay key removal with the environment advisory lock', async () => {
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });

    await RazorpayConfigService.getInstance().removeRazorpayKeys('test');

    expect(mockWithPaymentSessionAdvisoryLock).toHaveBeenCalledWith(
      mockPool,
      'payments_razorpay_environment_test',
      expect.any(Function)
    );
  });

  it('normalizes trailing slashes when preparing the Razorpay webhook URL', async () => {
    process.env.API_BASE_URL = 'https://api.example.test/';
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'RAZORPAY_TEST_KEY_ID') {
        return 'rzp_test_key';
      }
      if (key === 'RAZORPAY_TEST_KEY_SECRET') {
        return 'secret';
      }
      if (key === 'RAZORPAY_TEST_WEBHOOK_SECRET') {
        return 'whsec_123';
      }
      return null;
    });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
      rows: [
        {
          environment: 'test',
          status: 'connected',
          accountId: 'acc_123',
          merchantName: 'Merchant',
          accountLivemode: false,
          webhookEndpointId: 'manual',
          webhookEndpointUrl: 'https://api.example.test/api/webhooks/razorpay/test',
          webhookConfiguredAt: new Date('2026-06-10T00:00:00.000Z'),
          lastSyncedAt: null,
          lastSyncStatus: null,
          lastSyncError: null,
          lastSyncCounts: null,
        },
      ],
      rowCount: 1,
    });

    const setup = await RazorpayConfigService.getInstance().getWebhookSetup('test');

    expect(setup.webhookUrl).toBe('https://api.example.test/api/webhooks/razorpay/test');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO payments\.provider_connections/i),
      ['test', 'https://api.example.test/api/webhooks/razorpay/test']
    );
  });
});
