import { TokenManager } from '../../src/infra/security/token.manager';
import { jwtVerify } from 'jose';
import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Mock jose.jwtVerify
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'mockedJwks'),
}));

vi.mock('../../src/infra/config/app.config', () => {
  const c = {
    cloud: {
      projectId: 'project_123',
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
      payload: { projectId: 'project_123', user: 'testUser' },
    });

    const result = await tokenManager.verifyCloudToken('valid-token');
    expect(result.projectId).toBe('project_123');
    expect(result.payload.user).toBe('testUser');
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
});
