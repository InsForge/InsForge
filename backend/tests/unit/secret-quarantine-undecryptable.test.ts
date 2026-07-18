import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPoolQuery, mockConnect } = vi.hoisted(() => {
  return {
    mockPoolQuery: vi.fn(),
    mockConnect: vi.fn(),
  };
});

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({
        query: mockPoolQuery,
        connect: mockConnect,
      }),
    }),
  },
}));

// Ciphertexts prefixed with `foreign:` simulate rows restored from another
// instance (encrypted under a different key): decryption throws on them.
vi.mock('../../src/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => {
      if (value.startsWith('foreign:')) {
        throw new Error('Unsupported state or unable to authenticate data');
      }
      return value.replace(/^enc:/, '');
    },
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

async function loadSecretService() {
  const { SecretService } = await import('../../src/services/secrets/secret.service.js');
  return SecretService.getInstance();
}

describe('SecretService.quarantineUndecryptableSecrets', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockConnect.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renames and deactivates undecryptable rows, leaving healthy rows untouched', async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, key, value_ciphertext')) {
        return Promise.resolve({
          rows: [
            { id: 'id-1', key: 'ANON_KEY', value_ciphertext: 'foreign:anon' },
            { id: 'id-2', key: 'HEALTHY_KEY', value_ciphertext: 'enc:fine' },
            { id: 'id-3', key: 'CRON_SECRET', value_ciphertext: 'foreign:cron' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = await loadSecretService();
    const quarantined = await service.quarantineUndecryptableSecrets();

    expect(quarantined).toEqual(['ANON_KEY', 'CRON_SECRET']);

    const updates = mockPoolQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes('UPDATE system.secrets SET key =')
    );
    expect(updates).toHaveLength(2);

    const [firstKey, firstId] = updates[0][1] as [string, string];
    expect(firstKey).toMatch(/^ANON_KEY_UNRECOVERABLE_\d+$/);
    expect(firstId).toBe('id-1');
    expect(updates[0][0]).toContain('is_active = false');

    const [secondKey, secondId] = updates[1][1] as [string, string];
    expect(secondKey).toMatch(/^CRON_SECRET_UNRECOVERABLE_\d+$/);
    expect(secondId).toBe('id-3');

    // The healthy row must not be touched.
    expect(updates.some(([, params]) => (params as string[])[1] === 'id-2')).toBe(false);
  });

  it('is a no-op when every row decrypts', async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, key, value_ciphertext')) {
        return Promise.resolve({
          rows: [
            { id: 'id-1', key: 'ANON_KEY', value_ciphertext: 'enc:anon' },
            { id: 'id-2', key: 'API_KEY', value_ciphertext: 'enc:api' },
          ],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const service = await loadSecretService();
    const quarantined = await service.quarantineUndecryptableSecrets();

    expect(quarantined).toEqual([]);
    const updates = mockPoolQuery.mock.calls.filter(([sql]) =>
      (sql as string).includes('UPDATE system.secrets')
    );
    expect(updates).toHaveLength(0);
  });

  it('is a no-op on an empty secrets table', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [] });

    const service = await loadSecretService();
    await expect(service.quarantineUndecryptableSecrets()).resolves.toEqual([]);
  });
});
