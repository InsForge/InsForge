import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockIsCloudEnvironment = vi.fn();
const mockListSecrets = vi.fn();
const mockGetSecretByKey = vi.fn();

vi.mock('../../src/utils/environment.js', () => ({
  isCloudEnvironment: mockIsCloudEnvironment,
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      listSecrets: mockListSecrets,
      getSecretByKey: mockGetSecretByKey,
    }),
  },
}));

vi.mock('../../src/providers/functions/deno-subhosting.provider.js', () => ({
  DenoSubhostingProvider: {
    getInstance: () => ({
      isConfigured: vi.fn().mockReturnValue(false),
    }),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: vi.fn(),
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

describe('FunctionService cloud secret behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSecrets.mockResolvedValue([
      { key: 'INSFORGE_INTERNAL_URL', isActive: true },
      { key: 'INSFORGE_BASE_URL', isActive: true },
    ]);
    mockGetSecretByKey.mockImplementation(async (key: string) => {
      if (key === 'INSFORGE_INTERNAL_URL') {
        return 'http://insforge:7130';
      }
      if (key === 'INSFORGE_BASE_URL') {
        return 'https://api.example.com';
      }
      return null;
    });
  });

  it('rewrites INSFORGE_INTERNAL_URL to INSFORGE_BASE_URL in cloud', async () => {
    mockIsCloudEnvironment.mockReturnValue(true);

    const { FunctionService } = await import('../../src/services/functions/function.service.js');
    const service = FunctionService.getInstance() as unknown as {
      getFunctionSecrets: () => Promise<Record<string, string>>;
    };

    const secrets = await service.getFunctionSecrets();

    expect(secrets.INSFORGE_INTERNAL_URL).toBe('https://api.example.com');
  });

  it('preserves INSFORGE_INTERNAL_URL in OSS', async () => {
    mockIsCloudEnvironment.mockReturnValue(false);

    const { FunctionService } = await import('../../src/services/functions/function.service.js');
    const service = FunctionService.getInstance() as unknown as {
      getFunctionSecrets: () => Promise<Record<string, string>>;
    };

    const secrets = await service.getFunctionSecrets();

    expect(secrets.INSFORGE_INTERNAL_URL).toBe('http://insforge:7130');
  });
});
