import { createHash } from 'node:crypto';
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

function fingerprintOf(secretKey: string): string {
  return createHash('sha256').update(secretKey).digest('hex');
}

function buildConnectionRow(overrides: Record<string, unknown> = {}) {
  return {
    environment: 'test',
    status: 'connected',
    accountId: null,
    accountEmail: null,
    accountLivemode: false,
    webhookEndpointUrl: null,
    webhookConfiguredAt: null,
    lastSyncedAt: null,
    lastSyncStatus: null,
    lastSyncError: null,
    lastSyncCounts: {},
    ...overrides,
  };
}

/**
 * Route pool queries by shape: the fingerprint lookup (raw->>'secretKeyFingerprint'),
 * then the public connection-row select.
 */
function mockPoolQueries({
  storedFingerprint = null,
  connectionRows = { test: buildConnectionRow() } as Record<string, unknown>,
}: {
  storedFingerprint?: string | null;
  connectionRows?: Record<string, unknown>;
} = {}) {
  mockPool.query.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const text = String(sql);
    if (/secretKeyFingerprint/.test(text)) {
      return storedFingerprint
        ? { rows: [{ secretKeyFingerprint: storedFingerprint }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/SELECT[\s\S]*FROM payments\.provider_connections/i.test(text)) {
      const environment = String(params?.[0]);
      const row = connectionRows[environment];
      return row ? { rows: [row], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });
}

function expectPaystackScopedDelete(tableName: string, params: unknown[]) {
  expect(mockClient.query).toHaveBeenCalledWith(
    expect.stringMatching(new RegExp(`DELETE FROM payments\\.${tableName}`, 'i')),
    params
  );
}

function getExecutedClientSql(): string {
  return mockClient.query.mock.calls.map(([sql]) => String(sql)).join('\n');
}

describe('PaystackConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.API_BASE_URL;
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockPool.connect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
    mockGetSecretByKey.mockResolvedValue(null);
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

  it('clears stale Paystack data and upserts keys after a secret key fingerprint change', async () => {
    mockPoolQueries({ storedFingerprint: fingerprintOf('sk_test_old_secret_key') });

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
      ['test', null, null, false, true, fingerprintOf('sk_test_new_secret_key')]
    );
  });

  it('does not clear payment data when the same secret key is saved again', async () => {
    mockPoolQueries({ storedFingerprint: fingerprintOf('sk_test_same_secret_key') });

    await PaystackConfigService.getInstance().setPaystackKeys(
      'test',
      'sk_test_same_secret_key',
      'pk_test_new_public_key'
    );

    const executedSql = getExecutedClientSql();
    expect(executedSql).not.toMatch(/DELETE FROM payments\.paystack_transactions/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.transactions/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.customers/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.customer_mappings/i);
    expect(executedSql).not.toMatch(/DELETE FROM payments\.webhook_events/i);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.provider_connections[\s\S]*VALUES \('paystack'/i
      ),
      ['test', null, null, false, false, fingerprintOf('sk_test_same_secret_key')]
    );
  });

  it('persists a fingerprint instead of the raw secret key on the connection row', async () => {
    mockPoolQueries();

    await PaystackConfigService.getInstance().setPaystackKeys('test', 'sk_test_new_secret_key');

    const connectionUpsert = mockClient.query.mock.calls.find(([sql]) =>
      /INSERT INTO payments\.provider_connections/i.test(String(sql))
    );
    expect(connectionUpsert).toBeDefined();
    const [sql, params] = connectionUpsert as [string, unknown[]];
    expect(sql).toMatch(/jsonb_build_object\('secretKeyFingerprint', \$6::TEXT\)/);
    expect(params).toContain(fingerprintOf('sk_test_new_secret_key'));
    expect(params).not.toContain('sk_test_new_secret_key');
  });

  it('does not wipe data when the same key is re-added after removal', async () => {
    // removePaystackKeys deactivates the secrets but the fingerprint survives on
    // the connection row, so re-adding the identical key must not clear data.
    mockPoolQueries({ storedFingerprint: fingerprintOf('sk_test_original_key') });
    mockGetSecretByKey.mockResolvedValue(null); // secrets were deactivated by removal

    await PaystackConfigService.getInstance().setPaystackKeys('test', 'sk_test_original_key');

    expect(getExecutedClientSql()).not.toMatch(/DELETE FROM payments\./i);
  });

  it('wipes data when a different key is added after removal', async () => {
    mockPoolQueries({ storedFingerprint: fingerprintOf('sk_test_account_a_key') });
    mockGetSecretByKey.mockResolvedValue(null); // secrets were deactivated by removal

    await PaystackConfigService.getInstance().setPaystackKeys('test', 'sk_test_account_b_key');

    expectPaystackScopedDelete('paystack_transactions', ['test']);
    expectPaystackScopedDelete('customers', ['test', 'paystack']);
  });

  it('preserves the stored fingerprint when keys are removed', async () => {
    mockClient.query.mockImplementation(async (sql: unknown) => {
      if (/UPDATE system\.secrets/i.test(String(sql))) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await PaystackConfigService.getInstance().removePaystackKeys('test');

    const connectionUpdate = mockClient.query.mock.calls.find(([sql]) =>
      /UPDATE payments\.provider_connections/i.test(String(sql))
    );
    expect(connectionUpdate).toBeDefined();
    // The unconfigure update must not touch `raw`, or the fingerprint used to
    // detect account changes across remove/re-add would be lost.
    expect(String(connectionUpdate?.[0])).not.toMatch(/\braw\b/);
  });

  it('builds the Paystack webhook URL and records manual webhook setup', async () => {
    process.env.API_BASE_URL = 'https://api.example.test/';
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'PAYSTACK_TEST_SECRET_KEY') {
        return 'sk_test_configured_key';
      }
      return null;
    });
    mockPoolQueries({
      connectionRows: {
        test: buildConnectionRow({
          webhookEndpointUrl: 'https://api.example.test/api/webhooks/paystack/test',
          webhookConfiguredAt: new Date('2026-06-10T00:00:00.000Z'),
        }),
      },
    });

    const setup = await PaystackConfigService.getInstance().getWebhookSetup('test');

    expect(setup.webhookUrl).toBe('https://api.example.test/api/webhooks/paystack/test');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /INSERT INTO payments\.provider_connections[\s\S]*VALUES \('paystack'/i
      ),
      ['test', 'https://api.example.test/api/webhooks/paystack/test']
    );
    // The webhook endpoint serializes the public connection shape.
    expect(setup.connection).toEqual({
      environment: 'test',
      status: 'connected',
      accountId: null,
      accountEmail: null,
      accountLivemode: false,
      webhookEndpointUrl: 'https://api.example.test/api/webhooks/paystack/test',
      webhookConfiguredAt: '2026-06-10T00:00:00.000Z',
      maskedKey: 'masked:_key',
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncCounts: {},
    });
  });

  it('serializes status connections publicly with maskedKey and no internal ids', async () => {
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'PAYSTACK_TEST_SECRET_KEY') {
        return 'sk_test_secret_key_1234';
      }
      return null;
    });
    mockPoolQueries({
      connectionRows: {
        test: buildConnectionRow({
          accountEmail: 'merchant@example.test',
          lastSyncedAt: new Date('2026-06-11T00:00:00.000Z'),
          lastSyncStatus: 'succeeded',
        }),
      },
    });

    const connections = await PaystackConfigService.getInstance().getPaystackStatus();

    expect(connections).toEqual([
      {
        environment: 'test',
        status: 'connected',
        accountId: null,
        accountEmail: 'merchant@example.test',
        accountLivemode: false,
        webhookEndpointUrl: null,
        webhookConfiguredAt: null,
        maskedKey: 'masked:1234',
        lastSyncedAt: '2026-06-11T00:00:00.000Z',
        lastSyncStatus: 'succeeded',
        lastSyncError: null,
        lastSyncCounts: {},
      },
      {
        environment: 'live',
        status: 'unconfigured',
        accountId: null,
        accountEmail: null,
        accountLivemode: null,
        webhookEndpointUrl: null,
        webhookConfiguredAt: null,
        maskedKey: null,
        lastSyncedAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncCounts: {},
      },
    ]);
    for (const connection of connections) {
      expect(connection).not.toHaveProperty('secretKeyId');
      expect(connection).not.toHaveProperty('publicKeyId');
      expect(connection).not.toHaveProperty('id');
      expect(connection).not.toHaveProperty('raw');
    }
  });

  it('returns raw key config values for the admin settings panel', async () => {
    // Raw (not masked) values are required: the settings panel hydrates and
    // resaves these values, so masking would corrupt stored keys on resave.
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
      { environment: 'test', keyType: 'secret_key', value: 'sk_test_secret_key_1234' },
      { environment: 'test', keyType: 'public_key', value: 'pk_test_public_key_5678' },
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
