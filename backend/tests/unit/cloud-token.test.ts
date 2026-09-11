import { TokenManager } from '../../src/infra/security/token.manager';
import jwt from 'jsonwebtoken';
import { jwtVerify } from 'jose';
import { AppError } from '../../src/utils/errors';
import { appConfig } from '../../src/infra/config/app.config';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

// Mock jose.jwtVerify
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'mockedJwks'),
}));

// The app.config mock below has no `server` key, so the real logger cannot
// initialize (it reads appConfig.server.logsDir at import time).
vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/infra/config/app.config', () => {
  const c = {
    cloud: {
      projectId: 'project_123' as string | undefined,
      apiHost: 'https://mock-api.dev',
    },
    app: {
      jwtSecret: 'test-secret-key' as string | undefined,
    },
  };
  return {
    config: c,
    appConfig: c,
  };
});

describe('TokenManager.verifyCloudToken', () => {
  const oldEnv = process.env;
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.resetAllMocks();
    appConfig.cloud.projectId = 'project_123';
    process.env = {
      ...oldEnv,
      PROJECT_ID: 'project_123',
      CLOUD_API_HOST: 'https://mock-api.dev',
      JWT_SECRET: 'test-secret-key',
    };
    tokenManager = TokenManager.getInstance();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  it('returns payload and projectId if valid', async () => {
    (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      payload: {
        projectId: 'project_123',
        userId: 'test-user',
        type: 'project_authorization',
      },
    });

    const result = await tokenManager.verifyCloudToken('valid-token');
    expect(result.projectId).toBe('project_123');
    expect(result.payload.userId).toBe('test-user');
  });

  it('throws AppError if project ID mismatch or missing', async () => {
    (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      payload: {}, // missing projectId also counts as mismatch
    });

    await expect(tokenManager.verifyCloudToken('token')).rejects.toThrow(AppError);
  });

  it('wraps JWT verification failures as unauthorized AppError', async () => {
    (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('JWT expired'));

    await expect(tokenManager.verifyCloudToken('expired-token')).rejects.toMatchObject({
      statusCode: 401,
      code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
    });
  });

  describe('verifyCloudProjectAuthorization', () => {
    it('fails closed before Cloud verification when the local project ID is missing', async () => {
      appConfig.cloud.projectId = undefined;

      await expect(
        tokenManager.verifyCloudProjectAuthorization('valid-token')
      ).rejects.toMatchObject({
        statusCode: 500,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
      expect(jwtVerify).not.toHaveBeenCalled();
    });

    it('returns a typed project and user identity for a valid token', async () => {
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          projectId: 'project_123',
          userId: 'user_123',
          type: 'project_authorization',
        },
      });

      await expect(tokenManager.verifyCloudProjectAuthorization('valid-token')).resolves.toEqual({
        projectId: 'project_123',
        userId: 'user_123',
      });
      expect(jwtVerify).toHaveBeenCalledOnce();
    });

    it.each([undefined, '', '   ', 123, {}])('rejects malformed userId %j', async (userId) => {
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          projectId: 'project_123',
          userId,
          type: 'project_authorization',
        },
      });

      await expect(
        tokenManager.verifyCloudProjectAuthorization('invalid-token')
      ).rejects.toMatchObject({
        statusCode: 401,
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      });
    });

    it.each([undefined, 'access', 'project-admin'])('rejects token type %j', async (type) => {
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: { projectId: 'project_123', userId: 'user_123', type },
      });

      await expect(
        tokenManager.verifyCloudProjectAuthorization('invalid-token')
      ).rejects.toMatchObject({
        statusCode: 401,
        code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
      });
    });

    it('rejects a token bound to another project', async () => {
      (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        payload: {
          projectId: 'project_456',
          userId: 'user_123',
          type: 'project_authorization',
        },
      });

      await expect(
        tokenManager.verifyCloudProjectAuthorization('wrong-project')
      ).rejects.toMatchObject({
        statusCode: 403,
        code: ERROR_CODES.AUTH_UNAUTHORIZED,
      });
      expect(jwtVerify).toHaveBeenCalledOnce();
    });

    it.each(['JWT expired', 'signature verification failed'])(
      'rejects Cloud verification failure: %s',
      async (message) => {
        (jwtVerify as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error(message));

        await expect(
          tokenManager.verifyCloudProjectAuthorization('invalid-token')
        ).rejects.toMatchObject({
          statusCode: 401,
          code: ERROR_CODES.AUTH_INVALID_CREDENTIALS,
        });
      }
    );
  });
});

describe('TokenManager.signCloudToken', () => {
  const savedProfile = process.env.AWS_INSTANCE_PROFILE_NAME;
  const savedProjectId = appConfig.cloud.projectId;
  const savedSecret = appConfig.app.jwtSecret;

  afterEach(() => {
    appConfig.cloud.projectId = savedProjectId;
    appConfig.app.jwtSecret = savedSecret;
  });

  beforeEach(() => {
    process.env.AWS_INSTANCE_PROFILE_NAME = 'EC2-role';
    appConfig.cloud.projectId = 'project_123';
    appConfig.app.jwtSecret = 'test-secret-key';
  });

  afterAll(() => {
    if (savedProfile === undefined) {
      delete process.env.AWS_INSTANCE_PROFILE_NAME;
    } else {
      process.env.AWS_INSTANCE_PROFILE_NAME = savedProfile;
    }
  });

  it('signs sub: projectId with the project secret for 10 minutes', () => {
    const token = TokenManager.getInstance().signCloudToken('Cloud analytics');
    const decoded = jwt.verify(token, 'test-secret-key') as {
      sub: string;
      exp: number;
      iat: number;
    };

    expect(decoded.sub).toBe('project_123');
    expect(decoded).not.toHaveProperty('projectId');
    expect(decoded.exp - decoded.iat).toBe(600);
  });

  // The one gate five features share: a self-host that sets PROJECT_ID must not sign a
  // token with its own secret and call our API, which fails remotely and tells the
  // operator nothing.
  it('refuses off our infrastructure, naming the feature', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;

    expect(() => TokenManager.getInstance().signCloudToken('Cloud database access')).toThrow(
      'Cloud database access is only available on InsForge Cloud projects.'
    );
  });

  it('carries the caller error code so it is not masked downstream', () => {
    delete process.env.AWS_INSTANCE_PROFILE_NAME;

    expect(() =>
      TokenManager.getInstance().signCloudToken('Cloud compute', ERROR_CODES.COMPUTE_NOT_CONFIGURED)
    ).toThrow(expect.objectContaining({ code: ERROR_CODES.COMPUTE_NOT_CONFIGURED }));
    expect(() => TokenManager.getInstance().signCloudToken('Cloud analytics')).toThrow(
      expect.objectContaining({ code: ERROR_CODES.INTERNAL_ERROR })
    );
  });

  it('names the missing variable on a cloud instance', () => {
    appConfig.cloud.projectId = undefined;
    expect(() => TokenManager.getInstance().signCloudToken('Cloud analytics')).toThrow(
      'PROJECT_ID is not configured'
    );

    appConfig.cloud.projectId = 'project_123';
    appConfig.app.jwtSecret = '';
    expect(() => TokenManager.getInstance().signCloudToken('Cloud analytics')).toThrow(
      'JWT_SECRET is not configured'
    );
  });
});
