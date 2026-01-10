import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SecretService } from '../../src/services/secrets/secret.service.js';

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
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({
        connect: vi.fn(),
        query: vi.fn(),
      })),
    })),
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
});
