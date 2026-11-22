import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppError } from '../../src/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

const JWT_SECRET = 'test-jwt-secret-key-32-chars-minimum!';
const VALID_TOKEN = 'a'.repeat(64);

const mockValidateRedirectUrl = vi.fn();

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      validateRedirectUrl: (...args: unknown[]) => mockValidateRedirectUrl(...args),
    }),
  },
}));

vi.mock('../../src/infra/config/app.config.js', () => ({
  appConfig: {
    app: { jwtSecret: JWT_SECRET },
    cloud: { projectId: undefined },
  },
}));

const mockHandleOAuthCallback = vi.fn();
const mockVerifyEmailWithToken = vi.fn();

vi.mock('../../src/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      handleOAuthCallback: (...args: unknown[]) => mockHandleOAuthCallback(...args),
      handleSharedCallback: vi.fn(),
      verifyEmailWithToken: (...args: unknown[]) => mockVerifyEmailWithToken(...args),
    }),
  },
}));

vi.mock('../../src/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: {
    getInstance: () => ({
      getConfigByProvider: vi.fn().mockResolvedValue({ useSharedKey: true }),
    }),
  },
}));

vi.mock('../../src/services/auth/oauth-pkce.service.js', () => ({
  OAuthPKCEService: {
    getInstance: () => ({
      createCode: vi.fn().mockReturnValue('mock-exchange-code'),
    }),
  },
}));

const mockVerifyIdentityToken = vi.fn();
vi.mock('../../src/services/auth/shared-oauth.service.js', () => ({
  SharedOAuthService: {
    getInstance: () => ({
      verifyIdentityToken: (...args: unknown[]) => mockVerifyIdentityToken(...args),
    }),
  },
}));

const mockGetEmailOTPContextByToken = vi.fn();

vi.mock('../../src/services/auth/auth-otp.service.js', () => ({
  AuthOTPService: {
    getInstance: () => ({
      getEmailOTPContextByToken: (...args: unknown[]) => mockGetEmailOTPContextByToken(...args),
    }),
  },
  OTPPurpose: {
    VERIFY_EMAIL: 'verify_email',
    RESET_PASSWORD: 'reset_password',
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('OAuth callback redirect error sanitization', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
    mockValidateRedirectUrl.mockResolvedValue(true);

    const { default: oauthRouter } = await import('../../src/api/routes/auth/oauth.routes.js');
    app = express();
    app.use('/api/auth/oauth', oauthRouter);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('does not reflect raw upstream/internal error message into callback redirect URL', async () => {
    mockHandleOAuthCallback.mockRejectedValueOnce(
      new Error('upstream token endpoint 502: secret_key=sk_live_123 failed')
    );

    const statePayload = {
      provider: 'github',
      redirectUri: 'https://example.com/auth/callback',
      codeChallenge: 'challenge-123',
    };
    const state = jwt.sign(statePayload, JWT_SECRET);

    const res = await request(app)
      .get('/api/auth/oauth/github/callback')
      .query({ code: 'valid-code', state });

    expect(res.status).toBe(302);
    const redirectLocation = res.headers.location;
    expect(redirectLocation).toBeDefined();

    const redirectUrl = new URL(redirectLocation);
    expect(redirectUrl.searchParams.get('error')).toBe('Authentication failed');
    expect(redirectUrl.searchParams.get('error')).not.toContain('secret_key=sk_live_123');
  });

  it('does not reflect raw error query parameter in shared OAuth failure redirect', async () => {
    const statePayload = {
      provider: 'github',
      redirectUri: 'https://example.com/auth/callback',
      codeChallenge: 'challenge-123',
    };
    const state = jwt.sign(statePayload, JWT_SECRET);

    const res = await request(app)
      .get(`/api/auth/oauth/shared/callback/${encodeURIComponent(state)}`)
      .query({ success: 'false', error: 'sensitive_internal_upstream_provider_token_error' });

    expect(res.status).toBe(302);
    const redirectLocation = res.headers.location;
    expect(redirectLocation).toBeDefined();

    const redirectUrl = new URL(redirectLocation);
    expect(redirectUrl.searchParams.get('error')).toBe('Authentication failed');
    expect(redirectUrl.searchParams.get('error')).not.toContain(
      'sensitive_internal_upstream_provider_token_error'
    );
  });

  it('does not reflect raw error message in shared OAuth callback completion', async () => {
    mockVerifyIdentityToken.mockImplementationOnce(() => {
      throw new Error('JWT verification failed: secret key mismatch signature=abc');
    });

    const statePayload = {
      provider: 'github',
      redirectUri: 'https://example.com/auth/callback',
      codeChallenge: 'challenge-123',
    };
    const state = jwt.sign(statePayload, JWT_SECRET);

    const res = await request(app)
      .get(`/api/auth/oauth/shared/callback/${encodeURIComponent(state)}`)
      .query({ success: 'true', token: 'valid-looking-token' });

    expect(res.status).toBe(302);
    const redirectLocation = res.headers.location;
    expect(redirectLocation).toBeDefined();

    const redirectUrl = new URL(redirectLocation);
    expect(redirectUrl.searchParams.get('error')).toBe('Authentication failed');
    expect(redirectUrl.searchParams.get('error')).not.toContain('signature=abc');
  });
});

describe('Email link redirect error sanitization', () => {
  let app: express.Express;
  let AppErrorClass: typeof AppError;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', JWT_SECRET);

    mockValidateRedirectUrl.mockResolvedValue(true);
    mockGetEmailOTPContextByToken.mockResolvedValue({
      redirectTo: 'https://example.com/auth/landing',
    });

    const errMod = await import('../../src/utils/errors.js');
    AppErrorClass = errMod.AppError;

    const { default: authRouter } = await import('../../src/api/routes/auth/index.routes.js');
    app = express();
    app.use('/api/auth', authRouter);
    app.use(
      (
        err: { statusCode?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _next: express.NextFunction
      ) => {
        res.status(err.statusCode || 500).json({ message: err.message });
      }
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reflects operational AppError message on verify-link failure', async () => {
    mockVerifyEmailWithToken.mockRejectedValueOnce(
      new AppErrorClass(
        'Invalid or expired verification token',
        400,
        ERROR_CODES.AUTH_INVALID_TOKEN
      )
    );

    const res = await request(app).get('/api/auth/email/verify-link').query({ token: VALID_TOKEN });

    expect(res.status).toBe(302);
    const redirectUrl = new URL(res.headers.location);
    expect(redirectUrl.searchParams.get('insforge_status')).toBe('error');
    expect(redirectUrl.searchParams.get('insforge_error')).toBe(
      'Invalid or expired verification token'
    );
  });

  it('masks internal non-AppError on verify-link failure', async () => {
    mockVerifyEmailWithToken.mockRejectedValueOnce(
      new Error('database error: column "token" relation "users" does not exist')
    );

    const res = await request(app).get('/api/auth/email/verify-link').query({ token: VALID_TOKEN });

    expect(res.status).toBe(302);
    const redirectUrl = new URL(res.headers.location);
    expect(redirectUrl.searchParams.get('insforge_status')).toBe('error');
    expect(redirectUrl.searchParams.get('insforge_error')).toBe('Authentication action failed');
    expect(redirectUrl.searchParams.get('insforge_error')).not.toContain('database error');
  });

  it('reflects operational AppError message on reset-password-link failure', async () => {
    mockValidateRedirectUrl
      .mockRejectedValueOnce(
        new AppErrorClass('Database timeout checking redirect URL', 400, ERROR_CODES.INTERNAL_ERROR)
      )
      .mockResolvedValueOnce(true);

    const res = await request(app)
      .get('/api/auth/email/reset-password-link')
      .query({ token: VALID_TOKEN });

    expect(res.status).toBe(302);
    const redirectUrl = new URL(res.headers.location);
    expect(redirectUrl.searchParams.get('insforge_status')).toBe('error');
    expect(redirectUrl.searchParams.get('insforge_type')).toBe('reset_password');
    expect(redirectUrl.searchParams.get('insforge_error')).toBe(
      'Database timeout checking redirect URL'
    );
  });

  it('masks internal non-AppError on reset-password-link failure', async () => {
    mockValidateRedirectUrl
      .mockRejectedValueOnce(new Error('FATAL: password authentication failed for user "postgres"'))
      .mockResolvedValueOnce(true);

    const res = await request(app)
      .get('/api/auth/email/reset-password-link')
      .query({ token: VALID_TOKEN });

    expect(res.status).toBe(302);
    const redirectUrl = new URL(res.headers.location);
    expect(redirectUrl.searchParams.get('insforge_status')).toBe('error');
    expect(redirectUrl.searchParams.get('insforge_type')).toBe('reset_password');
    expect(redirectUrl.searchParams.get('insforge_error')).toBe('Authentication action failed');
    expect(redirectUrl.searchParams.get('insforge_error')).not.toContain('postgres');
  });

  it('handles reset-password-link error when token lookup fails', async () => {
    mockGetEmailOTPContextByToken.mockRejectedValueOnce(
      new AppErrorClass('Token not found', 400, ERROR_CODES.AUTH_INVALID_TOKEN)
    );

    const res = await request(app)
      .get('/api/auth/email/reset-password-link')
      .query({ token: VALID_TOKEN });

    expect(res.status).toBe(400);
  });
});
