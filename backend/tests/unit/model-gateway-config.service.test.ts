import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ModelGatewayConfigService,
  ModelGatewayConfigUpdateError,
} from '../../src/services/ai/model-gateway-config.service.js';
import { AppError } from '../../src/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

type ConfigServiceSecretStore = ConstructorParameters<typeof ModelGatewayConfigService>[0];

function createSecretStore() {
  return {
    createSecret: vi.fn(),
    getSecretByKey: vi.fn(),
    listSecrets: vi.fn(),
    updateSecret: vi.fn(),
  };
}

describe('ModelGatewayConfigService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses stored credentials even when the API key bootstrap environment variable remains set', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-env-api-1234567890');
    const secretStore = createSecretStore();
    secretStore.getSecretByKey.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'OPENROUTER_API_KEY'
          ? 'sk-or-dashboard-api-1234567890'
          : 'sk-or-dashboard-management-1234567890'
      )
    );
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    const config = await service.getConfig();

    expect(config.apiKey).toEqual({
      configured: true,
      maskedKey: 'sk-or-da••••••••7890',
    });
    expect(config.managementKey).toEqual({
      configured: true,
      maskedKey: 'sk-or-da••••••••7890',
    });
    expect(secretStore.getSecretByKey).toHaveBeenCalledTimes(2);
  });

  it('seeds a missing API key from the environment variable', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-env-api-1234567890');
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([]);
    secretStore.createSecret.mockResolvedValue({ id: 'secret-api' });
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await service.seedApiKeyFromEnv();

    expect(secretStore.createSecret).toHaveBeenCalledOnce();
    expect(secretStore.createSecret).toHaveBeenCalledWith({
      key: 'OPENROUTER_API_KEY',
      value: 'sk-or-env-api-1234567890',
      isReserved: true,
    });
  });

  it('uses encrypted secret storage when environment credentials are absent', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '');
    const secretStore = createSecretStore();
    secretStore.getSecretByKey.mockImplementation((key: string) =>
      Promise.resolve(
        key === 'OPENROUTER_API_KEY'
          ? 'sk-or-dashboard-api-1234567890'
          : 'sk-or-dashboard-management-1234567890'
      )
    );
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    const config = await service.getConfig();

    expect(config.apiKey.maskedKey).toBe('sk-or-da••••••••7890');
    expect(config.managementKey.maskedKey).toBe('sk-or-da••••••••7890');
  });

  it('updates an existing API key and creates a missing management key as reserved secrets', async () => {
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([
      {
        id: 'secret-api',
        key: 'OPENROUTER_API_KEY',
        isActive: true,
        isReserved: true,
        lastUsedAt: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    secretStore.updateSecret.mockResolvedValue(true);
    secretStore.createSecret.mockResolvedValue({ id: 'secret-management' });
    secretStore.getSecretByKey.mockImplementation((key: string) =>
      Promise.resolve(key === 'OPENROUTER_API_KEY' ? 'new-api-key' : 'new-management-key')
    );
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    const config = await service.updateConfig({
      apiKey: ' new-api-key ',
      managementKey: ' new-management-key ',
    });

    expect(secretStore.updateSecret).toHaveBeenCalledWith('secret-api', {
      value: 'new-api-key',
      isActive: true,
      isReserved: true,
    });
    expect(secretStore.createSecret).toHaveBeenCalledWith({
      key: 'OPENROUTER_MANAGEMENT_API_KEY',
      value: 'new-management-key',
      isReserved: true,
    });
    expect(config.apiKey.configured).toBe(true);
    expect(config.managementKey.configured).toBe(true);
  });

  it('falls back to OPENROUTER_API_KEY when no stored API key exists', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-env-api-1234567890');
    const secretStore = createSecretStore();
    secretStore.getSecretByKey.mockResolvedValue(null);
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(service.getApiKey()).resolves.toBe('sk-or-env-api-1234567890');
    await expect(service.getManagementKey()).resolves.toBeNull();
  });

  it('loads API and management credentials independently', async () => {
    const secretStore = createSecretStore();
    secretStore.getSecretByKey.mockImplementation((key: string) => {
      if (key === 'OPENROUTER_API_KEY') {
        return Promise.resolve('sk-or-api');
      }
      return Promise.reject(new Error('management decrypt failed'));
    });
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(service.getApiKey()).resolves.toBe('sk-or-api');
    await expect(service.getManagementKey()).rejects.toThrow('management decrypt failed');
  });

  it('does not cache transient secret-store failures as missing credentials', async () => {
    const secretStore = createSecretStore();
    secretStore.getSecretByKey
      .mockRejectedValueOnce(new Error('temporary decrypt failure'))
      .mockResolvedValueOnce('sk-or-recovered');
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(service.getApiKey()).rejects.toThrow('temporary decrypt failure');
    await expect(service.getApiKey()).resolves.toBe('sk-or-recovered');
    expect(secretStore.getSecretByKey).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached credentials after an allowed partial update', async () => {
    const secretStore = createSecretStore();
    secretStore.getSecretByKey
      .mockResolvedValueOnce('old-api-key')
      .mockResolvedValueOnce('new-api-key');
    secretStore.listSecrets.mockResolvedValue([
      { id: 'api-id', key: 'OPENROUTER_API_KEY' },
      { id: 'management-id', key: 'OPENROUTER_MANAGEMENT_API_KEY' },
    ]);
    secretStore.updateSecret.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(service.getApiKey()).resolves.toBe('old-api-key');
    await expect(
      service.updateConfig({ apiKey: 'new-api-key', managementKey: 'new-management-key' })
    ).rejects.toMatchObject({
      name: 'ModelGatewayConfigUpdateError',
      message: 'Failed to update OPENROUTER_MANAGEMENT_API_KEY',
      succeededFields: ['apiKey'],
      failedFields: ['managementKey'],
    } satisfies Partial<ModelGatewayConfigUpdateError>);
    await expect(service.getApiKey()).resolves.toBe('new-api-key');
    expect(secretStore.getSecretByKey).toHaveBeenCalledTimes(2);
  });

  it('attempts the management-key update when the API-key update fails', async () => {
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([
      { id: 'api-id', key: 'OPENROUTER_API_KEY' },
      { id: 'management-id', key: 'OPENROUTER_MANAGEMENT_API_KEY' },
    ]);
    secretStore.updateSecret.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(
      service.updateConfig({ apiKey: 'new-api-key', managementKey: 'new-management-key' })
    ).rejects.toMatchObject({
      name: 'ModelGatewayConfigUpdateError',
      message: 'Failed to update OPENROUTER_API_KEY',
      succeededFields: ['managementKey'],
      failedFields: ['apiKey'],
    } satisfies Partial<ModelGatewayConfigUpdateError>);

    expect(secretStore.updateSecret).toHaveBeenCalledTimes(2);
    expect(secretStore.updateSecret).toHaveBeenNthCalledWith(2, 'management-id', {
      value: 'new-management-key',
      isActive: true,
      isReserved: true,
    });
  });

  it('reports both credential fields when both independent updates fail', async () => {
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([
      { id: 'api-id', key: 'OPENROUTER_API_KEY' },
      { id: 'management-id', key: 'OPENROUTER_MANAGEMENT_API_KEY' },
    ]);
    secretStore.updateSecret.mockResolvedValue(false);
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(
      service.updateConfig({ apiKey: 'new-api-key', managementKey: 'new-management-key' })
    ).rejects.toMatchObject({
      name: 'ModelGatewayConfigUpdateError',
      succeededFields: [],
      failedFields: ['apiKey', 'managementKey'],
    } satisfies Partial<ModelGatewayConfigUpdateError>);
  });

  it('preserves successful write outcomes when config read-back fails', async () => {
    const readbackError = new Error('credential read-back failed');
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([
      { id: 'api-id', key: 'OPENROUTER_API_KEY' },
      { id: 'management-id', key: 'OPENROUTER_MANAGEMENT_API_KEY' },
    ]);
    secretStore.updateSecret.mockResolvedValue(true);
    secretStore.getSecretByKey.mockRejectedValue(readbackError);
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(
      service.updateConfig({ apiKey: 'new-api-key', managementKey: 'new-management-key' })
    ).rejects.toMatchObject({
      name: 'ModelGatewayConfigUpdateError',
      message: 'credential read-back failed',
      succeededFields: ['apiKey', 'managementKey'],
      failedFields: [],
      cause: readbackError,
    } satisfies Partial<ModelGatewayConfigUpdateError>);
  });

  it('preserves an AppError as the cause of a structured partial write failure', async () => {
    const conflict = new AppError(
      'Secret already exists: OPENROUTER_API_KEY',
      409,
      ERROR_CODES.SECRET_ALREADY_EXISTS
    );
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([
      { id: 'management-id', key: 'OPENROUTER_MANAGEMENT_API_KEY' },
    ]);
    secretStore.createSecret.mockRejectedValue(conflict);
    secretStore.updateSecret.mockResolvedValue(true);
    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    await expect(
      service.updateConfig({ apiKey: 'new-api-key', managementKey: 'new-management-key' })
    ).rejects.toMatchObject({
      name: 'ModelGatewayConfigUpdateError',
      succeededFields: ['managementKey'],
      failedFields: ['apiKey'],
      cause: conflict,
    } satisfies Partial<ModelGatewayConfigUpdateError>);
  });
  it('ignores an in-flight credential read that resolves after an update invalidated the cache', async () => {
    const secretStore = createSecretStore();
    secretStore.listSecrets.mockResolvedValue([{ id: 'api-id', key: 'OPENROUTER_API_KEY' }]);
    secretStore.updateSecret.mockResolvedValue(true);

    // Hold the first read open so it settles only after updateConfig has cleared
    // and refilled the cache — the interleaving a slow secret-store read produces
    // under connection-pool contention.
    let releaseStaleRead!: (value: string) => void;
    const staleRead = new Promise<string>((resolve) => {
      releaseStaleRead = resolve;
    });
    secretStore.getSecretByKey
      .mockImplementationOnce(() => staleRead)
      .mockImplementation(() => Promise.resolve('new-api-key'));

    const service = new ModelGatewayConfigService(
      secretStore as unknown as ConfigServiceSecretStore
    );

    const inFlightRead = service.getApiKey();
    await service.updateConfig({ apiKey: 'new-api-key' });

    releaseStaleRead('old-api-key');
    // The read itself still returns what it fetched; that is not what regressed.
    await expect(inFlightRead).resolves.toBe('old-api-key');

    // It must not have written that pre-update value back over the fresh cache,
    // which would serve the revoked key for a further TTL window.
    await expect(service.getApiKey()).resolves.toBe('new-api-key');
  });
});
