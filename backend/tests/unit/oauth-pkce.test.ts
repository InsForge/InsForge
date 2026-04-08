import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Set required env vars before any imports
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin-password';

// ============================================================================
// Mocks
// ============================================================================

const mockUser = {
  id: 'user-123',
  email: 'test@example.com',
  emailVerified: true,
  providers: ['google'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  profile: {},
  metadata: {},
};

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: vi.fn().mockReturnValue('test-access-token'),
      generateRefreshToken: vi.fn().mockReturnValue('test-refresh-token'),
      generateCsrfToken: vi.fn().mockReturnValue('test-csrf-token'),
    }),
  },
}));

vi.mock('../../src/services/auth/auth.service', () => ({
  AuthService: {
    getInstance: () => ({
      getUserSchemaById: vi.fn().mockResolvedValue(mockUser),
    }),
  },
}));

vi.mock('../../src/utils/utils', () => ({
  generateSecureToken: vi.fn().mockReturnValue('mock-exchange-code-abc123'),
  parseClientType: vi.fn().mockReturnValue('web'),
}));

// ============================================================================
// Helpers — PKCE pair generation (mirrors what the SDK does)
// ============================================================================

function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// ============================================================================
// Tests
// ============================================================================

describe('OAuth PKCE Service', () => {
  let OAuthPKCEService: typeof import('../../src/services/auth/oauth-pkce.service').OAuthPKCEService;
  let service: InstanceType<typeof OAuthPKCEService>;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('../../src/services/auth/oauth-pkce.service');
    OAuthPKCEService = mod.OAuthPKCEService;
    // Access the singleton — reset it between tests
    service = OAuthPKCEService.getInstance();
    service.destroy();
    service = OAuthPKCEService.getInstance();
  });

  describe('PKCE code_verifier / code_challenge pair', () => {
    it('SHA256(code_verifier) produces the expected code_challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      // Re-derive to prove determinism
      const again = crypto.createHash('sha256').update(verifier).digest('base64url');
      expect(challenge).toBe(again);
    });

    it('different verifiers produce different challenges', () => {
      const v1 = generateCodeVerifier();
      const v2 = generateCodeVerifier();
      expect(generateCodeChallenge(v1)).not.toBe(generateCodeChallenge(v2));
    });

    it('code_verifier is base64url-safe (RFC 7636 charset)', () => {
      const verifier = generateCodeVerifier();
      expect(verifier).toMatch(/^[A-Za-z0-9._~-]+$/);
    });
  });

  describe('createCode + exchangeCode round-trip', () => {
    it('exchanges successfully with the correct code_verifier', async () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const code = service.createCode({
        userId: 'user-123',
        codeChallenge: challenge,
        provider: 'google',
      });

      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(0);

      const result = await service.exchangeCode(code, verifier);
      expect(result.user.id).toBe('user-123');
      expect(result.accessToken).toBe('test-access-token');
    });

    it('rejects exchange with wrong code_verifier', async () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const code = service.createCode({
        userId: 'user-123',
        codeChallenge: challenge,
        provider: 'google',
      });

      const wrongVerifier = generateCodeVerifier();
      await expect(service.exchangeCode(code, wrongVerifier)).rejects.toThrow(
        'PKCE verification failed'
      );
    });

    it('code is one-time use — second exchange fails', async () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const code = service.createCode({
        userId: 'user-123',
        codeChallenge: challenge,
        provider: 'github',
      });

      // First exchange succeeds
      await service.exchangeCode(code, verifier);

      // Second exchange fails
      await expect(service.exchangeCode(code, verifier)).rejects.toThrow(
        'Invalid or expired code'
      );
    });

    it('rejects a completely invalid code', async () => {
      await expect(service.exchangeCode('nonexistent-code', 'any-verifier')).rejects.toThrow(
        'Invalid or expired code'
      );
    });
  });

  describe('code expiration', () => {
    it('rejects exchange after code expires', async () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const code = service.createCode({
        userId: 'user-123',
        codeChallenge: challenge,
        provider: 'google',
      });

      // Fast-forward past the 5-minute expiry by manipulating the internal state
      // Access the private map via the prototype trick
      const codesMap = (service as unknown as { pkceCodes: Map<string, { expiresAt: Date }> })
        .pkceCodes;
      const codeData = codesMap.get(code);
      if (codeData) {
        codeData.expiresAt = new Date(Date.now() - 1000); // expired 1 second ago
      }

      await expect(service.exchangeCode(code, verifier)).rejects.toThrow(
        'Invalid or expired code'
      );
    });
  });
});

describe('OAuth PKCE flow schema validation', () => {
  let oAuthInitRequestSchema: typeof import('@insforge/shared-schemas').oAuthInitRequestSchema;
  let oAuthCodeExchangeRequestSchema: typeof import('@insforge/shared-schemas').oAuthCodeExchangeRequestSchema;

  beforeEach(async () => {
    const schemas = await import('@insforge/shared-schemas');
    oAuthInitRequestSchema = schemas.oAuthInitRequestSchema;
    oAuthCodeExchangeRequestSchema = schemas.oAuthCodeExchangeRequestSchema;
  });

  describe('oAuthInitRequestSchema', () => {
    it('accepts valid redirect_uri and code_challenge', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const result = oAuthInitRequestSchema.safeParse({
        redirect_uri: 'https://myapp.com/auth/callback',
        code_challenge: challenge,
      });

      expect(result.success).toBe(true);
    });

    it('rejects code_challenge shorter than 43 characters', () => {
      const result = oAuthInitRequestSchema.safeParse({
        redirect_uri: 'https://myapp.com/auth/callback',
        code_challenge: 'too-short',
      });

      expect(result.success).toBe(false);
    });

    it('redirect_uri is optional', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const result = oAuthInitRequestSchema.safeParse({
        code_challenge: challenge,
      });

      expect(result.success).toBe(true);
    });

    it('rejects invalid redirect_uri (not a URL)', () => {
      const verifier = generateCodeVerifier();
      const challenge = generateCodeChallenge(verifier);

      const result = oAuthInitRequestSchema.safeParse({
        redirect_uri: 'not-a-url',
        code_challenge: challenge,
      });

      expect(result.success).toBe(false);
    });
  });

  describe('oAuthCodeExchangeRequestSchema', () => {
    it('accepts valid code and code_verifier', () => {
      const verifier = generateCodeVerifier();

      const result = oAuthCodeExchangeRequestSchema.safeParse({
        code: 'some-exchange-code',
        code_verifier: verifier,
      });

      expect(result.success).toBe(true);
    });

    it('rejects missing code', () => {
      const verifier = generateCodeVerifier();

      const result = oAuthCodeExchangeRequestSchema.safeParse({
        code_verifier: verifier,
      });

      expect(result.success).toBe(false);
    });

    it('rejects missing code_verifier', () => {
      const result = oAuthCodeExchangeRequestSchema.safeParse({
        code: 'some-exchange-code',
      });

      expect(result.success).toBe(false);
    });

    it('rejects code_verifier shorter than 43 characters', () => {
      const result = oAuthCodeExchangeRequestSchema.safeParse({
        code: 'some-exchange-code',
        code_verifier: 'too-short',
      });

      expect(result.success).toBe(false);
    });

    it('rejects code_verifier with invalid characters', () => {
      const result = oAuthCodeExchangeRequestSchema.safeParse({
        code: 'some-exchange-code',
        code_verifier: 'a'.repeat(43) + '!@#$%', // invalid chars
      });

      expect(result.success).toBe(false);
    });
  });
});
