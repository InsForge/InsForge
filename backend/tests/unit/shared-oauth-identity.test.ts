/**
 * The shared-OAuth callback used to accept a base64 `payload` query parameter as
 * identity, so anyone could mint a session for any email. These pin the checks that
 * replaced it: the assertion is signed with this project's own secret, for this
 * project, this provider and this login attempt, and it is usable once.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

const signCloudToken = vi.fn(() => 'project-sign-token');

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => ({ signCloudToken }) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PROJECT_ID = 'project-under-test';
const JWT_SECRET = 'this-projects-jwt-secret';
const STATE = 'state-jwt-for-this-login-attempt';
const FLOW_ID = crypto.createHash('sha256').update(STATE).digest('hex');
const IDENTITY = { providerId: '42', email: 'victim@example.com', name: 'Victim' };

function assertion(overrides: Record<string, unknown> = {}, secret = JWT_SECRET) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      type: 'shared_oauth_identity',
      projectId: PROJECT_ID,
      provider: 'github',
      sid: FLOW_ID,
      identity: IDENTITY,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + 120,
      ...overrides,
    },
    secret,
    { algorithm: 'HS256' }
  );
}

async function getService() {
  const { SharedOAuthService } = await import('../../src/services/auth/shared-oauth.service.js');
  return SharedOAuthService.getInstance();
}

const context = { provider: 'github', state: STATE };

describe('SharedOAuthService.verifyIdentityToken', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('PROJECT_ID', PROJECT_ID);
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the identity when the assertion is valid', async () => {
    const service = await getService();

    expect(service.verifyIdentityToken(assertion(), context)).toEqual(IDENTITY);
  });

  it('rejects an identity the caller built themselves', async () => {
    const service = await getService();
    const forged = Buffer.from(JSON.stringify(IDENTITY)).toString('base64');

    expect(() => service.verifyIdentityToken(forged, context)).toThrowError(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('rejects an assertion signed with a secret that is not ours', async () => {
    const service = await getService();

    expect(() =>
      service.verifyIdentityToken(assertion({}, 'another-secret'), context)
    ).toThrowError(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects a token minted for something other than a shared OAuth login', async () => {
    const service = await getService();

    expect(() =>
      service.verifyIdentityToken(assertion({ type: 'project_authorization' }), context)
    ).toThrowError(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an assertion carrying a subject, which would also pass as an access token', async () => {
    const service = await getService();

    expect(() =>
      service.verifyIdentityToken(assertion({ sub: 'some-user-id' }), context)
    ).toThrowError(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an assertion issued for a different project', async () => {
    const service = await getService();

    expect(() =>
      service.verifyIdentityToken(assertion({ projectId: 'someone-elses-project' }), context)
    ).toThrowError(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an assertion issued for a different provider', async () => {
    const service = await getService();

    expect(() =>
      service.verifyIdentityToken(assertion({ provider: 'google' }), context)
    ).toThrowError(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an assertion issued for a different login attempt', async () => {
    const service = await getService();

    expect(() =>
      service.verifyIdentityToken(assertion(), { provider: 'github', state: 'another-state' })
    ).toThrowError(expect.objectContaining({ statusCode: 401 }));
  });

  it('rejects an assertion carrying no identity', async () => {
    const service = await getService();

    expect(() => service.verifyIdentityToken(assertion({ identity: 0 }), context)).toThrowError(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('rejects an assertion whose lifetime runs far past the flow it belongs to', async () => {
    const service = await getService();
    const exp = Math.floor(Date.now() / 1000) + 24 * 60 * 60;

    expect(() => service.verifyIdentityToken(assertion({ exp }), context)).toThrowError(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('rejects an expired assertion', async () => {
    const service = await getService();
    const exp = Math.floor(Date.now() / 1000) - 1;

    expect(() => service.verifyIdentityToken(assertion({ exp }), context)).toThrowError(
      expect.objectContaining({ statusCode: 401 })
    );
  });

  it('rejects a replay of an assertion it already accepted', async () => {
    const service = await getService();
    const token = assertion();

    service.verifyIdentityToken(token, context);

    expect(() => service.verifyIdentityToken(token, context)).toThrowError(
      expect.objectContaining({ statusCode: 401 })
    );
  });
});

describe('buildSharedOAuthInitQuery', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('PROJECT_ID', PROJECT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('binds the cloud flow to this project and this login attempt', async () => {
    const { buildSharedOAuthInitQuery } =
      await import('../../src/services/auth/shared-oauth.service.js');

    const params = new URLSearchParams(
      buildSharedOAuthInitQuery('https://instance.example/api/auth/oauth/shared/callback', STATE)
    );

    expect(params.get('project_id')).toBe(PROJECT_ID);
    expect(params.get('sign')).toBe('project-sign-token');
    expect(params.get('flow_id')).toBe(FLOW_ID);
    expect(params.get('redirect_uri')).toBe(
      'https://instance.example/api/auth/oauth/shared/callback'
    );
  });
});
