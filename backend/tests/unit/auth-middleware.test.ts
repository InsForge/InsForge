import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AppError } from '../../src/api/middlewares/error';

const mockVerifyToken = vi.fn();
const mockGetUserById = vi.fn();

vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: mockVerifyToken,
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => ({}),
  },
}));

vi.mock('../../src/services/auth/auth.service', () => ({
  AuthService: {
    getInstance: () => ({
      getUserById: mockGetUserById,
    }),
  },
}));

describe('verifyAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects tokens for users who are no longer admins in the database', async () => {
    const { verifyAdmin } = await import('../../src/api/middlewares/auth');
    const next = vi.fn();

    mockVerifyToken.mockReturnValue({
      sub: '8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67',
      email: 'member@example.com',
      role: 'project_admin',
    });
    mockGetUserById.mockResolvedValue({
      id: '8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67',
      email: 'member@example.com',
      is_project_admin: false,
    });

    await verifyAdmin(
      {
        headers: { authorization: 'Bearer stale-admin-token' },
      } as never,
      {} as never,
      next
    );

    expect(mockGetUserById).toHaveBeenCalledWith('8b0a99a2-2787-4e2a-9ef9-19e0d7ce7f67');
    expect(next).toHaveBeenCalledWith(expect.any(AppError));
  });
});
