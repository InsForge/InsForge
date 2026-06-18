import { DatabaseManager } from '../../infra/database/database.manager';
import bcrypt from 'bcryptjs';

/**
 * Fixed bcrypt hash used for timing-attack protection during credential verification.
 * When a username doesn't exist in the database, we still perform a bcrypt comparison
 * against this fixed hash. This ensures that the response time is consistent whether
 * the username exists or not, preventing an attacker from enumerating valid admin
 * usernames via response timing differences.
 *
 * This is a constant because:
 * - We only need a comparison, not actual password verification
 * - A pre-computed hash is faster than generating one on each request
 * - The specific hash value doesn't matter - only that bcrypt takes ~same time
 */
const DUMMY_HASH = '$2b$10$yB2g7h1EscFY9Y37H64SzOCEjYu1GkfAiwkViVv.3lRn8jkIol9B6';

export interface ProjectAdmin {
  id: string;
  username: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  last_login_at?: Date;
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
    if (!this.dbManager.getPool()) {
      await this.dbManager.initialize();
    }
    return this.dbManager.getPool();
  }

  async createAdmin(username: string, password: string, createdBy?: string): Promise<ProjectAdmin> {
    const passwordHash = await bcrypt.hash(password, 10);
    const pool = await this.getPool();

    const result = await pool.query(
      `INSERT INTO auth.project_admins (username, password_hash, created_by)
       VALUES ($1, $2, $3)
       RETURNING id, username, created_at, updated_at, created_by`,
      [username, passwordHash, createdBy]
    );

    return result.rows[0];
  }

  async verifyCredentials(username: string, password: string): Promise<ProjectAdmin | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, password_hash, created_at, updated_at, created_by
       FROM auth.project_admins
       WHERE username = $1 AND deleted_at IS NULL`,
      [username]
    );

    if (result.rows.length === 0) {
      // Timing-attack protection: perform a dummy bcrypt comparison
      // even when the user doesn't exist. This prevents attackers from
      // distinguishing "user not found" from "wrong password" by response time.
      await bcrypt.compare(password, DUMMY_HASH);
      return null;
    }

    const admin = result.rows[0];
    const isValid = await bcrypt.compare(password, admin.password_hash);

    if (isValid) {
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
      `SELECT id, username, created_at, updated_at, created_by, last_login_at
       FROM auth.project_admins
       WHERE id = $1 AND deleted_at IS NULL`,
      [id]
    );
    return result.rows[0] || null;
  }

  async getAdminByUsername(username: string): Promise<ProjectAdmin | null> {
    const pool = await this.getPool();
    const result = await pool.query(
      `SELECT id, username, created_at, updated_at, created_by, last_login_at
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
      `SELECT id, username, created_at, updated_at, created_by, last_login_at
       FROM auth.project_admins
       WHERE deleted_at IS NULL
       ORDER BY created_at ASC`
    );
    return result.rows;
  }

  async deleteAdmin(adminId: string, currentAdminId: string): Promise<boolean> {
    if (adminId === currentAdminId) {
      return false;
    }

    const pool = await this.getPool();
    const result = await pool.query(
      `UPDATE auth.project_admins
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL AND id != $2
       RETURNING id`,
      [adminId]
    );

    return result.rows.length > 0;
  }
}

export const adminService = AdminService.getInstance();
