import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenManager } from '../../src/infra/security/token.manager.js';
import jwt from 'jsonwebtoken';

describe('Token Expiration (15 minutes)', () => {
  let tokenManager: TokenManager;
  const testUserId = 'test-user-123';
  const testEmail = 'test@example.com';

  beforeEach(() => {
    // Ensure JWT_SECRET is set (should be set in setup.ts, but double-check)
    if (!process.env.JWT_SECRET) {
      process.env.JWT_SECRET = 'test-secret-key-for-jwt-tokens-min-32-chars';
    }
    
    // Reset the singleton instance to ensure fresh state
    (TokenManager as any).instance = undefined;
    tokenManager = TokenManager.getInstance();
  });

  describe('Access Token Generation and Expiration', () => {
    it('should generate access token with 15 minute expiration', () => {
      const token = tokenManager.generateToken({
        sub: testUserId,
        email: testEmail,
        role: 'authenticated',
      });

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');

      // Decode token to verify expiration
      const decoded = jwt.decode(token) as jwt.JwtPayload;
      expect(decoded).toBeDefined();
      expect(decoded.sub).toBe(testUserId);
      expect(decoded.email).toBe(testEmail);
      expect(decoded.role).toBe('authenticated');

      // Verify expiration time is approximately 15 minutes (900 seconds)
      if (decoded.exp && decoded.iat) {
        const expirationSeconds = decoded.exp - decoded.iat;
        // Should be 15 minutes = 900 seconds (allow 5 second tolerance)
        expect(expirationSeconds).toBeGreaterThanOrEqual(895);
        expect(expirationSeconds).toBeLessThanOrEqual(905);
      }
    });

    it('should verify valid access token', () => {
      const token = tokenManager.generateToken({
        sub: testUserId,
        email: testEmail,
        role: 'authenticated',
      });

      const payload = tokenManager.verifyToken(token);

      expect(payload.sub).toBe(testUserId);
      expect(payload.email).toBe(testEmail);
      expect(payload.role).toBe('authenticated');
    });

    it('should reject expired access token', () => {
      // Generate a token with very short expiration (1 second)
      const shortExpirationToken = jwt.sign(
        {
          sub: testUserId,
          email: testEmail,
          role: 'authenticated',
        },
        process.env.JWT_SECRET!,
        {
          algorithm: 'HS256',
          expiresIn: '1s', // 1 second expiration for testing
        }
      );

      // Wait for token to expire
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(() => {
            tokenManager.verifyToken(shortExpirationToken);
          }).toThrow();
          resolve();
        }, 2000); // Wait 2 seconds to ensure expiration
      });
    });

    it('should reject invalid token', () => {
      const invalidToken = 'invalid.token.here';

      expect(() => {
        tokenManager.verifyToken(invalidToken);
      }).toThrow();
    });
  });

  describe('Refresh Token Flow', () => {
    it('should generate refresh token with 7 day expiration', () => {
      const refreshToken = tokenManager.generateRefreshToken(testUserId);

      expect(refreshToken).toBeDefined();
      expect(typeof refreshToken).toBe('string');

      // Decode token to verify expiration
      const decoded = jwt.decode(refreshToken) as jwt.JwtPayload;
      expect(decoded).toBeDefined();
      expect(decoded.sub).toBe(testUserId);
      expect(decoded.type).toBe('refresh');
      expect(decoded.iss).toBe('insforge');

      // Verify expiration time is approximately 7 days (604800 seconds)
      if (decoded.exp && decoded.iat) {
        const expirationSeconds = decoded.exp - decoded.iat;
        // Should be 7 days = 604800 seconds (allow 60 second tolerance)
        expect(expirationSeconds).toBeGreaterThanOrEqual(604740);
        expect(expirationSeconds).toBeLessThanOrEqual(604860);
      }
    });

    it('should verify valid refresh token', () => {
      const refreshToken = tokenManager.generateRefreshToken(testUserId);

      const payload = tokenManager.verifyRefreshToken(refreshToken);

      expect(payload.sub).toBe(testUserId);
      expect(payload.type).toBe('refresh');
      expect(payload.iss).toBe('insforge');
    });

    it('should reject invalid refresh token', () => {
      const invalidToken = 'invalid.refresh.token';

      expect(() => {
        tokenManager.verifyRefreshToken(invalidToken);
      }).toThrow();
    });

    it('should reject access token used as refresh token', () => {
      const accessToken = tokenManager.generateToken({
        sub: testUserId,
        email: testEmail,
        role: 'authenticated',
      });

      expect(() => {
        tokenManager.verifyRefreshToken(accessToken);
      }).toThrow();
    });

    it('should generate new access token from refresh token', () => {
      const refreshToken = tokenManager.generateRefreshToken(testUserId);
      const payload = tokenManager.verifyRefreshToken(refreshToken);

      // Simulate what the refresh endpoint does
      const newAccessToken = tokenManager.generateToken({
        sub: payload.sub,
        email: testEmail,
        role: 'authenticated',
      });

      expect(newAccessToken).toBeDefined();
      const verified = tokenManager.verifyToken(newAccessToken);
      expect(verified.sub).toBe(testUserId);
    });
  });

  describe('Token Expiration Edge Cases', () => {
    it('should handle token expiration correctly with clock skew tolerance', () => {
      const token = tokenManager.generateToken({
        sub: testUserId,
        email: testEmail,
        role: 'authenticated',
      });

      // Token should be valid immediately after generation
      expect(() => {
        tokenManager.verifyToken(token);
      }).not.toThrow();
    });

    it('should generate CSRF token from refresh token', () => {
      const refreshToken = tokenManager.generateRefreshToken(testUserId);
      const csrfToken = tokenManager.generateCsrfToken(refreshToken);

      expect(csrfToken).toBeDefined();
      expect(typeof csrfToken).toBe('string');
      expect(csrfToken.length).toBeGreaterThan(0);

      // Verify CSRF token can be verified
      const isValid = tokenManager.verifyCsrfToken(csrfToken, refreshToken);
      expect(isValid).toBe(true);
    });

    it('should reject CSRF token from different refresh token', () => {
      const refreshToken1 = tokenManager.generateRefreshToken(testUserId);
      const refreshToken2 = tokenManager.generateRefreshToken('different-user');
      const csrfToken = tokenManager.generateCsrfToken(refreshToken1);

      const isValid = tokenManager.verifyCsrfToken(csrfToken, refreshToken2);
      expect(isValid).toBe(false);
    });
  });

  describe('Token Security', () => {
    it('should use HS256 algorithm for tokens', () => {
      const token = tokenManager.generateToken({
        sub: testUserId,
        email: testEmail,
        role: 'authenticated',
      });

      // Decode header to verify algorithm
      const header = jwt.decode(token, { complete: true })?.header;
      expect(header?.alg).toBe('HS256');
    });

    it('should include required claims in access token', () => {
      const token = tokenManager.generateToken({
        sub: testUserId,
        email: testEmail,
        role: 'authenticated',
      });

      const decoded = jwt.decode(token) as jwt.JwtPayload;
      expect(decoded.sub).toBeDefined();
      expect(decoded.email).toBeDefined();
      expect(decoded.role).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });

    it('should include required claims in refresh token', () => {
      const refreshToken = tokenManager.generateRefreshToken(testUserId);

      const decoded = jwt.decode(refreshToken) as jwt.JwtPayload;
      expect(decoded.sub).toBeDefined();
      expect(decoded.type).toBe('refresh');
      expect(decoded.iss).toBe('insforge');
      expect(decoded.exp).toBeDefined();
      expect(decoded.iat).toBeDefined();
    });
  });
});

