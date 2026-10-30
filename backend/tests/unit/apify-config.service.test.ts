import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApifyConfigService } from '../../src/services/webscraper/apify-config.service.js';

type ApifySecretStore = ConstructorParameters<typeof ApifyConfigService>[0];

function createSecretStore() {
  return {
    createSecret: vi.fn(),
    getSecretByKey: vi.fn().mockResolvedValue(null),
    listSecrets: vi.fn().mockResolvedValue([]),
    updateSecret: vi.fn(),
    deleteReservedSecretByKey: vi.fn().mockResolvedValue(true),
  };
}

function makeService(store = createSecretStore()) {
  return { service: new ApifyConfigService(store as unknown as ApifySecretStore), store };
}

interface FakeSecretRow {
  id: string;
  value: string;
  isActive: boolean;
  isReserved: boolean;
  expiresAt: Date | null;
  createdAt: string;
}

/**
 * A behavioural stand-in for SecretService rather than a per-call mock.
 *
 * It reproduces the rules that matter here, taken from the real SQL in
 * secret.service.ts and pinned separately in secret-delete-reserved.test.ts:
 *
 *   deleteSecretByKey         -> WHERE key = $1 AND is_reserved = false
 *   deleteReservedSecretByKey -> WHERE key = $1
 *   getSecretByKey            -> WHERE key = $1 AND is_active = true
 *                                AND (expires_at IS NULL OR expires_at > NOW())
 *   listSecrets               -> no filter at all
 *
 * so a reserved row is silently untouched by the first and removed by the
 * second, and a soft-deleted or expired row is invisible to the read path while
 * still showing up in the listing. The suite previously stubbed
 * `deleteSecretByKey` to resolve `true`, which asserted the answer the service
 * was supposed to be checked against — that is exactly why Disconnect shipped
 * reporting success while leaving the Apify token in the store.
 */
function createBehaviouralSecretStore() {
  const rows = new Map<string, FakeSecretRow>();
  let nextId = 1;

  return {
    rows,
    createSecret: vi.fn(
      async (input: { key: string; value: string; isReserved?: boolean; expiresAt?: Date }) => {
        const id = `sec-${nextId++}`;
        rows.set(input.key, {
          id,
          value: input.value,
          isActive: true,
          isReserved: input.isReserved === true,
          expiresAt: input.expiresAt ?? null,
          createdAt: '2026-03-04T05:06:07.000Z',
        });
        return { id };
      }
    ),
    getSecretByKey: vi.fn(async (key: string) => {
      const row = rows.get(key);
      if (!row || !row.isActive || (row.expiresAt !== null && row.expiresAt <= new Date())) {
        return null;
      }
      return row.value;
    }),
    listSecrets: vi.fn(async () =>
      [...rows.entries()].map(([key, row]) => ({
        id: row.id,
        key,
        isActive: row.isActive,
        isReserved: row.isReserved,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        createdAt: row.createdAt,
      }))
    ),
    updateSecret: vi.fn(
      async (
        id: string,
        input: {
          value?: string;
          isReserved?: boolean;
          isActive?: boolean;
          expiresAt?: Date | null;
        }
      ) => {
        const entry = [...rows.values()].find((row) => row.id === id);
        if (!entry) {
          return false;
        }
        if (input.value !== undefined) {
          entry.value = input.value;
        }
        if (input.isReserved !== undefined) {
          entry.isReserved = input.isReserved;
        }
        if (input.isActive !== undefined) {
          entry.isActive = input.isActive;
        }
        if (input.expiresAt !== undefined) {
          entry.expiresAt = input.expiresAt;
        }
        return true;
      }
    ),
    deleteSecretByKey: vi.fn(async (key: string) => {
      const row = rows.get(key);
      if (!row || row.isReserved) {
        return false;
      }
      rows.delete(key);
      return true;
    }),
    deleteReservedSecretByKey: vi.fn(async (key: string) => rows.delete(key)),
  };
}

function makeBehaviouralService() {
  const store = createBehaviouralSecretStore();
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

  // There is deliberately no environment-variable fallback: the encrypted
  // secret store is the only source of truth for self-hosted deployments. An
  // env fallback would let Disconnect delete the secret row while the env var
  // kept reviving the connection on the next read, reporting "disconnected"
  // to an admin who was still connected.
  it('ignores APIFY_API_TOKEN in the environment when nothing is stored', async () => {
    vi.stubEnv('APIFY_API_TOKEN', 'apify_api_fromenv1234567');
    const { service } = makeService();

    await expect(service.getToken()).resolves.toBeNull();
    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: false, maskedKey: null },
    });
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
      {
        id: 'sec-1',
        key: 'APIFY_API_TOKEN',
        isActive: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    store.updateSecret.mockResolvedValue(true);

    await service.setToken('apify_api_rotated1234567');

    expect(store.updateSecret).toHaveBeenCalledWith('sec-1', {
      value: 'apify_api_rotated1234567',
      isActive: true,
      isReserved: true,
      expiresAt: null,
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
      {
        id: 'sec-1',
        key: 'APIFY_API_TOKEN',
        isActive: true,
        createdAt: '2026-03-04T05:06:07.000Z',
      },
    ]);

    await expect(service.getTokenRecord()).resolves.toEqual({
      token: 'apify_api_stored12345678',
      createdAt: '2026-03-04T05:06:07.000Z',
    });
  });

  // listSecrets() filters nothing, so a soft-deleted row still shows up in it
  // while getSecretByKey() (is_active = true) no longer matches. Pairing the
  // 60s-cached token with that dead row's createdAt would report a connection
  // age for a row the read path has already stopped honouring.
  it('does not pair a token with a soft-deleted row', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockResolvedValue('apify_api_stored12345678');
    store.listSecrets.mockResolvedValue([
      {
        id: 'sec-1',
        key: 'APIFY_API_TOKEN',
        isActive: false,
        createdAt: '2026-03-04T05:06:07.000Z',
      },
    ]);

    await expect(service.getTokenRecord()).resolves.toBeNull();
  });

  it('propagates secret-store failures instead of silently falling back', async () => {
    const { service, store } = makeService();
    store.getSecretByKey.mockRejectedValue(new Error('decryption failed'));

    await expect(service.getToken()).rejects.toThrow('decryption failed');
  });

  // Regression: the update left expires_at alone. Rewriting a row whose expiry
  // had already passed stored the new token somewhere getSecretByKey() still
  // refuses to match, so getConfig() answered `configured: false` the moment
  // after a PUT that had just reported success.
  it('clears a stale expiry when it takes over an existing row', async () => {
    const { service, store } = makeBehaviouralService();
    store.rows.set('APIFY_API_TOKEN', {
      id: 'sec-expired',
      value: 'apify_api_expired1234567',
      isActive: true,
      isReserved: true,
      expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      createdAt: '2020-01-01T00:00:00.000Z',
    });
    await expect(service.getToken()).resolves.toBeNull();

    await service.setToken('apify_api_fresh123456789');

    expect(store.updateSecret).toHaveBeenCalledWith('sec-expired', {
      value: 'apify_api_fresh123456789',
      isActive: true,
      isReserved: true,
      expiresAt: null,
    });
    expect(store.rows.get('APIFY_API_TOKEN')?.expiresAt).toBeNull();
    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: true, maskedKey: 'apify_ap••••••••6789' },
    });
  });
});

describe('ApifyConfigService.deleteToken against reserved-secret semantics', () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  // Regression: setToken() stores with isReserved: true, and the default
  // deleteSecretByKey() filters those rows out. Disconnect matched zero rows,
  // discarded the `false`, answered 204 — and the admin kept a live Apify
  // credential in InsForge they believed they had revoked.
  it('really removes the reserved token it stored', async () => {
    const { service, store } = makeBehaviouralService();
    await service.setToken('apify_api_stored12345678');
    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: true, maskedKey: 'apify_ap••••••••5678' },
    });
    expect(store.rows.get('APIFY_API_TOKEN')?.isReserved).toBe(true);

    await service.deleteToken();

    expect(store.rows.has('APIFY_API_TOKEN')).toBe(false);
    await expect(service.getConfig()).resolves.toEqual({
      token: { configured: false, maskedKey: null },
    });
  });

  it('goes through the reserved-capable delete, never the default one', async () => {
    const { service, store } = makeBehaviouralService();
    await service.setToken('apify_api_stored12345678');

    await service.deleteToken();

    expect(store.deleteReservedSecretByKey).toHaveBeenCalledWith('APIFY_API_TOKEN');
    expect(store.deleteSecretByKey).not.toHaveBeenCalled();
  });

  it('raises rather than swallowing a delete that leaves the secret behind', async () => {
    const { service, store } = makeBehaviouralService();
    await service.setToken('apify_api_stored12345678');
    store.deleteReservedSecretByKey.mockResolvedValueOnce(false);

    await expect(service.deleteToken()).rejects.toThrow('APIFY_API_TOKEN');
    expect(store.rows.has('APIFY_API_TOKEN')).toBe(true);
  });

  it('stays idempotent when there is nothing stored to delete', async () => {
    const { service, store } = makeBehaviouralService();

    await expect(service.deleteToken()).resolves.toBeUndefined();
    expect(store.deleteReservedSecretByKey).toHaveBeenCalledWith('APIFY_API_TOKEN');
  });
});
