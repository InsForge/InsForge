import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '@insforge/shared-schemas';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  generateOAuthUrl: vi.fn(),
  handleOAuthCallback: vi.fn(),
  handleSharedCallback: vi.fn(),
  getConfigByProvider: vi.fn(),
  createCode: vi.fn(),
  verifyIdentityToken: vi.fn(),
}));

// Keep the real redirect validator, query schemas, JWT state and Express routes.
// Replace only database access, provider/network work and session creation.
vi.mock('@/infra/database/database.manager.js', () => ({
  DatabaseManager: { getInstance: () => ({ getPool: () => ({ query: mocks.query }) }) },
}));
vi.mock('@/services/auth/auth.service.js', () => ({
  AuthService: {
    getInstance: () => ({
      generateOAuthUrl: mocks.generateOAuthUrl,
      handleOAuthCallback: mocks.handleOAuthCallback,
      handleSharedCallback: mocks.handleSharedCallback,
    }),
  },
}));
vi.mock('@/services/auth/oauth-config.service.js', () => ({
  OAuthConfigService: { getInstance: () => ({ getConfigByProvider: mocks.getConfigByProvider }) },
}));
vi.mock('@/services/auth/oauth-pkce.service.js', () => ({
  OAuthPKCEService: { getInstance: () => ({ createCode: mocks.createCode }) },
}));
vi.mock('@/services/auth/shared-oauth.service.js', () => ({
  SharedOAuthService: { getInstance: () => ({ verifyIdentityToken: mocks.verifyIdentityToken }) },
}));
vi.mock('@/services/logs/audit.service.js', () => ({
  AuditService: { getInstance: () => ({ log: vi.fn() }) },
}));
vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => ({}) },
}));
vi.mock('@/api/middlewares/auth.js', () => ({
  verifyAdmin: vi.fn(),
}));
vi.mock('@/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import oauthRouter from '../../src/api/routes/auth/oauth.routes.js';
import { errorMiddleware } from '../../src/api/middlewares/error.js';

const JWT_SECRET = 'custom-domain-route-test-secret';
const REDIRECT_URI = 'https://app.customer.example/auth/callback';
const CODE_CHALLENGE = 'a'.repeat(43);
const AUTH_URL = 'https://github.com/login/oauth/authorize?client_id=test-client';

function makeState() {
  return jwt.sign(
    { provider: 'github', redirectUri: REDIRECT_URI, codeChallenge: CODE_CHALLENGE },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

const app = express();
app.use('/api/auth/oauth', oauthRouter);
app.use(errorMiddleware);

describe('GitHub OAuth with a custom application domain (#1855)', () => {
  beforeAll(() => {
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [{ allowedRedirectUrls: [REDIRECT_URI] }] });
    mocks.generateOAuthUrl.mockResolvedValue(AUTH_URL);
    mocks.getConfigByProvider.mockResolvedValue({ useSharedKey: true });
    mocks.handleOAuthCallback.mockResolvedValue({ user: { id: 'user-id' } });
    mocks.handleSharedCallback.mockResolvedValue({ user: { id: 'user-id' } });
    mocks.createCode.mockReturnValue('exchange-code');
    mocks.verifyIdentityToken.mockReturnValue({ providerId: 'github-user-id' });
  });

  it('accepts an allowlisted custom-domain redirect on the default project API host', async () => {
    const response = await request(app)
      .get('/api/auth/oauth/github')
      .set('Host', 'project.ap-southeast.insforge.app')
      .query({ redirect_uri: REDIRECT_URI, code_challenge: CODE_CHALLENGE });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ authUrl: AUTH_URL });
    expect(mocks.generateOAuthUrl).toHaveBeenCalledWith('github', expect.any(String), {});
    const state = mocks.generateOAuthUrl.mock.calls[0][1] as string;
    expect(jwt.verify(state, JWT_SECRET)).toMatchObject({
      provider: 'github',
      redirectUri: REDIRECT_URI,
      codeChallenge: CODE_CHALLENGE,
    });
  });

  it('accepts an explicitly configured custom-domain path wildcard', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ allowedRedirectUrls: ['https://app.customer.example/**'] }],
    });

    const response = await request(app)
      .get('/api/auth/oauth/github')
      .query({ redirect_uri: REDIRECT_URI, code_challenge: CODE_CHALLENGE });

    expect(response.status).toBe(200);
  });

  it('returns the allowlist error when only the old application domain is configured', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ allowedRedirectUrls: ['https://old.insforge.site/**'] }],
    });

    const response = await request(app)
      .get('/api/auth/oauth/github')
      .query({ redirect_uri: REDIRECT_URI, code_challenge: CODE_CHALLENGE });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.INVALID_INPUT,
      message: `${REDIRECT_URI} is not in the allowed redirect URLs`,
    });
    expect(mocks.generateOAuthUrl).not.toHaveBeenCalled();
  });

  it('rejects a callback path when the allowlist contains only its origin', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ allowedRedirectUrls: ['https://app.customer.example'] }],
    });

    const response = await request(app)
      .get('/api/auth/oauth/github')
      .query({ redirect_uri: REDIRECT_URI, code_challenge: CODE_CHALLENGE });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.INVALID_INPUT,
      message: `${REDIRECT_URI} is not in the allowed redirect URLs`,
    });
    expect(mocks.generateOAuthUrl).not.toHaveBeenCalled();
  });

  it('rejects a lookalike domain despite an allowed custom-domain path wildcard', async () => {
    mocks.query.mockResolvedValue({
      rows: [{ allowedRedirectUrls: ['https://app.customer.example/**'] }],
    });

    const response = await request(app).get('/api/auth/oauth/github').query({
      redirect_uri: 'https://app.customer.example.attacker.example/auth/callback',
      code_challenge: CODE_CHALLENGE,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.INVALID_INPUT,
      message:
        'https://app.customer.example.attacker.example/auth/callback is not in the allowed redirect URLs',
    });
    expect(mocks.generateOAuthUrl).not.toHaveBeenCalled();
  });

  it('returns the distinct validation error when PKCE is missing', async () => {
    const response = await request(app)
      .get('/api/auth/oauth/github')
      .query({ redirect_uri: REDIRECT_URI });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: ERROR_CODES.INVALID_INPUT,
      message: 'code_challenge: Required',
    });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.generateOAuthUrl).not.toHaveBeenCalled();
  });

  it('redirects the own-key provider callback to the custom domain with an exchange code', async () => {
    const response = await request(app)
      .get('/api/auth/oauth/github/callback')
      .query({ code: 'github-code', state: makeState() });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${REDIRECT_URI}?insforge_code=exchange-code`);
    expect(mocks.handleOAuthCallback).toHaveBeenCalledWith('github', {
      code: 'github-code',
      token: undefined,
      state: expect.any(String),
    });
    expect(mocks.createCode).toHaveBeenCalledWith({
      userId: 'user-id',
      codeChallenge: CODE_CHALLENGE,
      provider: 'github',
    });
  });

  it('redirects the shared-key callback to the same allowed custom domain', async () => {
    const state = makeState();
    const response = await request(app)
      .get(`/api/auth/oauth/shared/callback/${state}`)
      .query({ success: 'true', token: 'signed-identity-token' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${REDIRECT_URI}?insforge_code=exchange-code`);
    expect(mocks.verifyIdentityToken).toHaveBeenCalledWith('signed-identity-token', {
      provider: 'github',
      state,
    });
  });

  it.each(['own', 'shared'])(
    'rechecks the allowlist before the %s-key callback completes',
    async (flow) => {
      const state = makeState();
      mocks.query.mockResolvedValue({
        rows: [{ allowedRedirectUrls: ['https://old.insforge.site/**'] }],
      });
      const response =
        flow === 'own'
          ? await request(app)
              .get('/api/auth/oauth/github/callback')
              .query({ code: 'github-code', state })
          : await request(app)
              .get(`/api/auth/oauth/shared/callback/${state}`)
              .query({ success: 'true', token: 'signed-identity-token' });

      expect(response.status).toBe(400);
      expect(response.headers.location).toBeUndefined();
      expect(mocks.handleOAuthCallback).not.toHaveBeenCalled();
      expect(mocks.handleSharedCallback).not.toHaveBeenCalled();
      expect(mocks.createCode).not.toHaveBeenCalled();
    }
  );
});
