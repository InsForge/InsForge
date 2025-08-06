import jwt from 'jsonwebtoken';
import { APIError } from 'better-call';
import { DatabaseManager } from '@/core/database/database.js';

export interface AdminJwtPayload extends jwt.JwtPayload {
  role?: string;
  email?: string;
  sub?: string;
  iss?: string;
  type?: string;
}

export interface UserRecord {
  id: string;
  email: string;
  name?: string | null;
  emailVerified?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AdminCredentials {
  email: string;
  password: string;
}

export class BetterAuthAdminService {
  private static instance: BetterAuthAdminService;
  private readonly jwtSecret: string;
  private readonly adminEmail: string;
  private readonly adminPassword: string;

  private constructor() {
    this.jwtSecret = process.env.JWT_SECRET || '';
    this.adminEmail = process.env.ADMIN_EMAIL || '';
    this.adminPassword = process.env.ADMIN_PASSWORD || '';

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  public static getInstance(): BetterAuthAdminService {
    if (!BetterAuthAdminService.instance) {
      BetterAuthAdminService.instance = new BetterAuthAdminService();
    }
    return BetterAuthAdminService.instance;
  }

  private getDb() {
    const dbManager = DatabaseManager.getInstance();
    return dbManager.getDb();
  }

  /**
   * Validates admin credentials against environment variables
   */
  public validateAdminCredentials(email: string, password: string): void {
    if (!this.adminEmail || !this.adminPassword) {
      throw new APIError('INTERNAL_SERVER_ERROR', {
        message: 'Admin credentials not configured',
      });
    }

    if (email.toLowerCase() !== this.adminEmail.toLowerCase()) {
      throw new APIError('FORBIDDEN', {
        message: 'Not authorized as admin',
      });
    }

    if (password !== this.adminPassword) {
      throw new APIError('UNAUTHORIZED', {
        message: 'Invalid credentials',
      });
    }
  }

  /**
   * Generates admin JWT token
   */
  public generateAdminJWT(userId: string, email: string): string {
    return jwt.sign(
      {
        sub: userId,
        email,
        type: 'admin',
        role: 'project_admin',
        iss: 'self-hosted',
      },
      this.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  /**
   * Verifies JWT token and returns payload
   */
  public async verifyToken(token: string): Promise<AdminJwtPayload> {
    return new Promise((resolve, reject) => {
      jwt.verify(token, this.jwtSecret, (err, decoded) => {
        if (err) {
          reject(new APIError('UNAUTHORIZED', { message: 'Invalid token' }));
        } else {
          resolve(decoded as AdminJwtPayload);
        }
      });
    });
  }

  /**
   * Verifies admin JWT token
   */
  public async verifyAdminToken(token: string): Promise<AdminJwtPayload> {
    const decoded = await this.verifyToken(token);

    if (decoded.role !== 'project_admin') {
      throw new APIError('FORBIDDEN', {
        message: 'Requires project admin role',
      });
    }

    return decoded;
  }

  /**
   * Registers admin user (validates environment credentials only, no DB storage)
   */
  public registerAdmin(credentials: AdminCredentials & { name?: string }): {
    token: string;
    user: { id: string; email: string; name: string; role: string };
  } {
    const { email, password, name = 'Administrator' } = credentials;

    // Validate credentials match environment
    this.validateAdminCredentials(email, password);

    // Generate a consistent admin ID (no DB storage needed)
    const userId = 'admin';
    const token = this.generateAdminJWT(userId, email);

    return {
      token,
      user: {
        id: userId,
        email,
        name,
        role: 'project_admin',
      },
    };
  }

  /**
   * Signs in admin user (validates against environment variables only)
   */
  public signInAdmin(credentials: AdminCredentials): {
    token: string;
    user: { id: string; email: string; name: string; role: string };
  } {
    const { email, password } = credentials;

    // Validate credentials against environment variables
    this.validateAdminCredentials(email, password);

    // Generate JWT for admin (no DB lookup needed)
    const userId = 'admin';
    const token = this.generateAdminJWT(userId, this.adminEmail);

    return {
      token,
      user: {
        id: userId,
        email: this.adminEmail,
        name: 'Administrator',
        role: 'project_admin',
      },
    };
  }

  /**
   * Get a single user by ID
   */
  public async getUser(userId: string): Promise<UserRecord> {
    if (!userId) {
      throw new APIError('BAD_REQUEST', {
        message: 'User ID is required',
      });
    }

    const db = this.getDb();

    const user = (await db
      .prepare(
        'SELECT id, email, name, "emailVerified", "createdAt", "updatedAt" FROM _user WHERE id = ? LIMIT 1'
      )
      .get(userId)) as UserRecord | null;

    if (!user) {
      throw new APIError('NOT_FOUND', {
        message: 'User not found',
      });
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name || null,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /**
   * Lists all users (excluding admin)
   */
  public async listUsers(
    limit = 10,
    offset = 0
  ): Promise<{
    users: UserRecord[];
    total: number;
  }> {
    const db = this.getDb();

    // Get all users
    const users = (await db
      .prepare(
        'SELECT id, email, name, "emailVerified", "createdAt", "updatedAt" FROM _user ORDER BY "createdAt" DESC LIMIT ? OFFSET ?'
      )
      .all(limit, offset)) as UserRecord[];

    // Filter out admin users
    const regularUsers = users.filter(
      (user) => user.email.toLowerCase() !== this.adminEmail.toLowerCase()
    );

    // Query account table to get OAuth provider info for each user
    const userIds = regularUsers.map((user) => user.id);
    const accounts: Array<{ userId: string; providerId: string }> =
      userIds.length > 0
        ? ((await db
            .prepare(
              `SELECT "userId", "providerId" FROM _account WHERE "userId" IN (${userIds
                .map(() => '?')
                .join(', ')})`
            )
            .all(...userIds)) as Array<{ userId: string; providerId: string }>)
        : [];

    // Create a map of userId to their OAuth providers
    const userProviders = new Map<string, string[]>();
    accounts.forEach((account) => {
      if (!userProviders.has(account.userId)) {
        userProviders.set(account.userId, []);
      }
      userProviders.get(account.userId)?.push(account.providerId);
    });

    return {
      users: regularUsers.map((user) => {
        const providers = userProviders.get(user.id) || [];
        // Filter out 'credential' provider as it's not OAuth
        const oauthProviders = providers.filter((p) => p !== 'credential');
        const hasOAuth = oauthProviders.length > 0;

        return {
          id: user.id,
          email: user.email,
          name: user.name || null,
          identities: oauthProviders.map((p) => ({ provider: p })),
          provider_type: hasOAuth ? 'Social' : 'Email',
          created_at: user.createdAt,
          updated_at: user.updatedAt,
        };
      }),
      total: regularUsers.length,
    };
  }

  /**
   * Bulk delete users
   */
  public async bulkDeleteUsers(userIds: string[]): Promise<{ deletedCount: number }> {
    if (!userIds || userIds.length === 0) {
      throw new APIError('BAD_REQUEST', {
        message: 'No user IDs provided',
      });
    }

    const db = this.getDb();

    // Filter out admin user to prevent self-deletion
    const adminUser = (await db
      .prepare('SELECT id FROM _user WHERE email = ? LIMIT 1')
      .get(this.adminEmail)) as UserRecord | null;

    const idsToDelete = userIds.filter((id) => !adminUser || id !== adminUser.id);

    if (idsToDelete.length === 0) {
      return { deletedCount: 0 };
    }

    // Create placeholders for the IN clause
    const placeholders = idsToDelete.map(() => '?').join(',');

    // Delete users and their sessions
    await db.prepare('BEGIN TRANSACTION').run();
    try {
      // Delete sessions first (foreign key constraint)
      await db
        .prepare(`DELETE FROM _session WHERE "userId" IN (${placeholders})`)
        .run(...idsToDelete);

      // Delete users
      const result = await db
        .prepare(`DELETE FROM _user WHERE id IN (${placeholders})`)
        .run(...idsToDelete);

      await db.prepare('COMMIT').run();

      return { deletedCount: result.changes || 0 };
    } catch {
      await db.prepare('ROLLBACK').run();
      throw new APIError('INTERNAL_SERVER_ERROR', {
        message: 'Failed to delete users',
      });
    }
  }
}
