import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  client: {
    query: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => mocks.pool }) },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({
      createSecret: vi.fn(),
      updateSecret: vi.fn(),
      getSecretById: vi.fn(),
    }),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { OAuthConfigService } from '../../src/services/auth/oauth-config.service.js';

describe('OAuthConfigService native client IDs', () => {
  let service: OAuthConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pool.connect.mockResolvedValue(mocks.client);
    (OAuthConfigService as unknown as { instance?: OAuthConfigService }).instance = undefined;
    service = OAuthConfigService.getInstance();
  });

  it('reads native client IDs from project OAuth configuration', async () => {
    mocks.pool.query.mockResolvedValue({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          provider: 'apple',
          clientId: 'com.example.web',
          nativeClientIds: ['com.example.ios'],
          useSharedKey: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const result = await service.getConfigByProvider('apple');

    expect(result?.nativeClientIds).toEqual(['com.example.ios']);
    expect(mocks.pool.query.mock.calls[0]?.[0]).toContain('native_client_ids as "nativeClientIds"');
  });

  it('persists native client IDs when creating an OAuth configuration', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id FROM auth.oauth_configs')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO auth.oauth_configs')) {
        return {
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              provider: 'apple',
              nativeClientIds: ['com.example.ios'],
              useSharedKey: true,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await service.createConfig({
      provider: 'apple',
      nativeClientIds: [' com.example.ios ', 'com.example.ios', '', 'com.example.ipados'],
      useSharedKey: true,
    });

    const insertCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO auth.oauth_configs')
    );
    expect(insertCall?.[0]).toContain('native_client_ids');
    expect(insertCall?.[1]?.[2]).toEqual(['com.example.ios', 'com.example.ipados']);
  });

  it('updates native client IDs independently of browser credentials', async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, secret_id')) {
        return {
          rows: [{ id: '00000000-0000-4000-8000-000000000001', secretId: null }],
        };
      }
      if (sql.includes('UPDATE auth.oauth_configs')) {
        return {
          rows: [
            {
              id: '00000000-0000-4000-8000-000000000001',
              provider: 'apple',
              clientId: 'com.example.web',
              nativeClientIds: ['com.example.ios', 'com.example.ipados'],
              useSharedKey: false,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await service.updateConfig('apple', {
      nativeClientIds: ['com.example.ios', ' com.example.ipados ', 'com.example.ios', ''],
    });

    const updateCall = mocks.client.query.mock.calls.find(
      ([sql]) => typeof sql === 'string' && sql.includes('UPDATE auth.oauth_configs')
    );
    expect(updateCall?.[0]).toContain('native_client_ids = $1');
    expect(updateCall?.[1]?.[0]).toEqual(['com.example.ios', 'com.example.ipados']);
    expect(result.nativeClientIds).toEqual(['com.example.ios', 'com.example.ipados']);
  });
});
