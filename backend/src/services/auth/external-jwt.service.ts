import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

/**
 * Persisted provider configuration stored in auth._jwt_providers
 */
export interface JwtProviderConfig {
  id: string;
  name: string;
  provider_key: string;
  issuer: string;
  audience: string | null;
  jwks_url: string;
  claim_mappings: ClaimMappings;
  default_role: 'anon' | 'authenticated' | 'project_admin';
  /** Expected format of the subject (sub) claim: 'text' (default) or 'uuid'. */
  subject_type: 'text' | 'uuid';
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Maps external JWT claim names to the InsForge user shape.
 * Keys are InsForge field names; values are dot-paths into the external JWT payload.
 */
export interface ClaimMappings {
  sub: string; // claim path for user ID
  email: string; // claim path for email
  [key: string]: string;
}

/**
 * Normalized user info extracted from an external JWT
 */
export interface ExternalJwtUser {
  id: string;
  email: string;
  role: 'anon' | 'authenticated' | 'project_admin';
  provider_key: string;
}

/**
 * Input for creating or updating a JWT provider
 */
export interface JwtProviderInput {
  name: string;
  provider_key: string;
  issuer: string;
  audience?: string | null;
  jwks_url: string;
  claim_mappings?: ClaimMappings;
  default_role?: 'anon' | 'authenticated' | 'project_admin';
  subject_type?: 'text' | 'uuid';
  is_enabled?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Allowed algorithms for external JWT signature verification
const ALLOWED_ALGORITHMS = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
] as const;

/**
 * ExternalJwtService - Manages external JWT provider configurations and token verification.
 *
 * Design:
 * - Provider configs are cached in memory with a short TTL to avoid DB hits on every request.
 * - Each provider's JWKS is fetched and cached by jose's createRemoteJWKSet (handles rotation).
 * - Verification checks: signature (via JWKS), issuer, audience, expiration, then extracts claims.
 */
export class ExternalJwtService {
  private static instance: ExternalJwtService;
  private db: DatabaseManager;

  // In-memory caches
  private providerCache: JwtProviderConfig[] | null = null;
  private providerCacheTimestamp = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 minute

  // JWKS keyset cache: jwks_url → keyset function
  private jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  private constructor() {
    this.db = DatabaseManager.getInstance();
  }

  public static getInstance(): ExternalJwtService {
    if (!ExternalJwtService.instance) {
      ExternalJwtService.instance = new ExternalJwtService();
    }
    return ExternalJwtService.instance;
  }

  // ---------------------------------------------------------------------------
  // Provider CRUD
  // ---------------------------------------------------------------------------

  async listProviders(): Promise<JwtProviderConfig[]> {
    const pool = this.db.getPool();
    const result = await pool.query(
      'SELECT * FROM auth._jwt_providers ORDER BY created_at DESC'
    );
    return result.rows;
  }

  async getProviderByKey(providerKey: string): Promise<JwtProviderConfig | null> {
    const pool = this.db.getPool();
    const result = await pool.query(
      'SELECT * FROM auth._jwt_providers WHERE provider_key = $1',
      [providerKey]
    );
    return result.rows[0] ?? null;
  }

  async createProvider(input: JwtProviderInput): Promise<JwtProviderConfig> {
    this.validateJwksUrl(input.jwks_url);

    const pool = this.db.getPool();
    const result = await pool.query(
      `INSERT INTO auth._jwt_providers
        (name, provider_key, issuer, audience, jwks_url, claim_mappings, default_role, subject_type, is_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.name,
        input.provider_key,
        input.issuer,
        input.audience ?? null,
        input.jwks_url,
        JSON.stringify(input.claim_mappings ?? { sub: 'sub', email: 'email' }),
        input.default_role ?? 'authenticated',
        input.subject_type ?? 'text',
        input.is_enabled ?? true,
      ]
    );
    this.invalidateCache();
    return result.rows[0];
  }

  async updateProvider(
    providerKey: string,
    input: Partial<JwtProviderInput>
  ): Promise<JwtProviderConfig> {
    if (input.jwks_url) {
      this.validateJwksUrl(input.jwks_url);
    }

    const existing = await this.getProviderByKey(providerKey);
    if (!existing) {
      throw new AppError('JWT provider not found', 404, ERROR_CODES.NOT_FOUND);
    }

    // Build SET clauses dynamically so explicit false/null values are preserved.
    // Only fields present in `input` (even if null/false) are updated.
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    const addField = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    };

    if ('name' in input) addField('name', input.name);
    if ('issuer' in input) addField('issuer', input.issuer);
    if ('audience' in input) addField('audience', input.audience ?? null);
    if ('jwks_url' in input) addField('jwks_url', input.jwks_url);
    if ('claim_mappings' in input) addField('claim_mappings', JSON.stringify(input.claim_mappings));
    if ('default_role' in input) addField('default_role', input.default_role);
    if ('subject_type' in input) addField('subject_type', input.subject_type);
    if ('is_enabled' in input) addField('is_enabled', input.is_enabled);

    if (setClauses.length === 0) {
      return existing;
    }

    setClauses.push('updated_at = NOW()');
    values.push(providerKey);

    const pool = this.db.getPool();
    const result = await pool.query(
      `UPDATE auth._jwt_providers SET ${setClauses.join(', ')} WHERE provider_key = $${paramIndex} RETURNING *`,
      values
    );
    this.invalidateCache();
    // Also invalidate JWKS cache if URL changed
    if (input.jwks_url && input.jwks_url !== existing.jwks_url) {
      this.jwksCache.delete(existing.jwks_url);
    }
    return result.rows[0];
  }

  async deleteProvider(providerKey: string): Promise<void> {
    const existing = await this.getProviderByKey(providerKey);
    if (!existing) {
      throw new AppError('JWT provider not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const pool = this.db.getPool();
    await pool.query('DELETE FROM auth._jwt_providers WHERE provider_key = $1', [providerKey]);
    this.invalidateCache();
    this.jwksCache.delete(existing.jwks_url);
  }

  // ---------------------------------------------------------------------------
  // Token Verification
  // ---------------------------------------------------------------------------

  /**
   * Attempt to verify an external JWT against all enabled providers.
   * Returns normalized user info if any provider matches, or null if none do.
   *
   * Flow:
   * 1. Decode JWT header (without verification) to read `iss` claim for provider lookup
   * 2. Find matching enabled provider(s) by issuer
   * 3. Verify signature via JWKS, check aud, check exp
   * 4. Extract and normalize claims per provider's claim_mappings
   */
  async verifyExternalToken(token: string): Promise<ExternalJwtUser | null> {
    const providers = await this.getEnabledProviders();
    if (providers.length === 0) {
      return null;
    }

    // Decode without verification to peek at issuer
    let unverifiedIssuer: string | undefined;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
      const payload = JSON.parse(payloadJson);
      unverifiedIssuer = payload.iss;
    } catch {
      return null; // Not a valid JWT structure
    }

    if (!unverifiedIssuer) {
      return null;
    }

    // Find providers matching this issuer
    const matchingProviders = providers.filter((p) => p.issuer === unverifiedIssuer);
    if (matchingProviders.length === 0) {
      return null;
    }

    // Try each matching provider (usually just one)
    for (const provider of matchingProviders) {
      try {
        const user = await this.verifyTokenWithProvider(token, provider);
        return user;
      } catch (error) {
        logger.debug('[ExternalJWT] Provider verification failed', {
          provider: provider.provider_key,
          error: error instanceof Error ? error.message : 'unknown',
        });
        continue;
      }
    }

    return null;
  }

  /**
   * Verify a JWT against a specific provider configuration.
   * Throws on any verification failure.
   */
  private async verifyTokenWithProvider(
    token: string,
    provider: JwtProviderConfig
  ): Promise<ExternalJwtUser> {
    const jwks = this.getOrCreateJwks(provider.jwks_url);

    const verifyOptions: {
      algorithms: (typeof ALLOWED_ALGORITHMS)[number][];
      issuer: string;
      audience?: string;
    } = {
      algorithms: [...ALLOWED_ALGORITHMS],
      issuer: provider.issuer,
    };

    if (provider.audience) {
      verifyOptions.audience = provider.audience;
    }

    const { payload } = await jwtVerify(token, jwks, verifyOptions);

    // Extract claims using the provider's mapping
    const sub = this.extractClaim(payload, provider.claim_mappings.sub);
    const email = this.extractClaim(payload, provider.claim_mappings.email);

    if (!sub) {
      throw new Error('External JWT missing required claim for user ID (sub)');
    }

    if (!email) {
      throw new Error('External JWT missing required claim for email');
    }

    // Validate UUID format when provider expects UUID subject IDs
    if (provider.subject_type === 'uuid' && !UUID_REGEX.test(sub)) {
      throw new Error(
        `External JWT sub claim "${sub}" is not a valid UUID, but provider "${provider.provider_key}" requires subject_type=uuid`
      );
    }

    return {
      id: sub,
      email,
      role: provider.default_role,
      provider_key: provider.provider_key,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get or create a cached JWKS keyset for a given URL.
   * jose handles key rotation and caching internally.
   */
  private getOrCreateJwks(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
    let jwks = this.jwksCache.get(jwksUrl);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(jwksUrl), {
        timeoutDuration: 10_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 600_000,
      });
      this.jwksCache.set(jwksUrl, jwks);
    }
    return jwks;
  }

  /**
   * Extract a claim value from a JWT payload using a dot-separated path.
   * E.g., "user_metadata.email" → payload.user_metadata.email
   */
  private extractClaim(payload: JWTPayload, claimPath: string): string | undefined {
    const parts = claimPath.split('.');
    let current: unknown = payload;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current !== null && current !== undefined ? String(current) : undefined;
  }

  /**
   * Get all enabled providers, with caching.
   */
  private async getEnabledProviders(): Promise<JwtProviderConfig[]> {
    const now = Date.now();
    if (this.providerCache && now - this.providerCacheTimestamp < this.CACHE_TTL_MS) {
      return this.providerCache.filter((p) => p.is_enabled);
    }

    try {
      const pool = this.db.getPool();
      const result = await pool.query(
        'SELECT * FROM auth._jwt_providers WHERE is_enabled = true ORDER BY created_at'
      );
      this.providerCache = result.rows;
      this.providerCacheTimestamp = now;
      return result.rows;
    } catch (error) {
      logger.warn('[ExternalJWT] Failed to load providers from database', {
        error: error instanceof Error ? error.message : 'unknown',
      });
      // Return stale cache if available, empty array otherwise
      return this.providerCache?.filter((p) => p.is_enabled) ?? [];
    }
  }

  private invalidateCache(): void {
    this.providerCache = null;
    this.providerCacheTimestamp = 0;
  }

  /**
   * Validate JWKS URL is HTTPS (except in development with localhost).
   */
  private validateJwksUrl(url: string): void {
    try {
      const parsed = new URL(url);
      const isLocalDev =
        parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (parsed.protocol !== 'https:' && !isLocalDev) {
        throw new AppError(
          'JWKS URL must use HTTPS',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('Invalid JWKS URL format', 400, ERROR_CODES.INVALID_INPUT);
    }
  }
}
