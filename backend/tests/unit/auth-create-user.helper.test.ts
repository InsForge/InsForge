import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Request } from 'express';
import { roleSchema } from '@insforge/shared-schemas';
import { isAdminCreatingUser } from '../../src/api/routes/auth/create-user.helper.js';

const { mockVerifyToken } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
}));

vi.mock('../../src/infra/security/token.manager.js', () => ({
  TokenManager: {
    getInstance: () => ({
      verifyToken: mockVerifyToken,
    }),
  },
}));

describe('create-user.helper', () => {
  beforeEach(() => {
    mockVerifyToken.mockReset();
  });

  describe('isAdminCreatingUser', () => {
    it('returns true when Authorization Bearer token has role project_admin', () => {
      mockVerifyToken.mockReturnValue({ role: roleSchema.enum.project_admin });
      const req = {
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.xxx' },
      } as Partial<Request>;

      expect(isAdminCreatingUser(req as Request)).toBe(true);
      expect(mockVerifyToken).toHaveBeenCalledOnce();
    });

    it('returns false when no Authorization header', () => {
      const req = { headers: {} } as Partial<Request>;

      expect(isAdminCreatingUser(req as Request)).toBe(false);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('returns false when Authorization is not Bearer', () => {
      const req = {
        headers: { authorization: 'Basic xxx' },
      } as Partial<Request>;

      expect(isAdminCreatingUser(req as Request)).toBe(false);
      expect(mockVerifyToken).not.toHaveBeenCalled();
    });

    it('returns false when verifyToken throws', () => {
      mockVerifyToken.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const req = {
        headers: { authorization: 'Bearer bad-token' },
      } as Partial<Request>;

      expect(isAdminCreatingUser(req as Request)).toBe(false);
    });

    it('returns false when token payload role is not project_admin', () => {
      mockVerifyToken.mockReturnValue({ role: roleSchema.enum.authenticated });
      const req = {
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.xxx' },
      } as Partial<Request>;

      expect(isAdminCreatingUser(req as Request)).toBe(false);
    });

    it('returns false when token payload has no role', () => {
      mockVerifyToken.mockReturnValue({ sub: 'user-id' });
      const req = {
        headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.xxx' },
      } as Partial<Request>;

      expect(isAdminCreatingUser(req as Request)).toBe(false);
    });
  });
});
