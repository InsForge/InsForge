import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response, NextFunction } from 'express';
import { verifyAdmin, verifyToken, requireRoot, AuthRequest } from '../../src/api/middlewares/auth';
import { TokenManager } from '../../src/infra/security/token.manager';
import { adminService } from '../../src/services/admin/admin.service';

vi.mock('../../src/infra/security/token.manager', () => {
  const tokenManagerMock = {
    verifyToken: vi.fn(),
  };
  return {
    TokenManager: {
      getInstance: () => tokenManagerMock,
    },
  };
});

vi.mock('../../src/services/admin/admin.service', () => {
  return {
    adminService: {
      getAdminByUsername: vi.fn(),
    },
  };
});

vi.mock('../../src/services/secrets/secret.service', () => {
  return {
    SecretService: {
      getInstance: () => ({}),
    },
  };
});

describe('Auth Middlewares (verifyAdmin, verifyToken, requireRoot)', () => {
  const tokenManager = TokenManager.getInstance();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyAdmin', () => {
    it('queries database and verifies admin even when isRoot and adminId are present in the JWT payload', async () => {
      const req = {
        headers: {
          authorization: 'Bearer valid-modern-token',
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      vi.mocked(tokenManager.verifyToken).mockReturnValue({
        sub: 'local:operator1',
        role: 'project_admin',
        isRoot: false,
        adminId: 'operator-uuid',
      });

      vi.mocked(adminService.getAdminByUsername).mockResolvedValue({
        id: 'operator-uuid-db',
        username: 'operator1',
        is_root: false,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await verifyAdmin(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        id: 'operator-uuid-db',
        email: undefined,
        role: 'project_admin',
        username: 'operator1',
        isRoot: false,
      });
      expect(adminService.getAdminByUsername).toHaveBeenCalledWith('operator1');
    });

    it('rejects access (calls next with error) if the admin account is missing or soft-deleted', async () => {
      const req = {
        headers: {
          authorization: 'Bearer valid-modern-token',
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      vi.mocked(tokenManager.verifyToken).mockReturnValue({
        sub: 'local:operator1',
        role: 'project_admin',
        isRoot: false,
        adminId: 'operator-uuid',
      });

      vi.mocked(adminService.getAdminByUsername).mockResolvedValue(null);

      await verifyAdmin(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(req.user).toBeUndefined();
      expect(adminService.getAdminByUsername).toHaveBeenCalledWith('operator1');
    });

    it('falls back to database query when isRoot or adminId is missing in the JWT payload', async () => {
      const req = {
        headers: {
          authorization: 'Bearer valid-legacy-token',
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      vi.mocked(tokenManager.verifyToken).mockReturnValue({
        sub: 'local:operator1',
        role: 'project_admin',
      });

      vi.mocked(adminService.getAdminByUsername).mockResolvedValue({
        id: 'operator-uuid-db',
        username: 'operator1',
        is_root: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await verifyAdmin(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        id: 'operator-uuid-db',
        email: undefined,
        role: 'project_admin',
        username: 'operator1',
        isRoot: true,
      });
      expect(adminService.getAdminByUsername).toHaveBeenCalledWith('operator1');
    });
  });

  describe('verifyToken', () => {
    it('extracts username, queries DB, and maps database ID for project_admin role', async () => {
      const req = {
        headers: {
          authorization: 'Bearer valid-admin-token',
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      vi.mocked(tokenManager.verifyToken).mockReturnValue({
        sub: 'local:admin1',
        role: 'project_admin',
        isRoot: true,
        adminId: 'admin-uuid',
      });

      vi.mocked(adminService.getAdminByUsername).mockResolvedValue({
        id: 'admin-uuid-db',
        username: 'admin1',
        is_root: true,
        created_at: new Date(),
        updated_at: new Date(),
      });

      await verifyToken(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        id: 'admin-uuid-db',
        email: undefined,
        role: 'project_admin',
        username: 'admin1',
        isRoot: true,
      });
      expect(adminService.getAdminByUsername).toHaveBeenCalledWith('admin1');
    });

    it('rejects access if the admin is missing or soft-deleted', async () => {
      const req = {
        headers: {
          authorization: 'Bearer valid-admin-token',
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      vi.mocked(tokenManager.verifyToken).mockReturnValue({
        sub: 'local:admin1',
        role: 'project_admin',
        isRoot: true,
        adminId: 'admin-uuid',
      });

      vi.mocked(adminService.getAdminByUsername).mockResolvedValue(null);

      await verifyToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(req.user).toBeUndefined();
      expect(adminService.getAdminByUsername).toHaveBeenCalledWith('admin1');
    });

    it('passes standard user payload without custom project_admin mapping', async () => {
      const req = {
        headers: {
          authorization: 'Bearer valid-user-token',
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      vi.mocked(tokenManager.verifyToken).mockReturnValue({
        sub: 'user-uuid',
        email: 'user@test.com',
        role: 'authenticated',
      });

      await verifyToken(req, res, next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toEqual({
        id: 'user-uuid',
        email: 'user@test.com',
        role: 'authenticated',
        username: undefined,
        isRoot: undefined,
      });
    });
  });

  describe('requireRoot', () => {
    it('allows access to root admin', () => {
      const req = {
        user: {
          id: 'admin-uuid',
          role: 'project_admin',
          isRoot: true,
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      requireRoot(req, res, next);
      expect(next).toHaveBeenCalledWith();
    });

    it('denies access to non-root admin', () => {
      const req = {
        user: {
          id: 'operator-uuid',
          role: 'project_admin',
          isRoot: false,
        },
      } as unknown as AuthRequest;
      const res = {} as Response;
      const next = vi.fn() as NextFunction;

      requireRoot(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
