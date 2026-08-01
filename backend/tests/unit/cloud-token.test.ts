import { TokenManager } from '../../src/infra/security/token.manager';
import { jwtVerify } from 'jose';
import { AppError } from '../../src/utils/errors';
import { appConfig } from '../../src/infra/config/app.config';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

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
      jwtSecret: 'test-secret-key',
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
