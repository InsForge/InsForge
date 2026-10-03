import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

// Regression tests: a failed database lookup during credential verification is
// an infrastructure fault and must surface as 503, not as "invalid API key".
// Before this, pool exhaustion ("sorry, too many clients already") made every
// valid key look rejected with 401.

const { mockPoolQuery, mockConnect } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockConnect: vi.fn(),
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => ({ query: mockPoolQuery, connect: mockConnect }),
    }),
  },
}));

vi.mock('../../src/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/, ''),
  },
}));

const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({ default: loggerMocks }));

async function loadSecretService() {
  const { SecretService } = await import('../../src/services/secrets/secret.service.js');
  return SecretService.getInstance();
}

const dbDown = () => new Error('sorry, too many clients already');

describe('credential checks when the database lookup fails', () => {
  beforeEach(() => {
    vi.resetModules();
    mockPoolQuery.mockReset();
    loggerMocks.error.mockClear();
    loggerMocks.warn.mockClear();
    vi.stubEnv('ACCESS_ANON_KEY', '');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('verifyApiKey', () => {
    it('throws 503 AUTH_UNAVAILABLE when the active-key lookup fails', async () => {
      const service = await loadSecretService();
      mockPoolQuery.mockRejectedValueOnce(dbDown());

      await expect(service.verifyApiKey('ik_valid')).rejects.toMatchObject({
        statusCode: 503,
        code: ERROR_CODES.AUTH_UNAVAILABLE,
      });
      expect(loggerMocks.error).toHaveBeenCalledWith('Failed to check secret', {
        error: 'sorry, too many clients already',
      });
    });

    it('throws 503 when the grace-period lookup fails', async () => {
      const service = await loadSecretService();
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ value_ciphertext: 'enc:ik_other' }] }) // active key: mismatch
        .mockRejectedValueOnce(dbDown()); // grace-period query

      await expect(service.verifyApiKey('ik_rotated')).rejects.toMatchObject({
        statusCode: 503,
        code: ERROR_CODES.AUTH_UNAVAILABLE,
      });
    });

    it('still returns false for a genuinely wrong key', async () => {
      const service = await loadSecretService();
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ value_ciphertext: 'enc:ik_real' }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(service.verifyApiKey('ik_wrong')).resolves.toBe(false);
    });

    it('still returns true for the active key', async () => {
      const service = await loadSecretService();
      mockPoolQuery.mockResolvedValueOnce({ rows: [{ value_ciphertext: 'enc:ik_real' }] });

      await expect(service.verifyApiKey('ik_real')).resolves.toBe(true);
    });
  });

  describe('verifyAnonKey', () => {
    it('throws 503 when keys cannot be loaded and nothing is cached', async () => {
      const service = await loadSecretService();
      mockPoolQuery.mockRejectedValueOnce(dbDown());

      await expect(service.verifyAnonKey('anon_abc')).rejects.toMatchObject({
        statusCode: 503,
        code: ERROR_CODES.AUTH_UNAVAILABLE,
      });
    });

    it('serves the expired cache when the refresh fails', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
      const service = await loadSecretService();
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ value_ciphertext: 'enc:anon_abc', expires_at: null }] })
        .mockRejectedValue(dbDown()); // the database stays down for the rest of the test

      await expect(service.verifyAnonKey('anon_abc')).resolves.toBe(true);
      vi.advanceTimersByTime(61_000); // past ANON_KEY_CACHE_TTL_MS
      await expect(service.verifyAnonKey('anon_abc')).resolves.toBe(true);
      await expect(service.verifyAnonKey('anon_nope')).resolves.toBe(false);
      expect(loggerMocks.warn).toHaveBeenCalledWith(
        'Failed to refresh anon keys; serving cached keys',
        { error: 'sorry, too many clients already' }
      );
    });

    it('backs off between refresh attempts while serving the expired cache', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
      const service = await loadSecretService();
      mockPoolQuery
        .mockResolvedValueOnce({ rows: [{ value_ciphertext: 'enc:anon_abc', expires_at: null }] })
        .mockRejectedValue(dbDown());

      await service.verifyAnonKey('anon_abc'); // initial load: query 1
      vi.advanceTimersByTime(61_000);
      for (let i = 0; i < 20; i++) {
        await expect(service.verifyAnonKey('anon_abc')).resolves.toBe(true);
      }
      // One failed refresh, then 19 requests served from cache without a query.
      expect(mockPoolQuery).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(5_001); // past ANON_KEY_REFRESH_RETRY_MS
      await service.verifyAnonKey('anon_abc');
      expect(mockPoolQuery).toHaveBeenCalledTimes(3);
    });

    it('does not serve pre-rotation keys when a rotation lands during a failed refresh', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
      const service = await loadSecretService();
      mockPoolQuery.mockResolvedValueOnce({
        rows: [{ value_ciphertext: 'enc:anon_old', expires_at: null }],
      });
      await expect(service.verifyAnonKey('anon_old')).resolves.toBe(true);
      vi.advanceTimersByTime(61_000);

      // The refresh is held open; a rotation invalidates the cache meanwhile,
      // then the refresh fails.
      let failRefresh!: (error: Error) => void;
      mockPoolQuery.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            failRefresh = reject;
          })
      );
      const pending = service.verifyAnonKey('anon_old');
      service.invalidateAnonKeyCache();
      failRefresh(dbDown());

      await expect(pending).rejects.toMatchObject({
        statusCode: 503,
        code: ERROR_CODES.AUTH_UNAVAILABLE,
      });
    });
  });
});
