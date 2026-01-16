import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SecretService } from '../../src/services/secrets/secret.service.js';
import logger from '../../src/utils/logger.js';
import { EncryptionManager } from '../../src/infra/security/encryption.manager.js';
import { DatabaseManager } from '../../src/infra/database/database.manager.js';
import type { Pool, PoolClient } from 'pg';

vi.mock('../../src/utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('../../src/infra/security/encryption.manager.js', () => ({
  EncryptionManager: {
    encrypt: vi.fn((value: string) => `encrypted_${value}`),
    decrypt: vi.fn((value: string) => value.replace('encrypted_', '')),
  },
}));

describe('SecretService', () => {
  let secretService: SecretService;

  beforeEach(() => {
    vi.clearAllMocks();
    secretService = SecretService.getInstance();
  });

  describe('getInstance', () => {
    it('returns singleton instance', () => {
      const instance1 = SecretService.getInstance();
      const instance2 = SecretService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('generateApiKey', () => {
    it('generates API key with correct format', () => {
      const apiKey = secretService.generateApiKey();

      expect(apiKey).toMatch(/^ik_/);
      const hexPart = apiKey.replace('ik_', '');
      expect(hexPart).toHaveLength(64);
      expect(hexPart).toMatch(/^[0-9a-f]+$/);
    });

    it('generates unique API keys', () => {
      const key1 = secretService.generateApiKey();
      const key2 = secretService.generateApiKey();

      expect(key1).not.toBe(key2);
    });

    it('generates keys with consistent format', () => {
      const keys = Array.from({ length: 10 }, () => secretService.generateApiKey());

      keys.forEach((key) => {
        expect(key).toMatch(/^ik_[0-9a-f]{64}$/);
      });
    });

    it('generates keys with sufficient entropy', () => {
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(secretService.generateApiKey());
      }
      expect(keys.size).toBe(100);
    });
  });

  describe('rotateApiKey', () => {
    interface MockPoolClient extends Partial<PoolClient> {
      query: ReturnType<typeof vi.fn>;
      release: ReturnType<typeof vi.fn>;
    }

    interface MockPool extends Partial<Pool> {
      connect: ReturnType<typeof vi.fn>;
    }

    let mockQuery: ReturnType<typeof vi.fn>;
    let mockRelease: ReturnType<typeof vi.fn>;
    let mockClient: MockPoolClient;
    let mockPool: MockPool;

    beforeEach(() => {
      SecretService.resetForTesting();
      vi.clearAllMocks();

      mockQuery = vi.fn();
      mockRelease = vi.fn();
      mockClient = {
        query: mockQuery,
        release: mockRelease,
      };

      mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      };

      const getPoolFn = vi.fn().mockReturnValue(mockPool);

      vi.mocked(DatabaseManager.getInstance).mockReturnValue({
        getPool: getPoolFn,
      } as Partial<DatabaseManager> as DatabaseManager);

      secretService = SecretService.getInstance();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('successfully rotates API key - happy path', async () => {
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = secretService.generateApiKey();

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: newSecretId }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await secretService.rotateApiKey();

      expect(result).toBe(mockNewApiKey);
      expect(result).toMatch(/^ik_[0-9a-f]{64}$/);
      expect(mockPool.connect).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledTimes(5);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SELECT id FROM system.secrets'),
        expect.anything()
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE system.secrets'),
        expect.arrayContaining([oldSecretId, 24])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining('INSERT INTO system.secrets'),
        expect.arrayContaining(['API_KEY', expect.stringContaining('encrypted_')])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(5, 'COMMIT');
      expect(generateApiKeySpy).toHaveBeenCalledTimes(1);
      expect(EncryptionManager.encrypt).toHaveBeenCalledTimes(1);
      expect(EncryptionManager.encrypt).toHaveBeenCalledWith(mockNewApiKey);
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('API key rotated', {
        oldId: oldSecretId,
        newId: newSecretId,
      });
      expect(mockRelease).toHaveBeenCalledTimes(1);

      generateApiKeySpy.mockRestore();
    });

    it('rolls back transaction when create operation fails', async () => {
      const oldSecretId = 'old-secret-id-123';
      const mockNewApiKey = secretService.generateApiKey();
      const dbError = new Error('Database insert failed');

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce({ rows: [] });

      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      expect(mockQuery).toHaveBeenCalledTimes(5);
      expect(mockQuery).toHaveBeenNthCalledWith(5, 'ROLLBACK');
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });
      expect(mockRelease).toHaveBeenCalledTimes(1);

      generateApiKeySpy.mockRestore();
    });

    it('succeeds even when logger.info throws after COMMIT', async () => {
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = secretService.generateApiKey();
      const loggerError = new Error('Logger failed');

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      const loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {
        throw loggerError;
      });

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: newSecretId }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await secretService.rotateApiKey();

      expect(result).toBe(mockNewApiKey);
      expect(mockQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockQuery).not.toHaveBeenCalledWith('ROLLBACK');
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to log API key rotation', {
        error: loggerError,
      });
      expect(mockRelease).toHaveBeenCalledTimes(1);

      generateApiKeySpy.mockRestore();
      loggerInfoSpy.mockRestore();
    });

    it('throws error when no active API key is found', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockQuery).toHaveBeenNthCalledWith(3, 'ROLLBACK');
      expect(EncryptionManager.encrypt).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to rotate API key',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws error and rolls back when database query fails during SELECT', async () => {
      const dbError = new Error('Database connection failed');

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce({ rows: [] });

      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(3, 'ROLLBACK');
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws error and rolls back when UPDATE operation fails', async () => {
      const oldSecretId = 'old-secret-id-123';
      const dbError = new Error('Update operation failed');

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce({ rows: [] });

      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery).toHaveBeenNthCalledWith(4, 'ROLLBACK');
      expect(EncryptionManager.encrypt).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws error and rolls back when BEGIN transaction fails', async () => {
      const dbError = new Error('Cannot begin transaction');

      mockQuery.mockRejectedValueOnce(dbError);

      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockQuery).toHaveBeenNthCalledWith(2, 'ROLLBACK');
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('ensures original active key remains active when transaction fails', async () => {
      const oldSecretId = 'old-secret-id-123';
      const mockNewApiKey = secretService.generateApiKey();
      const dbError = new Error('Database insert failed');

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      let updateCalled = false;
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockImplementationOnce(async () => {
          updateCalled = true;
          return { rows: [] };
        })
        .mockRejectedValueOnce(dbError)
        .mockResolvedValueOnce({ rows: [] });

      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      expect(updateCalled).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');

      generateApiKeySpy.mockRestore();
    });

    it('encrypts the new API key before storing', async () => {
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = secretService.generateApiKey();
      const encryptedValue = 'encrypted_test_value';

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      const encryptSpy = vi.spyOn(EncryptionManager, 'encrypt').mockReturnValue(encryptedValue);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: newSecretId }] })
        .mockResolvedValueOnce({ rows: [] });

      await secretService.rotateApiKey();

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith(mockNewApiKey);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO system.secrets'),
        ['API_KEY', encryptedValue, true]
      );

      generateApiKeySpy.mockRestore();
      encryptSpy.mockRestore();
    });

    it('supports custom grace period for API key rotation', async () => {
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = secretService.generateApiKey();
      const customGracePeriod = 48;

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: newSecretId }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await secretService.rotateApiKey(customGracePeriod);

      expect(result).toBe(mockNewApiKey);
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE system.secrets'),
        expect.arrayContaining([oldSecretId, customGracePeriod])
      );

      generateApiKeySpy.mockRestore();
    });

    it('supports immediate revocation when grace period is 0', async () => {
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = secretService.generateApiKey();

      const generateApiKeySpy = vi
        .spyOn(secretService, 'generateApiKey')
        .mockReturnValue(mockNewApiKey);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: oldSecretId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: newSecretId }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await secretService.rotateApiKey(0);

      expect(result).toBe(mockNewApiKey);
      const updateCall = mockQuery.mock.calls.find(
        (call) =>
          call[0]?.includes('UPDATE system.secrets') && call[0]?.includes('expires_at = NOW()')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[1]).toEqual([oldSecretId]);

      generateApiKeySpy.mockRestore();
    });
  });
});
