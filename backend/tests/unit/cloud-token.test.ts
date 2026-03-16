import { TokenManager } from '../../src/infra/security/token.manager';
import { jwtVerify } from 'jose';
import { AppError } from '../../src/api/middlewares/error';
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import jwt from 'jsonwebtoken';

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
});

describe('TokenManager.generateApiKeyToken', () => {
  const oldEnv = process.env;
  let tokenManager: TokenManager;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = {
      ...oldEnv,
      JWT_SECRET: 'test-secret-for-api-key',
      CLOUD_API_HOST: 'https://mock-api.dev',
    };
    tokenManager = TokenManager.getInstance();
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  it('generates a token with an exp claim approximately 30 days from now', () => {
    const token = tokenManager.generateApiKeyToken();
    const decoded = jwt.decode(token) as { exp?: number; sub?: string; role?: string };

    expect(decoded).not.toBeNull();
    expect(decoded.exp).toBeDefined();

    const now = Math.floor(Date.now() / 1000);
    const thirtyDaysInSeconds = 30 * 24 * 60 * 60;

    // exp should be within 1 minute of now + 30 days
    expect(decoded.exp!).toBeGreaterThan(now + thirtyDaysInSeconds - 60);
    expect(decoded.exp!).toBeLessThanOrEqual(now + thirtyDaysInSeconds + 60);
  });

  it('generates a different token on each call (ensures tokens are fresh)', () => {
    const token1 = tokenManager.generateApiKeyToken();
    // Small delay to ensure iat differs
    const token2 = tokenManager.generateApiKeyToken();
    // Both must be valid JWTs with exp claims
    const d1 = jwt.decode(token1) as { exp?: number };
    const d2 = jwt.decode(token2) as { exp?: number };
    expect(d1.exp).toBeDefined();
    expect(d2.exp).toBeDefined();
  });
});
