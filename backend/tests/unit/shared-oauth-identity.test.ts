/**
 * The shared-OAuth callback used to accept a base64 `payload` query parameter as
 * identity, so anyone could mint a session for any email. These pin the checks that
 * replaced it: cloud signature, project binding, flow binding, single use.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import crypto from 'crypto';

const verifyCloudToken = vi.fn();
const signCloudToken = vi.fn(() => 'project-sign-token');

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: { getInstance: () => ({ verifyCloudToken, signCloudToken }) },
}));
vi.mock('../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PROJECT_ID = 'project-under-test';
const STATE = 'state-jwt-for-this-login-attempt';
const FLOW_ID = crypto.createHash('sha256').update(STATE).digest('hex');

function assertion(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      type: 'shared_oauth_identity',
      projectId: PROJECT_ID,
      provider: 'github',
      sid: FLOW_ID,
      jti: crypto.randomUUID(),
      exp: Math.floor(Date.now() / 1000) + 120,
      identity: { providerId: '42', email: 'victim@example.com', name: 'Victim' },
      ...overrides,
    },
  };
}

async function getService() {
  const { SharedOAuthService } = await import('../../src/services/auth/shared-oauth.service.js');
  return SharedOAuthService.getInstance();
}

describe('SharedOAuthService.verifyIdentityToken', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('PROJECT_ID', PROJECT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the identity when the cloud assertion is valid', async () => {
    verifyCloudToken.mockResolvedValue(assertion());
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).resolves.toEqual({ providerId: '42', email: 'victim@example.com', name: 'Victim' });
  });

  it('rejects a token the cloud did not sign', async () => {
    verifyCloudToken.mockRejectedValue(new Error('signature verification failed'));
    const service = await getService();

    await expect(
      service.verifyIdentityToken('forged', { provider: 'github', state: STATE })
    ).rejects.toThrow('signature verification failed');
  });

  it('rejects a cloud token minted for something other than a shared OAuth login', async () => {
    verifyCloudToken.mockResolvedValue(assertion({ type: 'project_authorization' }));
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an assertion issued for a different project', async () => {
    verifyCloudToken.mockResolvedValue(assertion({ projectId: 'someone-elses-project' }));
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an assertion issued for a different provider', async () => {
    verifyCloudToken.mockResolvedValue(assertion({ provider: 'google' }));
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an assertion issued for a different login attempt', async () => {
    verifyCloudToken.mockResolvedValue(assertion());
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: 'another-state' })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an assertion carrying no identity', async () => {
    verifyCloudToken.mockResolvedValue(assertion({ identity: undefined }));
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an assertion whose lifetime runs far past the flow it belongs to', async () => {
    verifyCloudToken.mockResolvedValue(
      assertion({ exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60 })
    );
    const service = await getService();

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a replay of an assertion it already accepted', async () => {
    verifyCloudToken.mockResolvedValue(assertion({ jti: 'fixed-jti' }));
    const service = await getService();

    await service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE });

    await expect(
      service.verifyIdentityToken('cloud-token', { provider: 'github', state: STATE })
    ).rejects.toMatchObject({ statusCode: 401 });
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
