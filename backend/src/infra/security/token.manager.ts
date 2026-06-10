import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES, type TokenPayloadSchema } from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from '../../utils/next-actions.js';
import { appConfig } from '@/infra/config/app.config.js';

const JWT_SECRET = appConfig.app.jwtSecret;
const ACCESS_TOKEN_EXPIRES_IN = '15m';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

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
  isRoot?: boolean;
  adminId?: string;
}

export interface RefreshTokenWithCsrf {
  refreshToken: string;
  csrfToken: string;
}

/**
 * Create JWKS instance with caching and timeout configuration
 * The instance will automatically cache keys and handle refetching
 */
const cloudApiHost = appConfig.cloud.apiHost;
const JWKS = createRemoteJWKSet(new URL(`${cloudApiHost}/.well-known/jwks.json`), {
  timeoutDuration: 10000, // 10 second timeout for HTTP requests
  cooldownDuration: 30000, // 30 seconds cooldown after successful fetch
  cacheMaxAge: 600000, // Maximum 10 minutes between refetches
});

/**
 * TokenManager - Handles JWT token operations
 * Infrastructure layer for token generation and verification
 */
export class TokenManager {
  private static instance: TokenManager;

  private constructor() {
    if (!appConfig.app.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  public static getInstance(): TokenManager {
    if (!TokenManager.instance) {
      TokenManager.instance = new TokenManager();
    }
    return TokenManager.instance;
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(payload: TokenPayloadSchema): string {
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    });
  }

  /**
   * Generate PostgREST project admin token (never expires)
   * Used only for internal PostgREST proxy requests
   */
  generatePostgrestAdminToken(): string {
    const payload = {
      role: 'project_admin',
    };
    return jwt.sign(payload, JWT_SECRET, {
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
    csrfNonce = this.generateCsrfNonce(),
    isRoot?: boolean,
    adminId?: string
  ): string {
    const refreshPayload = this.createRefreshTokenPayload(
      userId,
      sessionType,
      csrfNonce,
      isRoot,
      adminId
    );
    return jwt.sign(refreshPayload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    });
  }

  generateRefreshTokenWithCsrf(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce = this.generateCsrfNonce(),
    isRoot?: boolean,
    adminId?: string
  ): RefreshTokenWithCsrf {
    const refreshPayload = this.createRefreshTokenPayload(
      userId,
      sessionType,
      csrfNonce,
      isRoot,
      adminId
    );
    return {
      refreshToken: jwt.sign(refreshPayload, JWT_SECRET, {
        algorithm: 'HS256',
        expiresIn: REFRESH_TOKEN_EXPIRES_IN,
      }),
      csrfToken: this.generateCsrfToken(refreshPayload),
    };
  }

  /**
   * Verify refresh token and return payload
   * Ensures the token is a valid refresh token (not an access token)
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, {
        algorithms: ['HS256'],
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
   * Generate anonymous JWT token (never expires)
   */
  generateAnonToken(): string {
    const payload = {
      sub: '12345678-1234-5678-90ab-cdef12345678',
      email: 'anon@insforge.com',
      role: 'anon',
    };
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token: string): TokenPayloadSchema {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as TokenPayloadSchema;
      if (!decoded.sub) {
        throw new AppError('Invalid token subject', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }
      return {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role || 'authenticated',
        isRoot: decoded.isRoot,
        adminId: decoded.adminId,
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
      // JWKS handles caching internally, no need to manage it manually
      const { payload } = await jwtVerify(token, JWKS, {
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512'],
      });

      // Verify project_id matches if configured
      const tokenProjectId = payload['projectId'] as string;
      const expectedProjectId = appConfig.cloud.projectId;

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
      .createHmac('sha256', JWT_SECRET)
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

  private generateCsrfNonce(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  private createRefreshTokenPayload(
    userId: string,
    sessionType: RefreshSessionType,
    csrfNonce: string,
    isRoot?: boolean,
    adminId?: string
  ): RefreshTokenPayload {
    return {
      sub: userId,
      type: 'refresh',
      iss: 'insforge',
      csrfNonce,
      sessionType,
      ...(isRoot !== undefined ? { isRoot } : {}),
      ...(adminId !== undefined ? { adminId } : {}),
    };
  }
}
