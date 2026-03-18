import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';

type ConfigParamValue = string | number | boolean | null | string[];

export class AuthConfigService {
  private static instance: AuthConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('AuthConfigService initialized');
  }

  public static getInstance(): AuthConfigService {
    if (!AuthConfigService.instance) {
      AuthConfigService.instance = new AuthConfigService();
    }
    return AuthConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Validate a redirect URL against the whitelist stored in the auth config.
   *
   * Behaviour:
   * - If the whitelist is empty the call is a no-op (permissive / dev-mode).
   * - If the whitelist is non-empty and the URL does not match any entry an
   *   AppError(400, INVALID_INPUT) is thrown.
   *
   * @param redirectUrl  The URL that the auth flow wants to redirect to.
   */
  async validateRedirectUrl(redirectUrl: string): Promise<void> {
    const config = await this.getAuthConfig();
    const whitelist = config.redirectUrlWhitelist ?? [];

    if (!whitelist || whitelist.length === 0) {
      // Empty whitelist — permissive mode (development-friendly default)
      logger.warn(
        '[Auth] Redirect URL whitelist is empty — redirect accepted without validation. ' +
          'Configure a whitelist in Auth Settings for production deployments.',
        { redirectUrl }
      );
      return;
    }

    const allowed = whitelist.some((entry) => this.matchesEntry(redirectUrl, entry));
    if (!allowed) {
      logger.warn('[Auth] Redirect URL rejected — not on whitelist', { redirectUrl });
      throw new AppError(
        `Redirect URL '${redirectUrl}' is not allowed. Add it to the redirect URL whitelist in Auth Settings.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    logger.debug('[Auth] Redirect URL validated against whitelist', { redirectUrl });
  }

  /**
   * Normalise a URL string so that comparisons are consistent.
   * - Lowercases the scheme and hostname (they are case-insensitive per RFC 3986)
   * - Strips a trailing slash from the path so https://a.com/ and https://a.com compare equal
   * - Preserves path, query and fragment exactly as given
   */
  private normalizeUrl(raw: string): string {
    try {
      const parsed = new URL(raw);
      // Lowercase scheme and host (RFC 3986 §6.2.2.1)
      parsed.protocol = parsed.protocol.toLowerCase();
      parsed.hostname = parsed.hostname.toLowerCase();
      // Strip a bare trailing slash (path is just '/') to treat https://a.com and https://a.com/ as equal
      let href = parsed.href;
      if (parsed.pathname === '/' && !parsed.search && !parsed.hash) {
        href = href.replace(/\/$/, '');
      }
      return href;
    } catch {
      return raw;
    }
  }

  /**
   * Determine whether `candidate` matches a single whitelist `entry`.
   *
   * Matching rules (in priority order):
   * 1. Exact match after normalisation.
   * 2. Wildcard subdomain: if the entry starts with '*.' the rest is treated as
   *    a suffix pattern — e.g. '*.example.com' matches 'app.example.com' but
   *    NOT 'example.com' itself (the wildcard requires at least one subdomain
   *    label).  Scheme and port must still match exactly.
   */
  private matchesEntry(candidate: string, entry: string): boolean {
    const normCandidate = this.normalizeUrl(candidate);
    const normEntry = this.normalizeUrl(entry);

    // 1. Exact match
    if (normCandidate === normEntry) {
      return true;
    }

    // 2. Wildcard subdomain — entry may be '*.example.com' or 'https://*.example.com'
    const wildcardMatch = entry.match(/^(https?:\/\/)?\*\.(.+)$/);
    if (wildcardMatch) {
      try {
        const entryScheme = wildcardMatch[1] || 'https://';
        const entrySuffix = wildcardMatch[2];
        const hasExplicitPath = /[/?#]/.test(entrySuffix);
        const entryUrl = new URL(entryScheme + 'placeholder.' + entrySuffix);
        const parsedCandidate = new URL(candidate);

        // Scheme must match
        if (parsedCandidate.protocol.toLowerCase() !== entryUrl.protocol.toLowerCase()) {
          return false;
        }
        // Port must match
        if (parsedCandidate.port !== entryUrl.port) {
          return false;
        }
        // Hostname of candidate must end with '.<suffix>'
        const suffix = entryUrl.hostname.replace(/^placeholder\./, '').toLowerCase();
        const candidateHost = parsedCandidate.hostname.toLowerCase();
        if (!candidateHost.endsWith('.' + suffix)) {
          return false;
        }
        // Ensure there is exactly one extra label (no multi-level wildcards)
        const extraPart = candidateHost.slice(0, candidateHost.length - suffix.length - 1);
        if (!extraPart || extraPart.includes('.')) {
          return false;
        }
        // If entry includes explicit path/query/hash, enforce exact match for those parts.
        // Otherwise '*.example.com' matches any path on matching subdomains.
        if (hasExplicitPath) {
          if (parsedCandidate.pathname !== entryUrl.pathname) {
            return false;
          }
          if (entryUrl.search && parsedCandidate.search !== entryUrl.search) {
            return false;
          }
          if (entryUrl.hash && parsedCandidate.hash !== entryUrl.hash) {
            return false;
          }
        }
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Get public authentication configuration (safe for public API)
   * Returns all configuration fields except metadata (id, created_at, updated_at)
   * and sensitive fields (redirectUrlWhitelist).
   */
  async getPublicAuthConfig() {
    try {
      const result = await this.getPool().query(
        `SELECT
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar",
          verify_email_method as "verifyEmailMethod",
          reset_password_method as "resetPasswordMethod"
         FROM auth.configs
         LIMIT 1`
      );

      // If no config exists, return fallback values
      if (!result.rows.length) {
        logger.warn('No auth config found, returning default fallback values');
        return {
          requireEmailVerification: false,
          passwordMinLength: 6,
          requireNumber: false,
          requireLowercase: false,
          requireUppercase: false,
          requireSpecialChar: false,
          verifyEmailMethod: 'code' as const,
          resetPasswordMethod: 'code' as const,
        };
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get public auth config', { error });
      throw new AppError(
        'Failed to get authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Get authentication configuration
   * Returns the singleton configuration row with all columns
   */
  async getAuthConfig(): Promise<AuthConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          require_email_verification as "requireEmailVerification",
          password_min_length as "passwordMinLength",
          require_number as "requireNumber",
          require_lowercase as "requireLowercase",
          require_uppercase as "requireUppercase",
          require_special_char as "requireSpecialChar",
          verify_email_method as "verifyEmailMethod",
          reset_password_method as "resetPasswordMethod",
          COALESCE(redirect_url_whitelist, '{}') as "redirectUrlWhitelist",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.configs
         LIMIT 1`
      );

      // If no config exists, return fallback values
      if (!result.rows.length) {
        logger.warn('No auth config found, returning default fallback values');
        // Return a config with fallback values and generate a temporary ID
        return {
          id: '00000000-0000-0000-0000-000000000000',
          requireEmailVerification: false,
          passwordMinLength: 6,
          requireNumber: false,
          requireLowercase: false,
          requireUppercase: false,
          requireSpecialChar: false,
          verifyEmailMethod: 'code' as const,
          resetPasswordMethod: 'code' as const,
          redirectUrlWhitelist: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get auth config', { error });
      throw new AppError(
        'Failed to get authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Update authentication configuration
   * Updates the singleton configuration row
   */
  async updateAuthConfig(input: UpdateAuthConfigRequest): Promise<AuthConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Ensure config exists and lock row to prevent concurrent modifications
      const existingResult = await client.query('SELECT id FROM auth.configs LIMIT 1 FOR UPDATE');

      if (!existingResult.rows.length) {
        // Config doesn't exist, rollback and throw error
        // The migration should have created the default config
        await client.query('ROLLBACK');
        throw new AppError(
          'Authentication configuration not found. Please run migrations.',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      // Build update query
      const updates: string[] = [];
      const values: ConfigParamValue[] = [];
      let paramCount = 1;

      if (input.requireEmailVerification !== undefined) {
        updates.push(`require_email_verification = $${paramCount++}`);
        values.push(input.requireEmailVerification);
      }

      if (input.passwordMinLength !== undefined) {
        updates.push(`password_min_length = $${paramCount++}`);
        values.push(input.passwordMinLength);
      }

      if (input.requireNumber !== undefined) {
        updates.push(`require_number = $${paramCount++}`);
        values.push(input.requireNumber);
      }

      if (input.requireLowercase !== undefined) {
        updates.push(`require_lowercase = $${paramCount++}`);
        values.push(input.requireLowercase);
      }

      if (input.requireUppercase !== undefined) {
        updates.push(`require_uppercase = $${paramCount++}`);
        values.push(input.requireUppercase);
      }

      if (input.requireSpecialChar !== undefined) {
        updates.push(`require_special_char = $${paramCount++}`);
        values.push(input.requireSpecialChar);
      }

      if (input.verifyEmailMethod !== undefined) {
        updates.push(`verify_email_method = $${paramCount++}`);
        values.push(input.verifyEmailMethod);
      }

      if (input.resetPasswordMethod !== undefined) {
        updates.push(`reset_password_method = $${paramCount++}`);
        values.push(input.resetPasswordMethod);
      }

      if (input.redirectUrlWhitelist !== undefined) {
        updates.push(`redirect_url_whitelist = $${paramCount++}`);
        // pg accepts JS arrays for PostgreSQL array columns directly
        values.push(input.redirectUrlWhitelist);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        // Return current config if no updates
        return await this.getAuthConfig();
      }

      // Add updated_at to updates
      updates.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE auth.configs
         SET ${updates.join(', ')}
         RETURNING
           id,
           require_email_verification as "requireEmailVerification",
           password_min_length as "passwordMinLength",
           require_number as "requireNumber",
           require_lowercase as "requireLowercase",
           require_uppercase as "requireUppercase",
           require_special_char as "requireSpecialChar",
           verify_email_method as "verifyEmailMethod",
           reset_password_method as "resetPasswordMethod",
           COALESCE(redirect_url_whitelist, '{}') as "redirectUrlWhitelist",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        values
      );

      await client.query('COMMIT');
      logger.info('Auth config updated', { updatedFields: Object.keys(input) });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update auth config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'Failed to update authentication configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }
}
