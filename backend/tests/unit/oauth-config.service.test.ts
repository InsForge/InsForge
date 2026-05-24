import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool, mockSecretService } = vi.hoisted(() => ({
  mockPool: {
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
  });

  describe('createConfig', () => {
    it('creates OAuth config with extraAuthorizeParams', async () => {
      const mockResult = {
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
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(mockResult)
        .mockResolvedValueOnce(undefined);

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
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('extra_authorize_params'),
        expect.arrayContaining([
          'google',
          'test-client-id',
          expect.any(String),
          null,
          ['openid', 'email', 'profile'],
          false,
          { prompt: 'select_account' },
        ])
      );
    });

    it('creates OAuth config with null extraAuthorizeParams when not provided', async () => {
      const mockResult = {
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
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(mockResult)
        .mockResolvedValueOnce(undefined);

      const service = OAuthConfigService.getInstance();
      const result = await service.createConfig({
        provider: 'google',
        clientId: 'test-client-id',
        clientSecret: 'test-secret',
      });

      expect(result.extraAuthorizeParams).toBeNull();
    });
  });

  describe('updateConfig', () => {
    it('updates extraAuthorizeParams when provided', async () => {
      const mockResult = {
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
      };

      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'test-id' }] })
        .mockResolvedValueOnce(mockResult)
        .mockResolvedValueOnce(undefined);

      const service = OAuthConfigService.getInstance();
      const result = await service.updateConfig('google', {
        extraAuthorizeParams: { prompt: 'select_account', access_type: 'offline' },
      });

      expect(result.extraAuthorizeParams).toEqual({
        prompt: 'select_account',
        access_type: 'offline',
      });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('extra_authorize_params = $'),
        expect.arrayContaining([{ prompt: 'select_account', access_type: 'offline' }])
      );
    });
  });

  describe('getAllConfigs', () => {
    it('returns configs with extraAuthorizeParams', async () => {
      const mockConfigs = [
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
      ];

      mockPool.query.mockResolvedValue({ rows: mockConfigs });

      const service = OAuthConfigService.getInstance();
      const configs = await service.getAllConfigs();

      expect(configs).toHaveLength(1);
      expect(configs[0].extraAuthorizeParams).toEqual({ prompt: 'select_account' });
    });
  });
});
