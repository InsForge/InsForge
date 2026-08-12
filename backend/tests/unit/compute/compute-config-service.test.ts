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

  // `fly tokens create org` prints the macaroon with its scheme attached, and copying
  // that line as printed is the obvious thing to do. The logs endpoint prepends
  // `FlyV1 ` itself, so storing it verbatim would send the scheme twice.
  it('stores a pasted token without its FlyV1 scheme', async () => {
    const secretStore = store();
    const service = new ComputeConfigService(secretStore);

    await service.updateConfig({ flyApiToken: 'FlyV1 fm2_pasted_from_the_cli' });

    expect(secretStore.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'FLY_API_TOKEN', value: 'fm2_pasted_from_the_cli' })
    );
    expect(service.flyCredentials().apiToken).toBe('fm2_pasted_from_the_cli');
  });

  // A token that never carried the scheme is untouched, so this cannot degrade a
  // credential that already worked.
  it('leaves a token with no scheme prefix alone', async () => {
    const secretStore = store();
    const service = new ComputeConfigService(secretStore);

    await service.updateConfig({ flyApiToken: 'fm2_already_bare' });

    expect(secretStore.createSecret).toHaveBeenCalledWith(
      expect.objectContaining({ value: 'fm2_already_bare' })
    );
  });

  // The org write failing after the token landed is the partial failure that matters:
  // the error must surface, and the snapshot must describe what is actually stored
  // rather than the pre-write state.
  it('surfaces a partial write and still refreshes what is in force', async () => {
    const secretStore = store();
    secretStore.createSecret = vi.fn((input: { key: string; value: string }) => {
      if (input.key === 'FLY_ORG') {
        return Promise.reject(new Error('secret store unavailable'));
      }
      secretStore.secrets.set(input.key, input.value);
      return Promise.resolve({ id: `id-${input.key}` });
    });
    const svc = new ComputeConfigService(secretStore);

    await expect(
      svc.updateConfig({ flyApiToken: 'fm2_new_token', flyOrg: 'my-org' })
    ).rejects.toThrow(/secret store unavailable/);

    // The token did land, and the snapshot reflects it.
    expect(secretStore.secrets.get('FLY_API_TOKEN')).toBe('fm2_new_token');
    expect(svc.flyCredentials().apiToken).toBe('fm2_new_token');
  });

  // The epoch guard covered the success path only, so a slow read that failed could
  // still wipe a newer one that had succeeded — a rotation would silently fall back to
  // the environment.
  it('keeps a newer snapshot when an older read fails', async () => {
    appConfig.fly.apiToken = 'env-token';
    appConfig.fly.org = 'env-org';

    let releaseSlow: (() => void) | undefined;
    const slow = new Promise<string | null>((resolve) => {
      releaseSlow = () => resolve('slow-token');
    });
    const secretStore = store({ FLY_API_TOKEN: 'fresh-token', FLY_ORG: 'fresh-org' });
    const svc = new ComputeConfigService(secretStore);

    // First prime hangs, then rejects. Second prime completes with the stored values.
    secretStore.getSecretByKey = vi.fn(() => slow.then(() => Promise.reject(new Error('boom'))));
    const first = svc.primeSnapshot();

    secretStore.getSecretByKey = vi.fn((key: string) =>
      Promise.resolve(secretStore.secrets.get(key) ?? null)
    );
    await svc.primeSnapshot();
    expect(svc.flyCredentials().apiToken).toBe('fresh-token');

    releaseSlow?.();
    await first;

    // The failed older read must not have reverted us to the environment.
    expect(svc.flyCredentials().apiToken).toBe('fresh-token');
  });
});
