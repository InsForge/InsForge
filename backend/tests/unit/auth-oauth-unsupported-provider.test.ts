/**
 * Tests that the OAuth "unsupported provider" branches in AuthService throw a
 * structured AppError(501, AUTH_UNSUPPORTED_PROVIDER) instead of a raw Error.
 *
 * Issue #1405 — Phase 2: OAuth Error Standardization.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';

// ---------------------------------------------------------------------------
// Minimal mocks for all AuthService dependencies
// ---------------------------------------------------------------------------
vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: () => ({ getPool: () => ({ query: vi.fn(), connect: vi.fn() }) }),
  },
}));
vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => ({ generateAccessToken: vi.fn(), verifyToken: vi.fn() }) },
}));
vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/custom-oauth-config.service.js', () => ({
  CustomOAuthConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/auth/auth-otp.service.js', () => ({
  AuthOTPService: { getInstance: () => ({}) },
  OTPPurpose: {},
  OTPType: {},
}));
vi.mock('../../src/services/email/smtp-config.service.js', () => ({
  SmtpConfigService: { getInstance: () => ({}) },
}));
vi.mock('../../src/services/email/email.service.js', () => ({
  EmailService: { getInstance: () => ({}) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/utils/environment.js', () => ({
  getApiBaseUrl: () => 'http://localhost:3000',
}));

// Mock all OAuth providers — each has generateOAuthUrl and handleCallback
const makeOAuthProviderMock = () => ({
  getInstance: () => ({
    generateOAuthUrl: vi.fn().mockResolvedValue('https://oauth.example.com'),
    handleCallback: vi.fn().mockResolvedValue({
      provider: 'google',
      providerId: '123',
      email: 'test@test.com',
      userName: 'Test',
      avatarUrl: '',
      identityData: {},
    }),
    handleSharedCallback: vi.fn().mockReturnValue({
      provider: 'google',
      providerId: '123',
      email: 'test@test.com',
      userName: 'Test',
      avatarUrl: '',
      identityData: {},
    }),
  }),
});

vi.mock('../../src/providers/oauth/google.provider.js', () => ({
  GoogleOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/github.provider.js', () => ({
  GitHubOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/discord.provider.js', () => ({
  DiscordOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/linkedin.provider.js', () => ({
  LinkedInOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/facebook.provider.js', () => ({
  FacebookOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/microsoft.provider.js', () => ({
  MicrosoftOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/x.provider.js', () => ({
  XOAuthProvider: makeOAuthProviderMock(),
}));
vi.mock('../../src/providers/oauth/apple.provider.js', () => ({
  AppleOAuthProvider: makeOAuthProviderMock(),
}));

// ---------------------------------------------------------------------------

async function getAuthService() {
  // Must stub env vars before importing AuthService
  vi.stubEnv('ADMIN_EMAIL', 'admin@test.com');
  vi.stubEnv('ADMIN_PASSWORD', 'password123');
  const { AuthService } = await import('../../src/services/auth/auth.service.js');
  return AuthService.getInstance();
}

describe('AuthService — unsupported OAuth provider branches (Issue #1405 Phase 2)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  describe('generateOAuthUrl() default branch', () => {
    it('throws AppError(501, AUTH_UNSUPPORTED_PROVIDER) for unknown provider', async () => {
      const authService = await getAuthService();

      // Force the TypeScript exhaustive switch to hit its default branch
      await expect(authService.generateOAuthUrl('unknown_provider' as never)).rejects.toMatchObject(
        {
          statusCode: 501,
          code: ERROR_CODES.AUTH_UNSUPPORTED_PROVIDER,
          name: 'AppError',
        }
      );
    });

    it('error message matches exactly', async () => {
      const authService = await getAuthService();
      await expect(authService.generateOAuthUrl('tiktok' as never)).rejects.toThrow(
        "OAuth provider 'tiktok' is not implemented yet."
      );
    });

    it('is an AppError (name === AppError), not a plain Error', async () => {
      const authService = await getAuthService();
      let thrown: unknown;
      try {
        await authService.generateOAuthUrl('nonexistent' as never);
      } catch (e) {
        thrown = e;
      }
      // Check name since class identity breaks across module boundaries in Vitest
      expect((thrown as Error).name).toBe('AppError');
      expect((thrown as { statusCode?: number }).statusCode).toBe(501);
    });
  });

  describe('handleOAuthCallback() default branch', () => {
    it('throws AppError(501, AUTH_UNSUPPORTED_PROVIDER) for unknown provider', async () => {
      const authService = await getAuthService();
      await expect(
        authService.handleOAuthCallback('unknown_provider' as never, { code: 'abc' })
      ).rejects.toMatchObject({
        statusCode: 501,
        code: ERROR_CODES.AUTH_UNSUPPORTED_PROVIDER,
        name: 'AppError',
      });
    });

    it('error message matches exactly', async () => {
      const authService = await getAuthService();
      await expect(
        authService.handleOAuthCallback('unknown_provider' as never, { code: 'abc' })
      ).rejects.toThrow("OAuth provider 'unknown_provider' is not implemented yet.");
    });
  });

  describe('handleSharedCallback() default branch', () => {
    it('throws AppError(501, AUTH_UNSUPPORTED_PROVIDER) for unknown provider', async () => {
      const authService = await getAuthService();
      await expect(authService.handleSharedCallback('unknown' as never, {})).rejects.toMatchObject({
        statusCode: 501,
        code: ERROR_CODES.AUTH_UNSUPPORTED_PROVIDER,
        name: 'AppError',
      });
    });

    it('error message matches exactly', async () => {
      const authService = await getAuthService();
      await expect(authService.handleSharedCallback('unknown' as never, {})).rejects.toThrow(
        "OAuth provider 'unknown' is not supported for shared callback."
      );
    });
  });
});
