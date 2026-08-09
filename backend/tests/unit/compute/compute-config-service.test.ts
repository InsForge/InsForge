import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/infra/config/app.config.js', () => {
  const c = { fly: { apiToken: '', org: '' } };
  return { config: c, appConfig: c };
});
vi.mock('@/utils/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { ComputeConfigService } from '@/services/compute/compute-config.service.js';
import { appConfig } from '@/infra/config/app.config.js';

function store(overrides: Partial<Record<string, string>> = {}) {
  const secrets = new Map(Object.entries(overrides));
  return {
    getSecretByKey: vi.fn((key: string) => Promise.resolve(secrets.get(key) ?? null)),
    listSecrets: vi.fn(() =>
      Promise.resolve([...secrets.keys()].map((key) => ({ id: `id-${key}`, key })))
    ),
    createSecret: vi.fn((input: { key: string; value: string }) => {
      secrets.set(input.key, input.value);
      return Promise.resolve({ id: `id-${input.key}` });
    }),
    updateSecret: vi.fn((id: string, input: { value?: string }) => {
      const key = id.replace(/^id-/, '');
      if (input.value !== undefined) {
        secrets.set(key, input.value);
      }
      return Promise.resolve(true);
    }),
    secrets,
  };
}

describe('ComputeConfigService', () => {
  beforeEach(() => {
    appConfig.fly.apiToken = '';
    appConfig.fly.org = '';
  });

  // Sync callers — the Fly provider's isConfigured() and its request headers — cannot
  // await the secret store, so they read a snapshot. Before it is primed they must see
  // the environment, which is the behaviour that existed before storage.
  it('falls back to the environment until the snapshot is primed', () => {
    appConfig.fly.apiToken = 'env-token';
    appConfig.fly.org = 'env-org';
    const svc = new ComputeConfigService(store());

    expect(svc.flyCredentials()).toEqual({ apiToken: 'env-token', org: 'env-org' });
  });

  it('prefers a stored credential over the environment once primed', async () => {
    appConfig.fly.apiToken = 'env-token';
    const svc = new ComputeConfigService(store({ FLY_API_TOKEN: 'stored-token' }));

    await svc.primeSnapshot();

    expect(svc.flyCredentials().apiToken).toBe('stored-token');
  });

  // A first save has no row to update, and updateSecretByKey is UPDATE-only — it
  // reports false rather than inserting, so going through it would quietly do nothing.
  it('creates a credential that does not exist yet', async () => {
    const secretStore = store();
    const svc = new ComputeConfigService(secretStore);

    await svc.updateConfig({ flyApiToken: 'fresh-token' });

    expect(secretStore.createSecret).toHaveBeenCalled();
    expect(svc.flyCredentials().apiToken).toBe('fresh-token');
  });

  it('updates a credential that already exists', async () => {
    const secretStore = store({ FLY_API_TOKEN: 'old' });
    const svc = new ComputeConfigService(secretStore);

    await svc.updateConfig({ flyApiToken: 'new' });

    expect(secretStore.updateSecret).toHaveBeenCalled();
    expect(secretStore.createSecret).not.toHaveBeenCalled();
    expect(svc.flyCredentials().apiToken).toBe('new');
  });

  // A save has to be usable immediately: the route rebuilds the registry right after,
  // and that only helps if the snapshot already reflects the write.
  it('refreshes the snapshot as part of the write', async () => {
    const svc = new ComputeConfigService(store());

    await svc.updateConfig({ flyApiToken: 'tok', flyOrg: 'org' });

    expect(svc.flyCredentials()).toEqual({ apiToken: 'tok', org: 'org' });
  });

  it('never returns the token, and says where each value came from', async () => {
    appConfig.fly.org = 'env-org';
    const svc = new ComputeConfigService(store({ FLY_API_TOKEN: 'fo1_averylongsecrettoken' }));

    const config = await svc.getConfig();

    expect(config.flyApiToken.configured).toBe(true);
    expect(config.flyApiToken.source).toBe('stored');
    expect(config.flyApiToken.masked).not.toContain('averylongsecret');
    // The org is not a secret and is more useful shown, so it is not masked.
    expect(config.flyOrg).toEqual({ configured: true, masked: 'env-org', source: 'environment' });
  });

  it('reports nothing configured when neither store nor environment has a value', async () => {
    const config = await new ComputeConfigService(store()).getConfig();

    expect(config.flyApiToken).toEqual({ configured: false, masked: null, source: null });
    expect(config.flyOrg).toEqual({ configured: false, masked: null, source: null });
  });

  // A secret-store outage should leave compute on whatever the environment provides
  // rather than take the feature down.
  it('survives a secret-store failure by falling back to the environment', async () => {
    appConfig.fly.apiToken = 'env-token';
    const broken = { ...store(), getSecretByKey: vi.fn(() => Promise.reject(new Error('down'))) };
    const svc = new ComputeConfigService(broken);

    await expect(svc.primeSnapshot()).resolves.toBeUndefined();
    expect(svc.flyCredentials().apiToken).toBe('env-token');
  });
});
