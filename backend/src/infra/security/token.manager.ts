import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import type { PoolClient } from 'pg';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, type TokenPayloadSchema } from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from '../../utils/next-actions.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';

const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';
const JWT_SIGNING_PRIVATE_KEY_SECRET = 'JWT_SIGNING_PRIVATE_KEY';
const JWT_SIGNING_PUBLIC_KEY_SECRET = 'JWT_SIGNING_PUBLIC_KEY';
const JWT_SIGNING_KID_SECRET = 'JWT_SIGNING_KID';
const SIGNING_ALGORITHM = 'RS256';

interface PublicJwk {
  alg?: string;
  e?: string;
  kid?: string;
  kty?: string;
  n?: string;
  use?: string;
}

function getJwtSecret(): string {
  return process.env.JWT_SECRET ?? '';
}

function deriveSigningKid(publicKey: string): string {
  return crypto.createHash('sha256').update(publicKey).digest('base64url');
}

export type RefreshSessionType = 'user' | 'admin';

/**
 * Refresh token payload interface
 */
export interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  iss: string;
  csrfNonce: string;
  sessionType: RefreshSessionType;
}

export interface RefreshTokenWithCsrf {
  refreshToken: string;
  csrfToken: string;
}

/**
 * TokenManager - Handles JWT token operations
 * Infrastructure layer for token generation and verification
 */
export class TokenManager {
  private static instance: TokenManager;
  private static readonly signingKeyLockId = 'insforge.jwt_signing_key_bundle';
  private signingPrivateKey: string | null = null;
  private signingPublicKey: string | null = null;
  private signingKid: string | null = null;
  private publicJwks: { keys: PublicJwk[] } = { keys: [] };
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;
  private cloudJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private cloudJwksHost: string | null = null;

  private constructor() {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  public static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise = this.doInitialize().finally(() => {
      this.initializingPromise = null;
    });
    return this.initializingPromise;
  }

  private async doInitialize(): Promise<void> {
    if (process.env.JWT_SIGNING_PRIVATE_KEY && process.env.JWT_SIGNING_PUBLIC_KEY) {
      this.setSigningKeys(
        process.env.JWT_SIGNING_PRIVATE_KEY,
        process.env.JWT_SIGNING_PUBLIC_KEY,
        process.env.JWT_SIGNING_KID || deriveSigningKid(process.env.JWT_SIGNING_PUBLIC_KEY)
      );
      this.initialized = true;
      return;
    }

    const client = await DatabaseManager.getInstance().getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        TokenManager.signingKeyLockId,
      ]);

      const resolvedKeys = await this.loadOrCreateSigningKeys(client);
      this.setSigningKeys(resolvedKeys.privateKey, resolvedKeys.publicKey, resolvedKeys.kid);
      await client.query('COMMIT');
    } catch (error) {
      this.clearSigningKeys();
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }

    this.initialized = true;
  }

  /**
   * Generate JWT access token.
   * Keep PostgREST-facing access tokens on HS256 until deployments verify RS256/JWKS.
   */
  generateAccessToken(payload: TokenPayloadSchema): string {
    return jwt.sign(payload, getJwtSecret(), {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  }

  /**
   * Generate API key token (never expires)
   * Used for internal API key authenticated requests to PostgREST
   */
  generateApiKeyToken(): string {
    const payload = {
      sub: 'project-admin-with-api-key',
      email: 'project-admin@email.com',
      role: 'project_admin',
    };
    return jwt.sign(payload, getJwtSecret(), {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Generate refresh token for secure session management
   */
  generateRefreshToken(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce = this.generateCsrfNonce()
  ): string {
    const refreshPayload = this.createRefreshTokenPayload(userId, sessionType, csrfNonce);
    return this.signRefreshPayload(refreshPayload);
  }

  generateRefreshTokenWithCsrf(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce = this.generateCsrfNonce()
  ): RefreshTokenWithCsrf {
    const refreshPayload = this.createRefreshTokenPayload(userId, sessionType, csrfNonce);
    return {
      refreshToken: this.signRefreshPayload(refreshPayload),
      csrfToken: this.generateCsrfToken(refreshPayload),
    };
  }

  /**
   * Verify refresh token and return payload
   * Ensures the token is a valid refresh token (not an access token)
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = this.verifyJwt(token, {
        hsAlgorithms: ['HS256'],
        rsAlgorithms: [SIGNING_ALGORITHM],
        issuer: 'insforge',
      }) as RefreshTokenPayload;

      // Ensure this is a refresh token, not an access token
      if (
        decoded.type !== 'refresh' ||
        !decoded.sub ||
        typeof decoded.csrfNonce !== 'string' ||
        decoded.csrfNonce.length === 0 ||
        (decoded.sessionType !== 'user' && decoded.sessionType !== 'admin')
      ) {
        throw new AppError('Invalid refresh token type', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      return decoded;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Invalid or expired refresh token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  /**
   * Generate anonymous JWT token (never expires).
   * Keep PostgREST-facing anonymous tokens on HS256 until deployments verify RS256/JWKS.
   */
  generateAnonToken(): string {
    const payload = {
      sub: '12345678-1234-5678-90ab-cdef12345678',
      email: 'anon@insforge.com',
      role: 'anon',
    };
    return jwt.sign(payload, getJwtSecret(), {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): TokenPayloadSchema {
    try {
      const decoded = this.verifyJwt(token, {
        hsAlgorithms: ['HS256'],
        rsAlgorithms: [SIGNING_ALGORITHM],
      }) as TokenPayloadSchema;
      return {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'authenticated',
      };
    } catch {
      throw new AppError('Invalid token', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
    }
  }

  /**
   * Verify cloud backend JWT token
   * Validates JWT tokens from api.insforge.dev using JWKS
   */
  async verifyCloudToken(token: string): Promise<{ projectId: string; payload: JWTPayload }> {
    try {
      const { payload } = await jwtVerify(token, this.getCloudJwks(), {
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      });

      // Verify project_id matches if configured
      const tokenProjectId = payload['projectId'] as string;
      const expectedProjectId = process.env.PROJECT_ID;

      if (expectedProjectId && tokenProjectId !== expectedProjectId) {
        throw new AppError(
          'Project ID mismatch',
          403,
          ERROR_CODES.AUTH_UNAUTHORIZED,
          NEXT_ACTIONS.CHECK_TOKEN
        );
      }

      return {
        projectId: tokenProjectId || expectedProjectId || 'local',
        payload,
      };
    } catch (error) {
      // Re-throw AppError as-is
      if (error instanceof AppError) {
        throw error;
      }

      // Wrap other JWT errors
      throw new AppError(
        `Invalid cloud authorization code: ${error instanceof Error ? error.message : 'Unknown error'}`,
        401,
        ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        NEXT_ACTIONS.CHECK_TOKEN
      );
    }
  }

  /**
   * Generate CSRF token derived from refresh-session claims using HMAC.
   */
  generateCsrfToken(payload: RefreshTokenPayload): string {
    return crypto
      .createHmac('sha256', getJwtSecret())
      .update(`insforge:csrf:v1:${payload.sessionType}:${payload.sub}:${payload.csrfNonce}`)
      .digest('hex');
  }

  /**
   * Verify CSRF token by re-computing from refresh-session claims.
   * Uses timing-safe comparison to prevent timing attacks
   */
  verifyCsrfToken(csrfHeader: string | undefined, payload: RefreshTokenPayload): boolean {
    if (!csrfHeader) {
      return false;
    }

    try {
      const expectedCsrf = this.generateCsrfToken(payload);
      return crypto.timingSafeEqual(Buffer.from(csrfHeader), Buffer.from(expectedCsrf));
    } catch {
      return false;
    }
  }

  getPublicJwks(): { keys: PublicJwk[] } {
    return this.publicJwks;
  }

  private getCloudJwks(): ReturnType<typeof createRemoteJWKSet> {
    const cloudApiHost = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
    if (!this.cloudJwks || this.cloudJwksHost !== cloudApiHost) {
      this.cloudJwksHost = cloudApiHost;
      this.cloudJwks = createRemoteJWKSet(new URL(`${cloudApiHost}/.well-known/jwks.json`), {
        timeoutDuration: 10000,
        cooldownDuration: 30000,
        cacheMaxAge: 600000,
      });
    }

    return this.cloudJwks;
  }

  private generateCsrfNonce(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private createRefreshTokenPayload(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce: string
  ): RefreshTokenPayload {
    return {
      sub: userId,
      type: 'refresh',
      iss: 'insforge',
      csrfNonce,
      sessionType,
    };
  }

  private signRefreshPayload(refreshPayload: RefreshTokenPayload): string {
    const signingCredentials = this.getSigningCredentials();
    if (signingCredentials) {
      return jwt.sign(refreshPayload, signingCredentials.privateKey, {
        algorithm: SIGNING_ALGORITHM,
        keyid: signingCredentials.kid,
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      });
    }

    return jwt.sign(refreshPayload, getJwtSecret(), {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    });
  }

  private generateSigningKeyPair(): { privateKey: string; publicKey: string; kid: string } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
    });

    return {
      privateKey,
      publicKey,
      kid: deriveSigningKid(publicKey),
    };
  }

  private async loadOrCreateSigningKeys(
    client: PoolClient
  ): Promise<{ privateKey: string; publicKey: string; kid: string }> {
    const secretService = SecretService.getInstance();
    const [existingPrivateKey, existingPublicKey, existingKid] = await Promise.all([
      secretService.getSecretByKey(JWT_SIGNING_PRIVATE_KEY_SECRET, client),
      secretService.getSecretByKey(JWT_SIGNING_PUBLIC_KEY_SECRET, client),
      secretService.getSecretByKey(JWT_SIGNING_KID_SECRET, client),
    ]);

    if (existingPrivateKey || existingPublicKey || existingKid) {
      if (!existingPrivateKey || !existingPublicKey) {
        throw new Error('JWT signing key bundle is incomplete in system.secrets');
      }

      const resolvedKid = existingKid || deriveSigningKid(existingPublicKey);
      if (!existingKid) {
        await this.upsertReservedSecret(secretService, JWT_SIGNING_KID_SECRET, resolvedKid, client);
      }

      return {
        privateKey: existingPrivateKey,
        publicKey: existingPublicKey,
        kid: resolvedKid,
      };
    }

    const generatedKeys = this.generateSigningKeyPair();
    await this.persistSigningKeys(generatedKeys, client);
    return generatedKeys;
  }

  private async persistSigningKeys(
    keys: { privateKey: string; publicKey: string; kid: string },
    client: PoolClient
  ): Promise<void> {
    const secretService = SecretService.getInstance();
    await this.upsertReservedSecret(
      secretService,
      JWT_SIGNING_PRIVATE_KEY_SECRET,
      keys.privateKey,
      client
    );
    await this.upsertReservedSecret(
      secretService,
      JWT_SIGNING_PUBLIC_KEY_SECRET,
      keys.publicKey,
      client
    );
    await this.upsertReservedSecret(secretService, JWT_SIGNING_KID_SECRET, keys.kid, client);
  }

  private async upsertReservedSecret(
    secretService: SecretService,
    key: string,
    value: string,
    client: PoolClient
  ): Promise<void> {
    const existingValue = await secretService.getSecretByKey(key, client);

    if (existingValue === null) {
      await secretService.createSecret(
        {
          key,
          value,
          isReserved: true,
        },
        client
      );
      return;
    }

    await secretService.updateSecretByKey(
      key,
      {
        value,
        isReserved: true,
        isActive: true,
      },
      client
    );
  }

  private setSigningKeys(privateKey: string, publicKey: string, kid: string): void {
    const publicKeyObject = crypto.createPublicKey(publicKey);
    const jwk = publicKeyObject.export({ format: 'jwk' }) as PublicJwk;

    this.signingPrivateKey = privateKey;
    this.signingPublicKey = publicKey;
    this.signingKid = kid;
    this.publicJwks = {
      keys: [
        {
          ...jwk,
          kid,
          use: 'sig',
          alg: SIGNING_ALGORITHM,
        },
      ],
    };
  }

  private clearSigningKeys(): void {
    this.signingPrivateKey = null;
    this.signingPublicKey = null;
    this.signingKid = null;
    this.publicJwks = { keys: [] };
  }

  private getSigningCredentials(): { privateKey: string; publicKey: string; kid: string } | null {
    if (!this.signingPrivateKey || !this.signingPublicKey || !this.signingKid) {
      return null;
    }

    return {
      privateKey: this.signingPrivateKey,
      publicKey: this.signingPublicKey,
      kid: this.signingKid,
    };
  }

  private verifyJwt(
    token: string,
    options: {
      hsAlgorithms: jwt.Algorithm[];
      rsAlgorithms: jwt.Algorithm[];
      issuer?: string;
    }
  ): string | jwt.JwtPayload {
    const decodedHeader = jwt.decode(token, { complete: true });
    const algorithm = decodedHeader?.header?.alg;
    const keyId = decodedHeader?.header?.kid;

    if (algorithm && options.rsAlgorithms.includes(algorithm as jwt.Algorithm)) {
      if (!this.signingPublicKey || !this.signingKid) {
        throw new Error('Asymmetric signing key is not initialized');
      }
      if (!keyId || keyId !== this.signingKid) {
        throw new Error('JWT signing key id does not match the active JWKS key');
      }

      return jwt.verify(token, this.signingPublicKey, {
        algorithms: options.rsAlgorithms,
        issuer: options.issuer,
      });
    }

    if (algorithm && !options.hsAlgorithms.includes(algorithm as jwt.Algorithm)) {
      throw new Error(`Unsupported JWT algorithm: ${algorithm}`);
    }

    return jwt.verify(token, getJwtSecret(), {
      algorithms: options.hsAlgorithms,
      issuer: options.issuer,
    });
  }
}
