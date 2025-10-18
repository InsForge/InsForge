import { verifyCloudToken } from '../../src/utils/cloud-token';
import { jwtVerify } from 'jose';
import { AppError } from '../../src/api/middleware/error';

// Mock jose.jwtVerify
jest.mock('jose', () => ({
  jwtVerify: jest.fn(),
  createRemoteJWKSet: jest.fn(() => 'mockedJwks'),
}));

describe('verifyCloudToken', () => {
  const oldEnv = process.env;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...oldEnv, PROJECT_ID: 'project_123', CLOUD_API_HOST: 'https://mock-api.dev' };
  });

  afterAll(() => {
    process.env = oldEnv;
  });

  test('returns payload and projectId if valid', async () => {
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: { projectId: 'project_123', user: 'testUser' },
    });

    const result = await verifyCloudToken('valid-token');
    expect(result.projectId).toBe('project_123');
    expect(result.payload.user).toBe('testUser');
  });

  test('throws AppError if project ID mismatch or missing', async () => {
    (jwtVerify as jest.Mock).mockResolvedValue({
      payload: {}, // missing projectId also counts as mismatch
    });

    await expect(verifyCloudToken('token')).rejects.toThrow(AppError);
  });
});
