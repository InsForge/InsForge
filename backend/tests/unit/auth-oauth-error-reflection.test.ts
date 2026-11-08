import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const JWT_SECRET = 'test-jwt-secret-key-32-chars-minimum!';

vi.mock('../../src/services/auth/auth-config.service.js', () => ({
  AuthConfigService: {
    getInstance: () => ({
      validateRedirectUrl: vi.fn().mockResolvedValue(true),
    }),
  },
}));

const mockHandleOAuthCallback = vi.fn();

vi.mock('../../src/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      handleOAuthCallback: (...args: unknown[]) => mockHandleOAuthCallback(...args),
      handleSharedCallback: vi.fn(),
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

vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('OAuth callback redirect error sanitization', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('JWT_SECRET', JWT_SECRET);

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
