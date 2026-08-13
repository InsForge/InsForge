import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { ERROR_CODES } from '@insforge/shared-schemas';

const configMock = {
  cloud: { projectId: 'proj-1' as string | undefined, apiHost: 'https://cloud.test' },
  app: { jwtSecret: 's'.repeat(32) as string | undefined },
};
vi.mock('@/infra/config/app.config.js', () => ({ config: configMock, appConfig: configMock }));

const { signCloudToken } = await import('@/infra/security/cloud-sign.js');

const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;

beforeEach(() => {
  process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
  configMock.cloud.projectId = 'proj-1';
  configMock.app.jwtSecret = 's'.repeat(32);
});

afterAll(() => {
  if (savedProfile === undefined) {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;
  } else {
    process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
  }
});

describe('signCloudToken', () => {
  it('signs sub: projectId with the project secret', () => {
    const decoded = jwt.verify(signCloudToken('Cloud analytics'), 's'.repeat(32)) as {
      sub: string;
      exp: number;
      iat: number;
    };

    expect(decoded.sub).toBe('proj-1');
    expect(decoded.exp - decoded.iat).toBe(600);
  });

  // The one gate five features share: a self-host that sets PROJECT_ID must not sign a
  // token with its own secret and call our API, which fails remotely and tells the
  // operator nothing.
  it('refuses off our infrastructure, naming the feature', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;

    expect(() => signCloudToken('Cloud database access')).toThrow(
      'Cloud database access is only available on InsForge Cloud projects.'
    );
  });

  it('carries the caller error code so it is not masked downstream', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;

    expect(() => signCloudToken('Cloud compute', ERROR_CODES.COMPUTE_NOT_CONFIGURED)).toThrow(
      expect.objectContaining({ code: ERROR_CODES.COMPUTE_NOT_CONFIGURED })
    );
    expect(() => signCloudToken('Cloud analytics')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INTERNAL_ERROR })
    );
  });

  it('names the missing variable on a cloud instance', () => {
    configMock.cloud.projectId = undefined;
    expect(() => signCloudToken('Cloud analytics')).toThrow('PROJECT_ID is not configured');

    configMock.cloud.projectId = 'proj-1';
    configMock.app.jwtSecret = undefined;
    expect(() => signCloudToken('Cloud analytics')).toThrow('JWT_SECRET is not configured');
  });
});
