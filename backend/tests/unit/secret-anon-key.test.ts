import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPoolQuery, mockClientQuery, mockClientRelease, mockConnect } = vi.hoisted(() => {
  const mockClientQuery = vi.fn();
  const mockClientRelease = vi.fn();
  return {
    mockPoolQuery: vi.fn(),
    mockClientQuery,
    mockClientRelease,
    mockConnect: vi.fn().mockResolvedValue({
      query: mockClientQuery,
      release: mockClientRelease,
    }),
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

vi.mock('../../src/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/, ''),
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

describe('SecretService anon key', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    mockClientQuery.mockReset();
    mockClientRelease.mockClear();
    mockConnect.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('generateAnonKey', () => {
    it('generates an opaque key with the anon_ prefix', async () => {
      const service = await loadSecretService();
      const key = service.generateAnonKey();

      expect(key).toMatch(/^anon_[0-9a-f]{64}$/);
      expect(service.generateAnonKey()).not.toBe(key);
    });
  });

  describe('verifyAnonKey', () => {
    it('rejects values without the anon_ prefix without touching the database', async () => {
      const service = await loadSecretService();

      await expect(service.verifyAnonKey('ik_something')).resolves.toBe(false);
      await expect(service.verifyAnonKey('')).resolves.toBe(false);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('accepts the active anon key', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [{ value_ciphertext: 'enc:anon_active', expires_at: null }],
      });
      const service = await loadSecretService();

      await expect(service.verifyAnonKey('anon_active')).resolves.toBe(true);
      await expect(service.verifyAnonKey('anon_wrong')).resolves.toBe(false);
    });

    it('deduplicates concurrent cold-cache loads into one query (no stampede)', async () => {
      mockPoolQuery.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ rows: [{ value_ciphertext: 'enc:anon_active', expires_at: null }] }),
              20
            )
          )
      );
      const service = await loadSecretService();

      const results = await Promise.all([
        service.verifyAnonKey('anon_active'),
        service.verifyAnonKey('anon_active'),
        service.verifyAnonKey('anon_wrong'),
        service.verifyAnonKey('anon_active'),
      ]);

      expect(results).toEqual([true, true, false, true]);
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it('serves repeated verifications from the in-memory cache', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [{ value_ciphertext: 'enc:anon_active', expires_at: null }],
      });
      const service = await loadSecretService();

      await service.verifyAnonKey('anon_active');
      await service.verifyAnonKey('anon_active');
      await service.verifyAnonKey('anon_active');

      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it('accepts a grace-period key until it expires, even when cached', async () => {
      const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
      const pastExpiry = new Date(Date.now() - 1000);
      mockPoolQuery.mockResolvedValue({
        rows: [
          { value_ciphertext: 'enc:anon_new', expires_at: null },
          { value_ciphertext: 'enc:anon_in_grace', expires_at: futureExpiry },
          { value_ciphertext: 'enc:anon_lapsed', expires_at: pastExpiry },
        ],
      });
      const service = await loadSecretService();

      await expect(service.verifyAnonKey('anon_new')).resolves.toBe(true);
      await expect(service.verifyAnonKey('anon_in_grace')).resolves.toBe(true);
      // Returned by the (mocked) query but already expired: must be skipped
      await expect(service.verifyAnonKey('anon_lapsed')).resolves.toBe(false);
    });

    it('refreshes the cache after invalidation', async () => {
      mockPoolQuery.mockResolvedValue({
        rows: [{ value_ciphertext: 'enc:anon_active', expires_at: null }],
      });
      const service = await loadSecretService();

      await service.verifyAnonKey('anon_active');
      service.invalidateAnonKeyCache();
      await service.verifyAnonKey('anon_active');

      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('rotateAnonKey', () => {
    it('moves the old key to a grace-period entry and inserts a new active key', async () => {
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id FROM system.secrets')) {
          return Promise.resolve({ rows: [{ id: 'old-key-id' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const service = await loadSecretService();

      const result = await service.rotateAnonKey(48);

      expect(result.newAnonKey).toMatch(/^anon_[0-9a-f]{64}$/);
      const expectedExpiry = Date.now() + 48 * 60 * 60 * 1000;
      expect(Math.abs(result.oldKeyExpiresAt.getTime() - expectedExpiry)).toBeLessThan(5000);

      const calls = mockClientQuery.mock.calls.map(([sql]) => sql as string);
      expect(calls[0]).toBe('BEGIN');
      expect(calls.at(-1)).toBe('COMMIT');

      const renameCall = mockClientQuery.mock.calls.find(([sql]) =>
        (sql as string).includes('SET key = $1')
      );
      expect(renameCall?.[1]?.[0]).toMatch(/^ANON_KEY_OLD_\d+$/);
      expect(renameCall?.[1]?.[2]).toBe('old-key-id');

      const insertCall = mockClientQuery.mock.calls.find(([sql]) =>
        (sql as string).includes('INSERT INTO system.secrets')
      );
      expect(insertCall?.[0]).toContain("'ANON_KEY'");
      expect(insertCall?.[1]?.[0]).toBe(`enc:${result.newAnonKey}`);
    });

    it('rolls back when no active anon key exists', async () => {
      mockClientQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id FROM system.secrets')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });
      const service = await loadSecretService();

      await expect(service.rotateAnonKey()).rejects.toThrow('Failed to rotate anon key');

      const calls = mockClientQuery.mock.calls.map(([sql]) => sql as string);
      expect(calls).toContain('ROLLBACK');
      expect(calls).not.toContain('COMMIT');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('invalidates the verification cache so the new key is picked up immediately', async () => {
      // Prime the cache with the old key
      mockPoolQuery.mockResolvedValue({
        rows: [{ value_ciphertext: 'enc:anon_old', expires_at: null }],
      });
      const service = await loadSecretService();
      await service.verifyAnonKey('anon_old');
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);

      mockClientQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT id FROM system.secrets')) {
          return Promise.resolve({ rows: [{ id: 'old-key-id' }] });
        }
        return Promise.resolve({ rows: [] });
      });
      const { newAnonKey } = await service.rotateAnonKey();

      mockPoolQuery.mockResolvedValue({
        rows: [{ value_ciphertext: `enc:${newAnonKey}`, expires_at: null }],
      });
      await expect(service.verifyAnonKey(newAnonKey)).resolves.toBe(true);
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });
  });

  describe('initializeAnonKey', () => {
    it('creates a fresh opaque key when none is stored', async () => {
      const service = await loadSecretService();
      const getSecretByKey = vi.spyOn(service, 'getSecretByKey').mockResolvedValue(null);
      const createSecret = vi.spyOn(service, 'createSecret').mockResolvedValue({ id: 'new-id' });

      const key = await service.initializeAnonKey();

      expect(key).toMatch(/^anon_[0-9a-f]{64}$/);
      expect(getSecretByKey).toHaveBeenCalledWith('ANON_KEY');
      expect(createSecret).toHaveBeenCalledWith({
        key: 'ANON_KEY',
        value: key,
        isReserved: true,
      });
    });

    it('migrates a legacy JWT-format anon key to an opaque key', async () => {
      const legacyJwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature';
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue(legacyJwt);
      const updateSecretByKey = vi.spyOn(service, 'updateSecretByKey').mockResolvedValue(true);
      const createSecret = vi.spyOn(service, 'createSecret');

      const key = await service.initializeAnonKey();

      expect(key).toMatch(/^anon_[0-9a-f]{64}$/);
      expect(updateSecretByKey).toHaveBeenCalledWith('ANON_KEY', {
        value: key,
        isReserved: true,
      });
      expect(createSecret).not.toHaveBeenCalled();
    });

    it('keeps an existing opaque key untouched', async () => {
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue('anon_existing');
      const createSecret = vi.spyOn(service, 'createSecret');
      const updateSecretByKey = vi.spyOn(service, 'updateSecretByKey');

      await expect(service.initializeAnonKey()).resolves.toBe('anon_existing');
      expect(createSecret).not.toHaveBeenCalled();
      expect(updateSecretByKey).not.toHaveBeenCalled();
    });

    it('seeds from the ACCESS_ANON_KEY environment variable when no key is stored', async () => {
      vi.stubEnv('ACCESS_ANON_KEY', 'anon_from_environment');
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue(null);
      const createSecret = vi.spyOn(service, 'createSecret').mockResolvedValue({ id: 'new-id' });

      await expect(service.initializeAnonKey()).resolves.toBe('anon_from_environment');
      expect(createSecret).toHaveBeenCalledWith({
        key: 'ANON_KEY',
        value: 'anon_from_environment',
        isReserved: true,
      });
    });

    it('normalizes an env-provided key without the anon_ prefix', async () => {
      vi.stubEnv('ACCESS_ANON_KEY', 'bare-environment-key');
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue(null);
      vi.spyOn(service, 'createSecret').mockResolvedValue({ id: 'new-id' });

      await expect(service.initializeAnonKey()).resolves.toBe('anon_bare-environment-key');
    });

    it('trims whitespace from the env-provided key before storing', async () => {
      vi.stubEnv('ACCESS_ANON_KEY', '  anon_padded_key  ');
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue(null);
      vi.spyOn(service, 'createSecret').mockResolvedValue({ id: 'new-id' });

      await expect(service.initializeAnonKey()).resolves.toBe('anon_padded_key');
    });

    it('generates a key when the env value is only whitespace', async () => {
      vi.stubEnv('ACCESS_ANON_KEY', '   ');
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue(null);
      vi.spyOn(service, 'createSecret').mockResolvedValue({ id: 'new-id' });

      await expect(service.initializeAnonKey()).resolves.toMatch(/^anon_[0-9a-f]{64}$/);
    });

    it('prefers the stored key over the environment variable', async () => {
      vi.stubEnv('ACCESS_ANON_KEY', 'anon_from_environment');
      const service = await loadSecretService();
      vi.spyOn(service, 'getSecretByKey').mockResolvedValue('anon_stored');
      const createSecret = vi.spyOn(service, 'createSecret');

      await expect(service.initializeAnonKey()).resolves.toBe('anon_stored');
      expect(createSecret).not.toHaveBeenCalled();
    });
  });
});
