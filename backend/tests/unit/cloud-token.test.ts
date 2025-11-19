import { TokenManager } from '../../src/infra/security/token.manager';
import { jwtVerify } from 'jose';
import { AppError } from '../../src/api/middlewares/error';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

// Mock jose.jwtVerify
vi.mock('jose', () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => 'mockedJwks'),
}));

describe('TokenManager.verifyCloudToken', () => {
  const oldEnv = process.env;
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...oldEnv,
      PROJECT_ID: 'project_123',
      CLOUD_API_HOST: 'https://mock-api.dev',
      JWT_SECRET: 'test-secret-key'
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
});
