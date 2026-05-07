import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AuthConfigService } from '../../src/services/auth/auth-config.service';

describe('AuthConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateRedirectUrl', () => {
    it('returns false when no allowed redirect URLs are configured (SEC-002 fix)', async () => {
      // Mock getAuthConfig to return empty whitelist
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          allowedRedirectUrls: []
        }]
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(false);
    });

    it('returns true when URL is in the whitelist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          allowedRedirectUrls: ['https://myapp.com']
        }]
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://myapp.com');

      expect(isValid).toBe(true);
    });

    it('returns false when URL is not in the whitelist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          allowedRedirectUrls: ['https://myapp.com']
        }]
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(false);
    });

    it('handles wildcards correctly', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          allowedRedirectUrls: ['https://*.myapp.com']
        }]
      });

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://sub.myapp.com')).toBe(true);
      expect(await service.validateRedirectUrl('https://other.com')).toBe(false);
    });

    it('handles multiple URLs in whitelist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{
          allowedRedirectUrls: ['https://myapp.com', 'https://otherapp.io']
        }]
      });

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://myapp.com')).toBe(true);
      expect(await service.validateRedirectUrl('https://otherapp.io')).toBe(true);
      expect(await service.validateRedirectUrl('https://malicious.com')).toBe(false);
    });
  });
});
