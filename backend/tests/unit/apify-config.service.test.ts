import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApifyConfigService } from '../../src/services/webscraper/apify-config.service.js';

type ApifySecretStore = ConstructorParameters<typeof ApifyConfigService>[0];

function createSecretStore() {
  return {
    createSecret: vi.fn(),
    getSecretByKey: vi.fn().mockResolvedValue(null),
    listSecrets: vi.fn().mockResolvedValue([]),
    updateSecret: vi.fn(),
    deleteSecretByKey: vi.fn().mockResolvedValue(true),
  };
}

function makeService(store = createSecretStore()) {
  return { service: new ApifyConfigService(store as unknown as ApifySecretStore), store };
}

describe('ApifyConfigService', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it('reports not configured when no token is stored and no env var is set', async () => {
    const { service } = makeService();

    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: false, maskedKey: null },
    });
  });

  it('masks a stored token as first8 + dots + last4', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockResolvedValue('apify_api_abcdefghijklmnop');

    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: true, maskedKey: 'apify_ap••••••••mnop' },
    });
  });

  it('falls back to APIFY_API_TOKEN from the environment when nothing is stored', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 'apify_api_fromenv1234567');
    const { service } = makeService();

    await expect(service.getToken()).resolves.toBe('apify_api_fromenv1234567');
  });

  it('prefers the stored token over the environment variable', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 'apify_api_fromenv1234567');
    const { service, store } = makeService();
    store.getSecretByKey.mockResolvedValue('apify_api_stored12345678');

    await expect(service.getToken()).resolves.toBe('apify_api_stored12345678');
  });

  it('creates a reserved secret on first write', async () => {
    const { service, store } = makeService();

    await service.setToken('  apify_api_new123456789  ');

    expect(store.createSecret).toHaveBeenCalledWith({
      key: 'APIFY_API_TOKEN',
      value: 'apify_api_new123456789',
      isReserved: true,
    });
  });

  it('updates the existing secret instead of creating a duplicate', async () => {
    const { service, store } = makeService();
    store.listSecrets.mockResolvedValue([
      { id: 'sec-1', key: 'APIFY_API_TOKEN', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
    store.updateSecret.mockResolvedValue(true);

    await service.setToken('apify_api_rotated1234567');

    expect(store.updateSecret).toHaveBeenCalledWith('sec-1', {
      value: 'apify_api_rotated1234567',
      isActive: true,
      isReserved: true,
    });
    expect(store.createSecret).not.toHaveBeenCalled();
  });

  it('serves a rotated token immediately rather than the cached previous one', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockResolvedValue('apify_api_old1234567890');
    await service.getToken();

    store.getSecretByKey.mockResolvedValue('apify_api_new1234567890');
    await service.setToken('apify_api_new1234567890');

    await expect(service.getToken()).resolves.toBe('apify_api_new1234567890');
  });

  it('returns the stored secret createdAt with the token record', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockResolvedValue('apify_api_stored12345678');
    store.listSecrets.mockResolvedValue([
      { id: 'sec-1', key: 'APIFY_API_TOKEN', createdAt: '2026-03-04T05:06:07.000Z' },
    ]);

    await expect(service.getTokenRecord()).resolves.toEqual({
      token: 'apify_api_stored12345678',
      createdAt: '2026-03-04T05:06:07.000Z',
    });
  });

  it('deletes the secret and reports not configured afterwards', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockResolvedValue('apify_api_stored12345678');
    await service.getToken();

    await service.deleteToken();
    store.getSecretByKey.mockResolvedValue(null);

    expect(store.deleteSecretByKey).toHaveBeenCalledWith('APIFY_API_TOKEN');
    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: false, maskedKey: null },
    });
  });

  it('propagates secret-store failures instead of silently falling back', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockRejectedValue(new Error('decryption failed'));

    await expect(service.getToken()).rejects.toThrow('decryption failed');
  });
});
