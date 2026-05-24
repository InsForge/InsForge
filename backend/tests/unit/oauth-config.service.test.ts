import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool, mockSecretService } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
    query: vi.fn(),
  },
  mockSecretService: {
    createSecret: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => mockSecretService,
  },
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger,
}));

import { OAuthConfigService } from '../../src/services/auth/oauth-config.service';

describe('OAuthConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('createConfig', () => {
    it('creates OAuth config with extraAuthorizeParams', async () => {
      mockSecretService.createSecret.mockResolvedValue({ id: 'secret-123' });

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }

        if (/SELECT id FROM auth\.oauth_configs/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        if (/INSERT INTO auth\.oauth_configs/i.test(sql)) {
          return {
            rows: [
              {
                id: 'test-id',
                provider: 'google',
                clientId: 'test-client-id',
                redirectUri: null,
                scopes: ['openid', 'email', 'profile'],
                useSharedKey: false,
                extraAuthorizeParams: { prompt: 'select_account' },
                createdAt: '2026-05-24T00:00:00Z',
                updatedAt: '2026-05-24T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      });

      const service = OAuthConfigService.getInstance();
      const result = await service.createConfig({
        provider: 'google',
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
        scopes: ['openid', 'email', 'profile'],
        useSharedKey: false,
        extraAuthorizeParams: { prompt: 'select_account' },
      });

      expect(result.extraAuthorizeParams).toEqual({ prompt: 'select_account' });
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('creates OAuth config with null extraAuthorizeParams when not provided', async () => {
      mockSecretService.createSecret.mockResolvedValue({ id: 'secret-456' });

      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }

        if (/SELECT id FROM auth\.oauth_configs/i.test(sql)) {
          return { rows: [], rowCount: 0 };
        }

        if (/INSERT INTO auth\.oauth_configs/i.test(sql)) {
          return {
            rows: [
              {
                id: 'test-id',
                provider: 'google',
                clientId: 'test-client-id',
                redirectUri: null,
                scopes: ['openid', 'email', 'profile'],
                useSharedKey: false,
                extraAuthorizeParams: null,
                createdAt: '2026-05-24T00:00:00Z',
                updatedAt: '2026-05-24T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      });

      const service = OAuthConfigService.getInstance();
      const result = await service.createConfig({
        provider: 'google',
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
      });

      expect(result.extraAuthorizeParams).toBeNull();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('updates extraAuthorizeParams when provided', async () => {
      mockClient.query.mockImplementation(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') {
          return { rows: [], rowCount: 0 };
        }

        if (/SELECT.*FROM auth\.oauth_configs.*WHERE.*provider/i.test(sql)) {
          return {
            rows: [{ id: 'test-id', secretId: 'secret-123' }],
            rowCount: 1,
          };
        }

        if (/UPDATE auth\.oauth_configs/i.test(sql)) {
          return {
            rows: [
              {
                id: 'test-id',
                provider: 'google',
                clientId: 'test-client-id',
                redirectUri: null,
                scopes: ['openid', 'email', 'profile'],
                useSharedKey: false,
                extraAuthorizeParams: { prompt: 'select_account', access_type: 'offline' },
                createdAt: '2026-05-24T00:00:00Z',
                updatedAt: '2026-05-24T00:00:00Z',
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      });

      const service = OAuthConfigService.getInstance();
      const result = await service.updateConfig('google', {
        extraAuthorizeParams: { prompt: 'select_account', access_type: 'offline' },
      });

      expect(result.extraAuthorizeParams).toEqual({
        prompt: 'select_account',
        access_type: 'offline',
      });
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('getAllConfigs', () => {
    it('returns configs with extraAuthorizeParams', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            id: 'test-id-1',
            provider: 'google',
            clientId: 'google-client-id',
            redirectUri: null,
            scopes: ['openid', 'email', 'profile'],
            useSharedKey: false,
            extraAuthorizeParams: { prompt: 'select_account' },
            createdAt: '2026-05-24T00:00:00Z',
            updatedAt: '2026-05-24T00:00:00Z',
          },
        ],
        rowCount: 1,
      });

      const service = OAuthConfigService.getInstance();
      const configs = await service.getAllConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0].extraAuthorizeParams).toEqual({ prompt: 'select_account' });
    });
  });
});
