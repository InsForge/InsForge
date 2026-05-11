import { Pool } from 'pg';
import picomatch from 'picomatch';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { AuthConfigSchema, UpdateAuthConfigRequest } from '@insforge/shared-schemas';
import { URL } from 'url';

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
   * Get public authentication configuration (safe for public API)
   * Returns all configuration fields except metadata (id, created_at, updated_at)
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
          reset_password_method as "resetPasswordMethod",
          disable_signup as "disableSignup"
         FROM auth.config
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
          disableSignup: false,
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
          allowed_redirect_urls as "allowedRedirectUrls",
          disable_signup as "disableSignup",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM auth.config
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
          allowedRedirectUrls: [],
          disableSignup: false,
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

      // Ensure the singleton config row exists before we try to lock and update it.
      await client.query('INSERT INTO auth.config DEFAULT VALUES ON CONFLICT DO NOTHING');

      // Lock the singleton row to prevent concurrent modifications.
      const existingResult = await client.query('SELECT id FROM auth.config LIMIT 1 FOR UPDATE');

      if (!existingResult.rows.length) {
        // Config doesn't exist, rollback and throw error
        // The migration should have created the default config
        await client.query('ROLLBACK');
        throw new AppError(
          'Authentication configuration not found.',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      // Build update query
      const updates: string[] = [];
      const values: (string | number | boolean | null | string[])[] = [];
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

      if (input.allowedRedirectUrls !== undefined) {
        updates.push(`allowed_redirect_urls = $${paramCount++}::TEXT[]`);
        values.push(input.allowedRedirectUrls);
      }

      if (input.disableSignup !== undefined) {
        updates.push(`disable_signup = $${paramCount++}`);
        values.push(input.disableSignup);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        // Return current config if no updates
        return await this.getAuthConfig();
      }

      // Add updated_at to updates
      updates.push('updated_at = NOW()');

      const result = await client.query(
        `UPDATE auth.config
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
           allowed_redirect_urls as "allowedRedirectUrls",
           disable_signup as "disableSignup",
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

  /**
   * Normalizes a URL for comparison.
   * - Converts hostname to lowercase
   * - Removes default ports (handled by URL class)
   * - Removes trailing slash
   * Returns null if the URL is malformed.
   */
  private static normalizeUrl(urlStr: string): string | null {
    try {
      const url = new URL(urlStr);
      return url.href.replace(/\/$/, '');
    } catch {
      // Reject malformed URL instead of returning lowercased string
      return null;
    }
  }

  /**
   * Characters that indicate a glob pattern (as opposed to a literal URL).
   */
  private static readonly GLOB_CHARS = /[*?[\]]/;

  /**
   * Sentinel returned by `normalizePattern` when the placeholder-substituted
   * pattern still fails URL parsing. `\0` cannot appear in a normalised URL
   * produced by `new URL().href`, so picomatch will never match it.
   */
  private static readonly UNMATCHABLE_PATTERN = '\0';

  /**
   * Normalises a glob *pattern* string.
   *
   * Unlike `normalizeUrl`, this must preserve the glob meta-characters that
   * `new URL()` would percent-encode or reject. The approach:
   *   1. Replace every glob meta-char with a unique placeholder.
   *   2. Run the resulting (valid) URL through `normalizeUrl`.
   *   3. Restore the placeholders back to their original globs.
   *
   * Any pattern that passes `allowedRedirectUrlsRegex` is a parseable URL
   * after placeholder substitution. If a pattern still fails to parse here,
   * the input bypassed schema validation and is treated as unmatchable.
   */
  private static normalizePattern(pattern: string): string {
    // Map of placeholder → restoration token, built on-the-fly.
    const replacements: Array<{ placeholder: string; original: string }> = [];
    let idx = 0;

    // Replace glob tokens with safe placeholders.
    // Order matters: replace ** before * so ** is not split.
    const safe = pattern.replace(/\*\*|\*|\?|\[([^\]]*)\]/g, (match, classContent) => {
      const placeholder = `__GLOB${idx++}__`;
      // Distinguish IPv6 host brackets from glob character classes. IPv6
      // contents are hex digits / colons / dots and contain at least two
      // colons (`::1` is the shortest valid form). Picomatch otherwise
      // produces a tolerant regex that also matches single chars from the
      // class (`https://[::1]/cb` would match `https://1/cb`), so we escape
      // the brackets on restoration to force literal matching, and lowercase
      // to align with `URL.href`'s hostname normalisation.
      const isIpv6Brackets =
        classContent !== undefined &&
        /^[0-9A-Fa-f:.]+$/.test(classContent) &&
        (classContent.match(/:/g) ?? []).length >= 2;
      const original = isIpv6Brackets ? `\\[${classContent.toLowerCase()}\\]` : match;
      replacements.push({ placeholder, original });
      return placeholder;
    });

    const normalized = AuthConfigService.normalizeUrl(safe);
    if (!normalized) {
      return AuthConfigService.UNMATCHABLE_PATTERN;
    }

    // Restore glob tokens in the normalised URL.
    // The URL class lowercases the hostname but not the path, so we use a
    // case-insensitive regex to find placeholders regardless of position.
    let result = normalized;
    for (const { placeholder, original } of replacements) {
      result = result.replace(new RegExp(placeholder, 'i'), original);
    }
    return result;
  }

  /**
   * Tests whether a single allowed-redirect pattern matches the target URL.
   *
   * Pattern semantics (picomatch defaults):
   * - `*`   — matches any sequence of characters except `/`
   * - `**`  — matches any sequence of characters including `/`
   * - `?`   — matches exactly one character that is not `/`
   * - `[…]` — character class (e.g. `[!a-z]`)
   *
   * Note: `*` matches across `.` boundaries. This is intentional and preserves
   * back-compat with the legacy `*.host.com` matcher (which used
   * `hostname.endsWith('.' + base)` and therefore matched arbitrarily deep
   * subdomains). Existing customers relying on `*.example.com` matching
   * `deep.sub.example.com` continue to work.
   *
   * Protocol and port are matched strictly — the glob never crosses those
   * boundaries because they are literal characters in the normalised strings.
   */
  private matchesGlobPattern(pattern: string, normalizedTarget: string): boolean {
    // Fast path: pattern without glob chars → exact match.
    if (!AuthConfigService.GLOB_CHARS.test(pattern)) {
      const normalizedPattern = AuthConfigService.normalizeUrl(pattern);
      return normalizedPattern === normalizedTarget;
    }

    const normalizedPattern = AuthConfigService.normalizePattern(pattern);

    try {
      return picomatch.isMatch(normalizedTarget, normalizedPattern, { dot: true });
    } catch {
      // If picomatch throws (e.g. malformed bracket expression), reject.
      return false;
    }
  }

  /**
   * Validates a redirect URL against the server's configured allowed redirect URLs.
   *
   * Supports Supabase-compatible glob patterns:
   * - `https://*.example.com`          — any subdomain
   * - `https://example.com/*`          — single path segment
   * - `https://example.com/**`         — any path depth
   * - `https://*.example.com/auth/*`   — combined subdomain + path
   * - `https://example.com/?session=*` — query-string wildcards
   *
   * When no allowlist is configured the method returns `true` (permissive
   * default for better developer experience).
   */
  async validateRedirectUrl(urlStr: string): Promise<boolean> {
    const config = await this.getAuthConfig();
    const allowedRedirectUrls = config.allowedRedirectUrls;

    // Use the configured allowed redirect URLs to validate the target URL.
    // If no whitelist is configured, we default to permissive behavior to improve
    // developer experience and lower development friction.
    if (!allowedRedirectUrls || allowedRedirectUrls.length === 0) {
      return true;
    }

    const targetUrl = AuthConfigService.normalizeUrl(urlStr);
    if (!targetUrl) {
      return false;
    }

    return allowedRedirectUrls.some((pattern) => this.matchesGlobPattern(pattern, targetUrl));
  }
}
