import { beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';

const queryMock = vi.fn();
const poolMock = {
  query: queryMock,
  connect: vi.fn().mockResolvedValue({
    query: queryMock,
    release: vi.fn(),
  }),
};

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => poolMock,
      initialize: vi.fn(),
    }),
  },
}));

const generateAccessTokenMock = vi.fn().mockReturnValue('mock-access-token');
vi.mock('../../src/infra/security/token.manager', () => ({
  TokenManager: {
    getInstance: () => ({
      generateAccessToken: generateAccessTokenMock,
    }),
  },
}));

vi.mock('../../src/infra/config/app.config', () => ({
  appConfig: {
    auth: {
      rootAdminUsername: 'admin',
      rootAdminPassword: 'change-this-password',
    },
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

import { AuthService } from '../../src/services/auth/auth.service';

describe('AuthService - Database-Backed Admin Management', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance if necessary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AuthService as any).instance = undefined;
    authService = AuthService.getInstance();
  });

  describe('adminLogin', () => {
    it('successfully logs in with valid credentials', async () => {
      const passwordHash = await bcrypt.hash('valid-password', 10);
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'mock-id',
              username: 'admin',
              password_hash: passwordHash,
              created_at: new Date(),
              updated_at: new Date(),
              is_root: true,
            },
          ],
        }) // SELECT
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE last_login_at

      const response = await authService.adminLogin('admin', 'valid-password');

      expect(queryMock.mock.calls[0][0]).toContain('SELECT id, username, password_hash');
      expect(queryMock.mock.calls[0][1]).toEqual(['admin']);
      expect(queryMock.mock.calls[1][0]).toContain('UPDATE auth.project_admins SET last_login_at');
      expect(queryMock.mock.calls[1][1]).toEqual(['mock-id']);

      expect(response.accessToken).toBe('mock-access-token');
      expect(response.admin.username).toBe('admin');
      expect(response.admin.isRoot).toBe(true);
    });

    it('rejects login for non-existent admin user', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await expect(authService.adminLogin('unknown', 'any-password')).rejects.toThrow(
        'Invalid admin credentials'
      );
    });

    it('rejects login for invalid password', async () => {
      const passwordHash = await bcrypt.hash('valid-password', 10);
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            id: 'mock-id',
            username: 'admin',
            password_hash: passwordHash,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      await expect(authService.adminLogin('admin', 'wrong-password')).rejects.toThrow(
        'Invalid admin credentials'
      );
    });
  });

  describe('listAdmins', () => {
    it('returns a list of admins ordered by username', async () => {
      const created1 = new Date('2026-06-08T00:00:00Z');
      const updated1 = new Date('2026-06-08T00:00:00Z');
      const created2 = new Date('2026-06-08T01:00:00Z');
      const updated2 = new Date('2026-06-08T01:00:00Z');

      const dbAdmins = [
        { username: 'admin', created_at: created1, updated_at: updated1 },
        { username: 'operator1', created_at: created2, updated_at: updated2 },
      ];
      queryMock.mockResolvedValueOnce({ rows: dbAdmins });

      const result = await authService.listAdmins();

      expect(queryMock.mock.calls[0][0]).toContain('FROM auth.project_admins');
      expect(result).toEqual([
        { username: 'admin', createdAt: created1.toISOString(), updatedAt: updated1.toISOString() },
        {
          username: 'operator1',
          createdAt: created2.toISOString(),
          updatedAt: updated2.toISOString(),
        },
      ]);
    });
  });

  describe('createAdmin', () => {
    it('creates a new admin user successfully', async () => {
      const created = new Date('2026-06-08T02:00:00Z');
      const updated = new Date('2026-06-08T02:00:00Z');

      const newAdmin = {
        username: 'operator1',
        created_at: created,
        updated_at: updated,
      };
      queryMock
        .mockResolvedValueOnce({ rows: [] }) // getAdminByUsername (existing check)
        .mockResolvedValueOnce({ rows: [newAdmin] }); // createAdmin insert

      const result = await authService.createAdmin('operator1', 'initial-password');

      expect(queryMock.mock.calls[0][0]).toContain('SELECT id, username');
      expect(queryMock.mock.calls[0][1]).toEqual(['operator1']);

      const [sql, params] = queryMock.mock.calls[1];
      expect(sql).toContain('INSERT INTO auth.project_admins');
      expect(params[0]).toBe('operator1');
      // Validate that password was hashed
      const isPasswordHashed = await bcrypt.compare('initial-password', params[1]);
      expect(isPasswordHashed).toBe(true);

      expect(result).toEqual({
        username: 'operator1',
        createdAt: created.toISOString(),
        updatedAt: updated.toISOString(),
      });
    });

    it('throws error when creating an admin that already exists', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          { id: 'mock-id', username: 'admin', created_at: new Date(), updated_at: new Date() },
        ],
      });

      await expect(authService.createAdmin('admin', 'password')).rejects.toThrow(
        'Admin user already exists'
      );
    });
  });

  describe('deleteAdmin', () => {
    it('deletes an admin successfully', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [{ id: 'operator1-id', username: 'operator1', is_root: false }],
        }) // getAdminByUsername (check existing & root)
        .mockResolvedValueOnce({ rowCount: 1 }); // DELETE query

      await authService.deleteAdmin('operator1');

      expect(queryMock.mock.calls[0][0]).toContain('SELECT id, username');
      expect(queryMock.mock.calls[0][1]).toEqual(['operator1']);

      expect(queryMock.mock.calls[1][0]).toContain(
        'DELETE FROM auth.project_admins WHERE username = $1 AND is_root = false'
      );
      expect(queryMock.mock.calls[1][1]).toEqual(['operator1']);
    });

    it('throws error when deleting a non-existent admin', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] }); // getAdminByUsername

      await expect(authService.deleteAdmin('non-existent')).rejects.toThrow('Admin user not found');
    });
  });

  describe('changeAdminPassword', () => {
    it('updates password successfully with valid old password', async () => {
      const oldPasswordHash = await bcrypt.hash('old-password', 10);
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 'admin-id', username: 'admin' }] }) // getAdminByUsername
        .mockResolvedValueOnce({ rows: [{ password_hash: oldPasswordHash }] }) // SELECT password_hash (changePassword)
        .mockResolvedValueOnce({ rowCount: 1 }); // UPDATE

      await authService.changeAdminPassword('admin', 'old-password', 'new-password');

      expect(queryMock).toHaveBeenCalledTimes(3);
      expect(queryMock.mock.calls[0][0]).toContain('SELECT id, username');
      expect(queryMock.mock.calls[1][0]).toContain(
        'SELECT password_hash FROM auth.project_admins WHERE id = $1 AND deleted_at IS NULL'
      );
      expect(queryMock.mock.calls[2][0]).toContain('UPDATE auth.project_admins SET password_hash');

      const newHash = queryMock.mock.calls[2][1][0];
      const isNewPasswordHashed = await bcrypt.compare('new-password', newHash);
      expect(isNewPasswordHashed).toBe(true);
    });

    it('throws error if old password does not match', async () => {
      const oldPasswordHash = await bcrypt.hash('old-password', 10);
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: 'admin-id', username: 'admin' }] }) // getAdminByUsername
        .mockResolvedValueOnce({ rows: [{ password_hash: oldPasswordHash }] }); // SELECT password_hash

      await expect(
        authService.changeAdminPassword('admin', 'wrong-old-password', 'new-password')
      ).rejects.toThrow('Invalid old password');
    });
  });
});
