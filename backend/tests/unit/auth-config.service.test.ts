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

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  __esModule: true,
  default: mockLogger,
  logger: mockLogger,
}));

import { AuthConfigService } from '../../src/services/auth/auth-config.service';
import { logger } from '../../src/utils/logger';

describe('AuthConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateRedirectUrl', () => {
    it('returns true and logs a warning when no allowed redirect URLs are configured (Maintainer feedback)', async () => {
      // Mock getAuthConfig to return empty whitelist
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            allowedRedirectUrls: [],
          },
        ],
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SECURITY WARNING'));
    });

    it('returns true and logs a warning when allowedRedirectUrls is null (CodeRabbit feedback)', async () => {
      // Mock getAuthConfig to return null whitelist (DB default)
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            allowedRedirectUrls: null,
          },
        ],
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('SECURITY WARNING'));
    });

    it('returns true when URL is in the whitelist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            allowedRedirectUrls: ['https://myapp.com'],
          },
        ],
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://myapp.com');

      expect(isValid).toBe(true);
    });

    it('returns false when URL is not in the whitelist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            allowedRedirectUrls: ['https://myapp.com'],
          },
        ],
      });

      const service = AuthConfigService.getInstance();
      const isValid = await service.validateRedirectUrl('https://attacker.com');

      expect(isValid).toBe(false);
    });

    it('handles wildcards correctly', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            allowedRedirectUrls: ['https://*.myapp.com'],
          },
        ],
      });

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://sub.myapp.com')).toBe(true);
      expect(await service.validateRedirectUrl('https://other.com')).toBe(false);
    });

    it('handles multiple URLs in whitelist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [
          {
            allowedRedirectUrls: ['https://myapp.com', 'https://otherapp.io'],
          },
        ],
      });

      const service = AuthConfigService.getInstance();
      expect(await service.validateRedirectUrl('https://myapp.com')).toBe(true);
      expect(await service.validateRedirectUrl('https://otherapp.io')).toBe(true);
      expect(await service.validateRedirectUrl('https://malicious.com')).toBe(false);
    });
  });
});
