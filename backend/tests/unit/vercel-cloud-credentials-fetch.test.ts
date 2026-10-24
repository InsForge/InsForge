import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { VercelProvider } from '@/providers/deployments/vercel.provider.js';
import { AppError } from '@/utils/errors.js';
import { appConfig } from '@/infra/config/app.config.js';

vi.mock('@/utils/environment.js', () => ({
  isCloudEnvironment: () => true,
}));

vi.mock('@/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

vi.mock('@/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({ signCloudToken: () => 'test-signature' }),
  },
}));

describe('VercelProvider.getCredentials (cloud)', () => {
  const originalProjectId = appConfig.cloud.projectId;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // @ts-expect-error accessing private static for test reset
    VercelProvider.instance = undefined;
    appConfig.cloud.projectId = 'project-123';
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    appConfig.cloud.projectId = originalProjectId;
    vi.unstubAllGlobals();
  });

  it('rejects with a DEPLOYMENT_QUOTA_EXCEEDED AppError when the cloud refuses over quota', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'quota_exceeded',
          quota: 'vercel_build_minutes',
          upgrade_url: 'https://example.com/upgrade',
          message: 'Your organization has used its Vercel build minutes.',
        }),
        { status: 403, statusText: 'Forbidden', headers: { 'Content-Type': 'application/json' } }
      )
    );

    const error = await VercelProvider.getInstance()
      .getCredentials()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({
      statusCode: 403,
      code: ERROR_CODES.DEPLOYMENT_QUOTA_EXCEEDED,
    });
  });

  it('bounds the credentials request with a timeout signal', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        statusText: 'Not Found',
      })
    );

    await expect(VercelProvider.getInstance().getCredentials()).rejects.toThrow(
      'Failed to fetch Vercel credentials: 404 Not Found - Project not found'
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toContain('/sites/v1/credentials/project-123?sign=test-signature');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
