import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

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

vi.mock('../../src/providers/payments/paystack.provider', () => ({
  PaystackProvider: vi.fn(function () {
    return mockProvider;
  }),
  validatePaystackKey: (environment: 'test' | 'live', key: string) => {
    const base = key.startsWith('pk_') ? 'pk' : 'sk';
    const prefix = `${base}_${environment}_`;
    if (!key.startsWith(prefix)) {
      throw new Error(`Paystack key must start with "${prefix}"`);
    }
  },
  maskPaystackKey: (key: string) => `masked:${key.slice(-4)}`,
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

import { PaystackConfigService } from '../../src/services/payments/paystack/config.service';

function buildConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn_123',
    environment: 'test',
    status: 'connected',
    accountId: null,
    accountEmail: null,
    accountLivemode: false,
    webhookEndpointUrl: null,
    secretKeyId: 'secret_row_123',
    publicKeyId: null,
    webhookConfiguredAt: null,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncCounts: {},
    raw: {},
    createdAt: new Date('2026-06-10T00:00:00.000Z'),
    updatedAt: new Date('2026-06-10T00:00:00.000Z'),
    ...overrides,
  };
}

function expectPaystackScopedDelete(tableName: string, params: unknown[]) {
  expect(mockClient.query).toHaveBeenCalledWith(
    expect.stringMatching(new RegExp(`DELETE FROM payments\\.${tableName}`, 'i')),
    params
  );
}

describe('PaystackConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_BASE_URL;
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockProvider.retrieveAccount.mockResolvedValue({
      id: null,
      accountEmail: null,
      livemode: false,
    });
    mockEncrypt.mockImplementation((value: string) => `encrypted:${value}`);
    mockWithPaymentSessionAdvisoryLock.mockImplementation(
      async (_pool: unknown, _lockName: string, task: () => Promise<unknown>) => task()
    );
  });

  it('clears stale Paystack data and upserts keys after a secret key change', async () => {
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'PAYSTACK_TEST_SECRET_KEY') {
        return 'sk_test_old_secret_key';
      }
      return null;
    });
    mockPool.query.mockResolvedValue({ rows: [buildConnectionRow()], rowCount: 1 });

    await PaystackConfigService.getInstance().setPaystackKeys(
      'test',
      'sk_test_new_secret_key',
      'pk_test_new_public_key'
    );

    expect(mockWithPaymentSessionAdvisoryLock).toHaveBeenCalledWith(
      mockPool,
      'payments_paystack_environment_test',
      expect.any(Function)
    );
    expectPaystackScopedDelete('paystack_transactions', ['test']);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /DELETE FROM payments\.transactions[\s\S]*provider\s*=\s*\$1[\s\S]*environment\s*=\s*\$2/i
      ),
      ['paystack', 'test']
    );
    expectPaystackScopedDelete('customers', ['test', 'paystack']);
    expectPaystackScopedDelete('customer_mappings', ['test', 'paystack']);
    expectPaystackScopedDelete('webhook_events', ['test', 'paystack']);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO system\.secrets/i),
      ['PAYSTACK_TEST_SECRET_KEY', 'encrypted:sk_test_new_secret_key']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(/INSERT INTO system\.secrets/i),
      ['PAYSTACK_TEST_PUBLIC_KEY', 'encrypted:pk_test_new_public_key']
    );
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.provider_connections[\s\S]*VALUES \('paystack'/i
      ),
      ['test', null, null, false, true]
    );
  });

  it('does not clear payment data when the same secret key is saved again', async () => {
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'PAYSTACK_TEST_SECRET_KEY') {
        return 'sk_test_same_secret_key';
      }
      return null;
    });
    mockPool.query.mockResolvedValue({ rows: [buildConnectionRow()], rowCount: 1 });

    await PaystackConfigService.getInstance().setPaystackKeys(
      'test',
      'sk_test_same_secret_key',
      'pk_test_new_public_key'
    );

    const executedSql = mockClient.query.mock.calls.map(([sql]) => String(sql)).join('\n');
    expect(executedSql).not.toMatch(/DELETE FROM payments\.paystack_transactions/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.transactions/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.customers/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.customer_mappings/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.webhook_events/i);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.provider_connections[\s\S]*VALUES \('paystack'/i
      ),
      ['test', null, null, false, false]
    );
  });

  it('builds the Paystack webhook URL and records manual webhook setup', async () => {
    process.env.API_BASE_URL = 'https://api.example.test/';
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'PAYSTACK_TEST_SECRET_KEY') {
        return 'sk_test_configured_key';
      }
      return null;
    });
    mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 }).mockResolvedValueOnce({
      rows: [
        buildConnectionRow({
          webhookEndpointUrl: 'https://api.example.test/api/webhooks/paystack/test',
          webhookConfiguredAt: new Date('2026-06-10T00:00:00.000Z'),
        }),
      ],
      rowCount: 1,
    });

    const setup = await PaystackConfigService.getInstance().getWebhookSetup('test');

    expect(setup.webhookUrl).toBe('https://api.example.test/api/webhooks/paystack/test');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.provider_connections[\s\S]*VALUES \('paystack'/i
      ),
      ['test', 'https://api.example.test/api/webhooks/paystack/test']
    );
  });

  it('returns masked key config values for both environments', async () => {
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'PAYSTACK_TEST_SECRET_KEY') {
        return 'sk_test_secret_key_1234';
      }
      if (key === 'PAYSTACK_TEST_PUBLIC_KEY') {
        return 'pk_test_public_key_5678';
      }
      return null;
    });

    const keys = await PaystackConfigService.getInstance().getKeyConfig();

    expect(keys).toEqual([
      { environment: 'test', keyType: 'secret_key', value: 'masked:1234' },
      { environment: 'test', keyType: 'public_key', value: 'masked:5678' },
      { environment: 'live', keyType: 'secret_key', value: null },
      { environment: 'live', keyType: 'public_key', value: null },
    ]);
  });

  it('refuses to create a provider when Paystack keys are not configured', async () => {
    mockGetSecretByKey.mockResolvedValue(null);

    await expect(
      PaystackConfigService.getInstance().createPaystackProvider('test')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.PAYMENT_CONFIG_NOT_FOUND,
      message: 'Paystack test keys are not configured',
    });
  });
});
