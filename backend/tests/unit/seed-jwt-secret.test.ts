import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetSecretByKey = vi.fn();
const mockCreateSecret = vi.fn();
const mockInitializeApiKey = vi.fn().mockResolvedValue('api-key');
const mockIsCloudEnvironment = vi.fn();
const mockGetApiBaseUrl = vi.fn().mockReturnValue('https://api.example.com');
const mockGenerateAnonToken = vi.fn().mockReturnValue('anon-token');
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn().mockResolvedValue({
  query: mockClientQuery,
  release: mockClientRelease,
});
const mockGetUserTables = vi.fn().mockResolvedValue([]);
const mockSeedStripeKeysFromEnv = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      getSecretByKey: mockGetSecretByKey,
      createSecret: mockCreateSecret,
      initializeApiKey: mockInitializeApiKey,
    }),
  },
}));

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: mockIsCloudEnvironment,
  getApiBaseUrl: mockGetApiBaseUrl,
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAnonToken: mockGenerateAnonToken,
    }),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        connect: mockConnect,
      }),
      getUserTables: mockGetUserTables,
    }),
  },
}));

vi.mock('../../src/services/payments/payment.service.js', () => ({
  PaymentService: {
    getInstance: () => ({
      seedStripeKeysFromEnv: mockSeedStripeKeysFromEnv,
    }),
  },
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: {
    getInstance: () => ({
      getAllConfigs: vi.fn().mockResolvedValue([]),
      createConfig: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      getConfig: vi.fn().mockResolvedValue(null),
      updateConfig: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('seedBackend secret initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientQuery.mockResolvedValue({ rows: [] });
    mockGetUserTables.mockResolvedValue([]);
    process.env.ADMIN_EMAIL = 'admin@example.com';
    process.env.ADMIN_PASSWORD = 'change-this-password';
    process.env.JWT_SECRET = 'jwt-secret';
  });

  it('seeds INSFORGE_INTERNAL_URL in OSS environments', async () => {
    mockIsCloudEnvironment.mockReturnValue(false);
    mockGetSecretByKey.mockResolvedValue(null);

    const { seedBackend } = await import('../../src/utils/seed.js');

    await seedBackend();

    expect(mockCreateSecret).toHaveBeenCalledWith({
      key: 'INSFORGE_INTERNAL_URL',
      isReserved: true,
      value: 'http://insforge:7130',
    });
  });

  it('skips INSFORGE_INTERNAL_URL in cloud but still seeds JWT_SECRET when missing', async () => {
    mockIsCloudEnvironment.mockReturnValue(true);
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'JWT_SECRET') {
        return null;
      }
      return null;
    });

    const { seedBackend } = await import('../../src/utils/seed.js');

    await seedBackend();

    expect(mockCreateSecret).not.toHaveBeenCalledWith(
      expect.objectContaining({ key: 'INSFORGE_INTERNAL_URL' })
    );
    expect(mockCreateSecret).toHaveBeenCalledWith({
      key: 'JWT_SECRET',
      isReserved: true,
      value: 'jwt-secret',
    });
  });
});
