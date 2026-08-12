import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const configMock = {
  cloud: { projectId: 'zeabur-project-1' as string | undefined, apiHost: 'https://cloud.test' },
  app: { jwtSecret: 's'.repeat(32), logLevel: 'error' },
  server: { logsDir: '/tmp/insforge-db-cloud-test-logs' },
};
vi.mock('@/infra/config/app.config.js', () => ({ config: configMock, appConfig: configMock }));

const axiosGet = vi.fn();
vi.mock('axios', () => ({ default: { get: axiosGet } }));

const { CloudDatabaseProvider } = await import('@/providers/database/cloud.provider.js');

const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

beforeEach(() => {
  vi.clearAllMocks();
  configMock.cloud.projectId = 'zeabur-project-1';
});

afterAll(() => {
  if (savedProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
  }
});

describe('CloudDatabaseProvider', () => {
  // The route behind this is unconditional, so the provider is the only gate. A
  // self-host that sets PROJECT_ID used to sign a token with its own secret and call
  // our API, which fails remotely with nothing an operator can act on.
  it('refuses to sign for a self-host that sets PROJECT_ID', async () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
    const provider = CloudDatabaseProvider.getInstance();

    await expect(provider.getDatabaseConnectionString()).rejects.toThrow(
      'only available on InsForge Cloud projects'
    );
    expect(axiosGet).not.toHaveBeenCalled();
  });

  it('signs sub: projectId and calls the cloud on a cloud project', async () => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    axiosGet.mockResolvedValue({
      data: { databasePassword: 'pw' },
    });
    const provider = CloudDatabaseProvider.getInstance();

    await expect(provider.getDatabasePassword()).resolves.toEqual({ databasePassword: 'pw' });
    const headers = axiosGet.mock.calls[0][1].headers as Record<string, string>;
    const decoded = jwt.verify(headers.sign, 's'.repeat(32)) as { sub: string };
    expect(decoded.sub).toBe('zeabur-project-1');
  });
});
