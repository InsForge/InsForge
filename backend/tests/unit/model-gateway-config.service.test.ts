import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelGatewayConfigService } from '../../src/services/ai/model-gateway-config.service.js';

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
      source: 'dashboard',
      maskedKey: 'sk-or-da••••••••7890',
    });
    expect(config.managementKey).toEqual({
      configured: true,
      source: 'dashboard',
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

    expect(config.apiKey.source).toBe('dashboard');
    expect(config.managementKey.source).toBe('dashboard');
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
    expect(config.apiKey.source).toBe('dashboard');
    expect(config.managementKey.source).toBe('dashboard');
  });
});
