import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SecretService } from '../../src/services/secrets/secret.service.js';
import logger from '../../src/utils/logger.js';
import { EncryptionManager } from '../../src/infra/security/encryption.manager.js';
import { DatabaseManager } from '../../src/infra/database/database.manager.js';

// Mock dependencies
vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: vi.fn(),
  },
}));

vi.mock('../../src/infra/security/encryption.manager', () => ({
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

      // Should start with 'ik_'
      expect(apiKey).toMatch(/^ik_/);

      // Should be 64 hex characters after prefix (32 bytes = 64 hex chars)
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
      // Generate 100 keys and ensure they're all unique
      const keys = new Set();
      for (let i = 0; i < 100; i++) {
        keys.add(secretService.generateApiKey());
      }

      // All 100 keys should be unique
      expect(keys.size).toBe(100);
    });
  });

  describe('rotateApiKey', () => {
    let mockPool: any;
    let mockClient: any;
    let mockQuery: ReturnType<typeof vi.fn>;
    let mockRelease: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Create mock client with query and release methods
      mockQuery = vi.fn();
      mockRelease = vi.fn();
      mockClient = {
        query: mockQuery,
        release: mockRelease,
      };

      // Create mock pool that returns the mock client
      mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
      };

      // Mock DatabaseManager to return our mock pool
      vi.mocked(DatabaseManager.getInstance).mockReturnValue({
        getPool: vi.fn().mockReturnValue(mockPool),
      } as any);

      // Clear the pool cache in SecretService by getting a fresh instance
      // Note: Since it's a singleton, we need to handle this carefully
      secretService = SecretService.getInstance();
    });

    afterEach(() => {
      vi.clearAllMocks();
    });

    it('successfully rotates API key - happy path', async () => {
      // Arrange
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = 'ik_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';

      // Mock generateApiKey
      const generateApiKeySpy = vi.spyOn(secretService, 'generateApiKey').mockReturnValue(mockNewApiKey);

      // Mock database queries
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN (no rows)
        .mockResolvedValueOnce({
          rows: [{ id: oldSecretId }],
        }) // SELECT for old secret
        .mockResolvedValueOnce({ rows: [] }) // UPDATE to deactivate old secret
        .mockResolvedValueOnce({
          rows: [{ id: newSecretId }],
        }) // INSERT new secret
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      // Act
      const result = await secretService.rotateApiKey();

      // Assert
      expect(result).toBe(mockNewApiKey);
      expect(result).toMatch(/^ik_[0-9a-f]{64}$/);

      // Verify pool.connect was called
      expect(mockPool.connect).toHaveBeenCalledTimes(1);

      // Verify transaction flow
      expect(mockQuery).toHaveBeenCalledTimes(5);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockQuery).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining("SELECT id FROM system.secrets"),
        expect.anything()
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("UPDATE system.secrets"),
        [oldSecretId]
      );
      expect(mockQuery).toHaveBeenNthCalledWith(
        4,
        expect.stringContaining("INSERT INTO system.secrets"),
        expect.arrayContaining(['API_KEY', expect.stringContaining('encrypted_')])
      );
      expect(mockQuery).toHaveBeenNthCalledWith(5, 'COMMIT');

      // Verify generateApiKey was called
      expect(generateApiKeySpy).toHaveBeenCalledTimes(1);

      // Verify EncryptionManager.encrypt was called with the new API key
      expect(EncryptionManager.encrypt).toHaveBeenCalledTimes(1);
      expect(EncryptionManager.encrypt).toHaveBeenCalledWith(mockNewApiKey);

      // Verify logger.info was called with correct parameters
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith('API key rotated', {
        oldId: oldSecretId,
        newId: newSecretId,
      });

      // Verify client was released
      expect(mockRelease).toHaveBeenCalledTimes(1);

      generateApiKeySpy.mockRestore();
    });

    it('rolls back transaction when create operation fails', async () => {
      // Arrange
      const oldSecretId = 'old-secret-id-123';
      const mockNewApiKey = 'ik_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const dbError = new Error('Database insert failed');

      // Mock generateApiKey
      const generateApiKeySpy = vi.spyOn(secretService, 'generateApiKey').mockReturnValue(mockNewApiKey);

      // Mock database queries - fail on INSERT
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: oldSecretId }],
        }) // SELECT for old secret
        .mockResolvedValueOnce({ rows: [] }) // UPDATE to deactivate old secret
        .mockRejectedValueOnce(dbError) // INSERT fails
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify ROLLBACK was called
      expect(mockQuery).toHaveBeenCalledTimes(5);
      expect(mockQuery).toHaveBeenNthCalledWith(5, 'ROLLBACK');

      // Verify logger.error was called
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });

      // Verify client was released even on error
      expect(mockRelease).toHaveBeenCalledTimes(1);

      generateApiKeySpy.mockRestore();
    });

    it('rolls back transaction when logger.info throws', async () => {
      // Arrange
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = 'ik_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const loggerError = new Error('Logger failed');

      // Mock generateApiKey
      const generateApiKeySpy = vi.spyOn(secretService, 'generateApiKey').mockReturnValue(mockNewApiKey);

      // Mock logger.info to throw after COMMIT
      const loggerInfoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {
        throw loggerError;
      });

      // Mock database queries
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: oldSecretId }],
        }) // SELECT for old secret
        .mockResolvedValueOnce({ rows: [] }) // UPDATE to deactivate old secret
        .mockResolvedValueOnce({
          rows: [{ id: newSecretId }],
        }) // INSERT new secret
        .mockResolvedValueOnce({ rows: [] }) // COMMIT
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK (after logger throws)

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify COMMIT was attempted first
      expect(mockQuery).toHaveBeenCalledWith('COMMIT');

      // Verify ROLLBACK was called after error
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');

      // Verify logger.error was called
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: loggerError });

      // Verify client was released
      expect(mockRelease).toHaveBeenCalledTimes(1);

      generateApiKeySpy.mockRestore();
      loggerInfoSpy.mockRestore();
    });

    it('throws error when no active API key is found', async () => {
      // Arrange
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // SELECT returns no active key
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify transaction was rolled back
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockQuery).toHaveBeenNthCalledWith(3, 'ROLLBACK');

      // Verify generateApiKey was NOT called when no active key exists
      expect(EncryptionManager.encrypt).not.toHaveBeenCalled();

      // Verify logger.error was called
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to rotate API key',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );

      // Verify client was released
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws error and rolls back when database query fails during SELECT', async () => {
      // Arrange
      const dbError = new Error('Database connection failed');

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockRejectedValueOnce(dbError) // SELECT fails
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify ROLLBACK was called
      expect(mockQuery).toHaveBeenCalledTimes(3);
      expect(mockQuery).toHaveBeenNthCalledWith(3, 'ROLLBACK');

      // Verify logger.error was called with the original error
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });

      // Verify client was released
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws error and rolls back when UPDATE operation fails', async () => {
      // Arrange
      const oldSecretId = 'old-secret-id-123';
      const dbError = new Error('Update operation failed');

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: oldSecretId }],
        }) // SELECT succeeds
        .mockRejectedValueOnce(dbError) // UPDATE fails
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify ROLLBACK was called
      expect(mockQuery).toHaveBeenCalledTimes(4);
      expect(mockQuery).toHaveBeenNthCalledWith(4, 'ROLLBACK');

      // Verify generateApiKey was NOT called when UPDATE fails
      expect(EncryptionManager.encrypt).not.toHaveBeenCalled();

      // Verify logger.error was called
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });

      // Verify client was released
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('throws error and rolls back when BEGIN transaction fails', async () => {
      // Arrange
      const dbError = new Error('Cannot begin transaction');

      mockQuery.mockRejectedValueOnce(dbError); // BEGIN fails

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify ROLLBACK was called even when BEGIN fails
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenNthCalledWith(1, 'BEGIN');
      expect(mockQuery).toHaveBeenNthCalledWith(2, 'ROLLBACK');

      // Verify logger.error was called
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error).toHaveBeenCalledWith('Failed to rotate API key', { error: dbError });

      // Verify client was released
      expect(mockRelease).toHaveBeenCalledTimes(1);
    });

    it('ensures original active key remains active when transaction fails', async () => {
      // Arrange
      const oldSecretId = 'old-secret-id-123';
      const mockNewApiKey = 'ik_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const dbError = new Error('Database insert failed');

      // Mock generateApiKey
      const generateApiKeySpy = vi.spyOn(secretService, 'generateApiKey').mockReturnValue(mockNewApiKey);

      // Track whether UPDATE was called and verify it was rolled back
      let updateCalled = false;
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: oldSecretId }],
        }) // SELECT for old secret - returns active key
        .mockImplementationOnce(async () => {
          // UPDATE to deactivate old secret
          updateCalled = true;
          return { rows: [] };
        })
        .mockRejectedValueOnce(dbError) // INSERT fails
        .mockResolvedValueOnce({ rows: [] }); // ROLLBACK (reverts the UPDATE)

      // Act & Assert
      await expect(secretService.rotateApiKey()).rejects.toThrow('Failed to rotate API key');

      // Verify UPDATE was attempted (old key deactivation was started)
      expect(updateCalled).toBe(true);

      // Verify ROLLBACK was called, which reverts the UPDATE
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK');

      // The rollback ensures the original UPDATE is reverted, so the old key remains active
      // This is verified by the fact that ROLLBACK was called after the failed INSERT

      generateApiKeySpy.mockRestore();
    });

    it('encrypts the new API key before storing', async () => {
      // Arrange
      const oldSecretId = 'old-secret-id-123';
      const newSecretId = 'new-secret-id-456';
      const mockNewApiKey = 'ik_abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
      const encryptedValue = 'encrypted_test_value';

      // Mock generateApiKey
      const generateApiKeySpy = vi.spyOn(secretService, 'generateApiKey').mockReturnValue(mockNewApiKey);

      // Mock EncryptionManager.encrypt to return specific value
      const encryptSpy = vi.spyOn(EncryptionManager, 'encrypt').mockReturnValue(encryptedValue);

      // Mock database queries
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({
          rows: [{ id: oldSecretId }],
        }) // SELECT for old secret
        .mockResolvedValueOnce({ rows: [] }) // UPDATE to deactivate old secret
        .mockResolvedValueOnce({
          rows: [{ id: newSecretId }],
        }) // INSERT new secret
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      // Act
      await secretService.rotateApiKey();

      // Assert
      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith(mockNewApiKey);

      // Verify the INSERT query was called with the encrypted value
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO system.secrets"),
        ['API_KEY', encryptedValue, true]
      );

      generateApiKeySpy.mockRestore();
      encryptSpy.mockRestore();
    });
  });
});
