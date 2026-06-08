import { DatabaseManager } from '../../infra/database/database.manager';
import bcrypt from 'bcryptjs';

export interface ProjectAdmin {
  id: string;
  username: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  last_login_at?: Date;
  is_root?: boolean;
  deleted_at?: Date;
}

export class AdminService {
  private static instance: AdminService;
  private dbManager: DatabaseManager;

  private constructor() {
    this.dbManager = DatabaseManager.getInstance();
  }

  static getInstance(): AdminService {
    if (!AdminService.instance) {
      AdminService.instance = new AdminService();
    }
    return AdminService.instance;
  }

  private async getPool() {
    // Ensure database is initialized
    if (!this.dbManager.getPool()) {
      await this.dbManager.initialize();
    }
    return this.dbManager.getPool();
  }

  async createAdmin(
    username: string,
    password: string,
    createdBy?: string,
    isRoot: boolean = false
  ): Promise<ProjectAdmin> {
    const passwordHash = await bcrypt.hash(password, 10);
    const pool = await this.getPool();

    const result = await pool.query(
      `INSERT INTO auth.project_admins (username, password_hash, created_by, is_root)
             VALUES ($1, $2, $3, $4)
             RETURNING id, username, created_at, updated_at, created_by, is_root`,
      [username, passwordHash, createdBy, isRoot]
    );

    return result.rows[0];
  }

  async verifyCredentials(username: string, password: string): Promise<ProjectAdmin | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, password_hash, created_at, updated_at, created_by, is_root
             FROM auth.project_admins
             WHERE username = $1 AND deleted_at IS NULL`,
      [username]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const admin = result.rows[0];
    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (isValid) {
      // Update last login
      await pool.query(`UPDATE auth.project_admins SET last_login_at = NOW() WHERE id = $1`, [
        admin.id,
      ]);
      delete admin.password_hash;
      return admin;
    }

    return null;
  }

  async getAdminById(id: string): Promise<ProjectAdmin | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, created_at, updated_at, created_by, last_login_at, is_root
             FROM auth.project_admins
             WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getAdminByUsername(username: string): Promise<ProjectAdmin | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, created_at, updated_at, created_by, last_login_at, is_root
             FROM auth.project_admins
             WHERE username = $1 AND deleted_at IS NULL`,
      [username]
    );
    return result.rows[0] || null;
  }

  async changePassword(
    adminId: string,
    oldPassword: string,
    newPassword: string
  ): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT password_hash FROM auth.project_admins WHERE id = $1 AND deleted_at IS NULL`,
      [adminId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const isValid = await bcrypt.compare(oldPassword, result.rows[0].password_hash);
    if (!isValid) {
      return false;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query(
      `UPDATE auth.project_admins SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [newHash, adminId]
    );

    return true;
  }

  async listAdmins(): Promise<ProjectAdmin[]> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, created_at, updated_at, created_by, last_login_at, is_root
             FROM auth.project_admins
             WHERE deleted_at IS NULL
             ORDER BY created_at ASC`
    );
    return result.rows;
  }

  async deleteAdmin(adminId: string, currentAdminId: string, isRoot: boolean): Promise<boolean> {
    // Non-root cannot delete
    if (!isRoot) {
      return false;
    }

    // Cannot delete yourself
    if (adminId === currentAdminId) {
      return false;
    }

    // Cannot delete root admin
    const admin = await this.getAdminById(adminId);
    if (admin?.is_root) {
      return false;
    }

    const pool = await this.getPool();
    const result = await pool.query(
      `UPDATE auth.project_admins
             SET deleted_at = NOW(), updated_at = NOW()
             WHERE id = $1 AND deleted_at IS NULL
             RETURNING id`,
      [adminId]
    );

    return result.rows.length > 0;
  }

  async isRootAdmin(adminId: string): Promise<boolean> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT is_root FROM auth.project_admins WHERE id = $1 AND deleted_at IS NULL`,
      [adminId]
    );
    return result.rows[0]?.is_root === true;
  }
}

export const adminService = AdminService.getInstance();
