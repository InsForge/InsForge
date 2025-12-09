import jwt from 'jsonwebtoken';
import { createRemoteJWKSet, JWTPayload, jwtVerify } from 'jose';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';
import type { TokenPayloadSchema } from '@insforge/shared-schemas';

const JWT_SECRET = process.env.JWT_SECRET ?? '';
const JWT_EXPIRES_IN = '7d';
const REFRESH_TOKEN_EXPIRES_IN = '7d';

/**
 * Refresh token payload interface
 */
export interface RefreshTokenPayload {
  sub: string;
  email: string;
  role: 'authenticated' | 'project_admin';
  type: 'refresh';
}

/**
 * Create JWKS instance with caching and timeout configuration
 * The instance will automatically cache keys and handle refetching
 */
const cloudApiHost = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';
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

  /**
   * Generate JWT access token for users and admins
   */
  generateToken(payload: TokenPayloadSchema): string {
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  /**
   * Generate admin JWT token (never expires)
   * Used for internal API key authenticated requests to PostgREST
   */
  generateAdminToken(): string {
    const payload = {
      sub: 'project-admin-with-api-key',
      email: 'project-admin@email.com',
      role: 'project_admin',
    };
    return jwt.sign(payload, JWT_SECRET, {
      algorithm: 'HS256',
      // No expiresIn means token never expires
    });
  }

  /**
   * Generate refresh token for secure session management
   * Refresh tokens are stored in httpOnly cookies and used to obtain new access tokens
   */
  generateRefreshToken(payload: TokenPayloadSchema): string {
    const refreshPayload: RefreshTokenPayload = {
      sub: payload.sub,
      email: payload.email,
      role: payload.role,
      type: 'refresh',
    };
    return jwt.sign(refreshPayload, JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: REFRESH_TOKEN_EXPIRES_IN,
    });
  }

  /**
   * Verify refresh token and return payload
   * Ensures the token is a valid refresh token (not an access token)
   */
  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as RefreshTokenPayload;

      // Ensure this is a refresh token, not an access token
      if (decoded.type !== 'refresh') {
        throw new AppError('Invalid refresh token type', 401, ERROR_CODES.AUTH_UNAUTHORIZED);
      }

      return {
        sub: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        type: 'refresh',
      };
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
      // JWKS handles caching internally, no need to manage it manually
      const { payload } = await jwtVerify(token, JWKS, {
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
          NEXT_ACTION.CHECK_TOKEN
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
        NEXT_ACTION.CHECK_TOKEN
      );
    }
  }
}
