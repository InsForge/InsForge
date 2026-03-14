import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RedirectValidationService } from '@/services/auth/redirect-validation.service.js';
import { AuthConfigService } from '@/services/auth/auth-config.service.js';

// Mock the AuthConfigService
vi.mock('@/services/auth/auth-config.service.js');

describe('RedirectValidationService', () => {
  let redirectValidationService: RedirectValidationService;
  let mockAuthConfigService: any;

  beforeEach(() => {
    // Clear all mocks
    vi.clearAllMocks();

    // Create mock AuthConfigService
    mockAuthConfigService = {
      getAuthConfig: vi.fn(),
    };

    // Mock the getInstance method
    (AuthConfigService.getInstance as any).mockReturnValue(mockAuthConfigService);

    // Reset the singleton instance to get a fresh one with the mock
    (RedirectValidationService as any).instance = null;
    redirectValidationService = RedirectValidationService.getInstance();
  });

  describe('validateRedirectUrl', () => {
    it('should allow any URL when whitelist is empty', async () => {
      mockAuthConfigService.getAuthConfig.mockResolvedValue({
        redirectUrlWhitelist: [],
      });

      const result = await redirectValidationService.validateRedirectUrl('https://example.com/callback');

      expect(result).toBe(true);
      expect(mockAuthConfigService.getAuthConfig).toHaveBeenCalledTimes(1);
    });

    it('should allow URL that is in whitelist', async () => {
      mockAuthConfigService.getAuthConfig.mockResolvedValue({
        redirectUrlWhitelist: ['https://example.com/callback', 'https://app.com/redirect'],
      });

      const result = await redirectValidationService.validateRedirectUrl('https://example.com/callback');

      expect(result).toBe(true);
      expect(mockAuthConfigService.getAuthConfig).toHaveBeenCalledTimes(1);
    });

    it('should reject URL that is not in whitelist', async () => {
      mockAuthConfigService.getAuthConfig.mockResolvedValue({
        redirectUrlWhitelist: ['https://example.com/callback'],
      });

      await expect(
        redirectValidationService.validateRedirectUrl('https://evil.com/callback')
      ).rejects.toThrow('Redirect URL \'https://evil.com/callback\' is not in the allowed whitelist');
      expect(mockAuthConfigService.getAuthConfig).toHaveBeenCalledTimes(1);
    });

    it('should normalize URLs for comparison', async () => {
      mockAuthConfigService.getAuthConfig.mockResolvedValue({
        redirectUrlWhitelist: ['https://example.com/callback'],
      });

      // Should allow URL with trailing slash removed
      const result = await redirectValidationService.validateRedirectUrl('https://example.com/callback/');

      expect(result).toBe(true);
      expect(mockAuthConfigService.getAuthConfig).toHaveBeenCalledTimes(1);
    });
  });

  describe('isWhitelistConfigured', () => {
    it('should return true when whitelist has URLs', async () => {
      mockAuthConfigService.getAuthConfig.mockResolvedValue({
        redirectUrlWhitelist: ['https://example.com'],
      });

      const result = await redirectValidationService.isWhitelistConfigured();

      expect(result).toBe(true);
      expect(mockAuthConfigService.getAuthConfig).toHaveBeenCalledTimes(1);
    });

    it('should return false when whitelist is empty', async () => {
      mockAuthConfigService.getAuthConfig.mockResolvedValue({
        redirectUrlWhitelist: [],
      });

      const result = await redirectValidationService.isWhitelistConfigured();

      expect(result).toBe(false);
      expect(mockAuthConfigService.getAuthConfig).toHaveBeenCalledTimes(1);
    });
  });
});