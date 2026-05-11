import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool, mockClient } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AuthConfigService } from '../../src/services/auth/auth-config.service';

describe('AuthConfigService – disableSignup', () => {
  let service: AuthConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthConfigService as any).instance = undefined;
    service = AuthConfigService.getInstance();
  });

  describe('getPublicAuthConfig', () => {
    it('returns disableSignup=true when DB has it set', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            requireEmailVerification: false,
            passwordMinLength: 6,
            requireNumber: false,
            requireLowercase: false,
            requireUppercase: false,
            requireSpecialChar: false,
            verifyEmailMethod: 'code',
            resetPasswordMethod: 'code',
            disableSignup: true,
          },
        ],
      });

      const config = await service.getPublicAuthConfig();
      expect(config.disableSignup).toBe(true);
    });

    it('returns disableSignup=false when DB has it unset', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            requireEmailVerification: false,
            passwordMinLength: 6,
            requireNumber: false,
            requireLowercase: false,
            requireUppercase: false,
            requireSpecialChar: false,
            verifyEmailMethod: 'code',
            resetPasswordMethod: 'code',
            disableSignup: false,
          },
        ],
      });

      const config = await service.getPublicAuthConfig();
      expect(config.disableSignup).toBe(false);
    });

    it('falls back to disableSignup=false when no config row exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const config = await service.getPublicAuthConfig();
      expect(config.disableSignup).toBe(false);
    });
  });

  describe('getAuthConfig', () => {
    it('returns disableSignup from DB', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'b04553ba-5572-4012-a157-3d8dce0f7938',
            requireEmailVerification: false,
            passwordMinLength: 6,
            requireNumber: false,
            requireLowercase: false,
            requireUppercase: false,
            requireSpecialChar: false,
            verifyEmailMethod: 'code',
            resetPasswordMethod: 'code',
            allowedRedirectUrls: [],
            disableSignup: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      });

      const config = await service.getAuthConfig();
      expect(config.disableSignup).toBe(true);
    });

    it('falls back to disableSignup=false when no config row exists', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const config = await service.getAuthConfig();
      expect(config.disableSignup).toBe(false);
    });
  });

  describe('updateAuthConfig', () => {
    const baseReturnRow = {
      id: 'b04553ba-5572-4012-a157-3d8dce0f7938',
      requireEmailVerification: false,
      passwordMinLength: 6,
      requireNumber: false,
      requireLowercase: false,
      requireUppercase: false,
      requireSpecialChar: false,
      verifyEmailMethod: 'code',
      resetPasswordMethod: 'code',
      allowedRedirectUrls: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('includes disable_signup in UPDATE when disableSignup is provided', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined) // BEGIN
        .mockResolvedValueOnce(undefined) // INSERT ON CONFLICT
        .mockResolvedValueOnce({ rows: [{ id: 'b04553ba-5572-4012-a157-3d8dce0f7938' }] }) // SELECT FOR UPDATE
        .mockResolvedValueOnce({ rows: [{ ...baseReturnRow, disableSignup: true }] }) // UPDATE RETURNING
        .mockResolvedValueOnce(undefined); // COMMIT

      const result = await service.updateAuthConfig({ disableSignup: true });

      const updateCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('UPDATE auth.config')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain('disable_signup');
      expect(result.disableSignup).toBe(true);
    });

    it('sets disableSignup=false correctly', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ id: 'b04553ba-5572-4012-a157-3d8dce0f7938' }] })
        .mockResolvedValueOnce({ rows: [{ ...baseReturnRow, disableSignup: false }] })
        .mockResolvedValueOnce(undefined);

      const result = await service.updateAuthConfig({ disableSignup: false });

      const updateCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('UPDATE auth.config')
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![0]).toContain('disable_signup');
      expect(result.disableSignup).toBe(false);
    });

    it('does not include disable_signup in SET clause when disableSignup is omitted', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ id: 'b04553ba-5572-4012-a157-3d8dce0f7938' }] })
        .mockResolvedValueOnce({
          rows: [{ ...baseReturnRow, disableSignup: false }],
        })
        .mockResolvedValueOnce(undefined);

      await service.updateAuthConfig({ requireEmailVerification: true });

      const updateCall = mockClient.query.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('UPDATE auth.config')
      );
      expect(updateCall).toBeDefined();
      // RETURNING clause always lists all columns; only check the SET portion
      const setClause = updateCall![0].split('RETURNING')[0];
      expect(setClause).not.toContain('disable_signup');
    });
  });
});
