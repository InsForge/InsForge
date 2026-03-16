import { AuthConfigService } from './auth-config.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

export class RedirectValidationService {
  private static instance: RedirectValidationService;
  private authConfigService: AuthConfigService;

  private constructor() {
    this.authConfigService = AuthConfigService.getInstance();
  }

  public static getInstance(): RedirectValidationService {
    if (!RedirectValidationService.instance) {
      RedirectValidationService.instance = new RedirectValidationService();
    }
    return RedirectValidationService.instance;
  }

  /**
   * Validate a redirect URL against the whitelist
   * @param redirectUrl The URL to validate
   * @returns true if valid, throws error if invalid
   */
  async validateRedirectUrl(redirectUrl: string): Promise<boolean> {
    try {
      const authConfig = await this.authConfigService.getAuthConfig();
      const whitelist = authConfig.redirectUrlWhitelist || [];

      // If whitelist is empty, allow all redirects (permissive mode for DX)
      if (whitelist.length === 0) {
        logger.warn(
          'Redirect URL whitelist is empty - allowing redirect for development convenience',
          {
            sanitizedRedirect: this.sanitizeUrl(redirectUrl),
            whitelistLength: whitelist.length,
            warning: 'Configure redirect URL whitelist for production security',
          }
        );
        return true;
      }

      // Normalize the redirect URL for comparison
      const normalizedRedirectUrl = this.normalizeUrl(redirectUrl);

      // Check if the normalized URL is in the whitelist
      const isAllowed = whitelist.some((allowedUrl) => {
        const normalizedAllowedUrl = this.normalizeUrl(allowedUrl);
        return normalizedRedirectUrl === normalizedAllowedUrl;
      });

      if (!isAllowed) {
        logger.warn('Redirect URL not in whitelist', {
          sanitizedRedirect: this.sanitizeUrl(normalizedRedirectUrl),
          whitelistLength: whitelist.length,
        });
        throw new AppError(
          `Redirect URL '${redirectUrl}' is not in the allowed whitelist. Please configure the redirect URL whitelist in Auth Settings.`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      return true;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to validate redirect URL', { error, sanitizedRedirect: this.sanitizeUrl(redirectUrl) });
      throw new AppError('Failed to validate redirect URL', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Normalize a URL for comparison by removing trailing slashes and ensuring consistent format
   * @param url The URL to normalize
   * @returns Normalized URL string
   */
  private normalizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove trailing slash from pathname unless it's just "/"
      if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
        urlObj.pathname = urlObj.pathname.slice(0, -1);
      }
      return urlObj.toString();
    } catch (error) {
      // If URL parsing fails, return as-is for basic comparison
      logger.warn('Failed to parse URL for normalization', { sanitizedUrl: this.sanitizeUrl(url), error });
      return url;
    }
  }

  /**
   * Check if the whitelist is configured (non-empty)
   * @returns true if whitelist has URLs configured
   */
  async isWhitelistConfigured(): Promise<boolean> {
    const authConfig = await this.authConfigService.getAuthConfig();
    return (authConfig.redirectUrlWhitelist || []).length > 0;
  }

  /**
   * Sanitize a URL for logging by extracting only origin and path, removing sensitive parts
   * @param url The URL to sanitize
   * @returns Sanitized URL string with only origin and path
   */
  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      return `${urlObj.origin}${urlObj.pathname}`;
    } catch (error) {
      // If URL parsing fails, return a generic placeholder
      return '[invalid-url]';
    }
  }
}
