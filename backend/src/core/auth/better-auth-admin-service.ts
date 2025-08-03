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
   * Registers admin user in database
   */
  public async registerAdmin(credentials: AdminCredentials & { name?: string }): Promise<{
    token: string;
    user: { id: string; email: string; name: string; role: string };
  }> {
    const { email, password, name = 'Administrator' } = credentials;

    // Validate credentials match environment
    this.validateAdminCredentials(email, password);

    const db = this.getDb();

    // Check if already exists
    const existingUser = (await db
      .prepare('SELECT id, email, name FROM "user" WHERE email = ? LIMIT 1')
      .get(email)) as UserRecord | null;

    if (existingUser) {
      throw new APIError('CONFLICT', {
        message: 'Admin user already exists',
      });
    }

    // Create admin user using raw SQL since we're in the auth service
    const userId = `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    await db
      .prepare('INSERT INTO "user" (id, email, name, "emailVerified") VALUES (?, ?, ?, ?)')
      .run(userId, email, name, true);

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
   * Signs in admin user
   */
  public async signInAdmin(credentials: AdminCredentials): Promise<{
    token: string;
    user: { id: string; email: string; name: string; role: string };
  }> {
    const { email, password } = credentials;

    // Validate credentials
    this.validateAdminCredentials(email, password);

    const db = this.getDb();

    // Try to find admin in DB (may not exist for virtual admin)
    const user = (await db
      .prepare('SELECT id, email, name FROM "user" WHERE email = ? LIMIT 1')
      .get(email)) as UserRecord | null;

    // Generate JWT for either DB user or virtual admin
    const userId = user?.id || `admin-${Date.now()}`;
    const token = this.generateAdminJWT(userId, this.adminEmail);

    return {
      token,
      user: {
        id: user?.id || 'admin',
        email: this.adminEmail,
        name: user?.name || 'Administrator',
        role: 'project_admin',
      },
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
        'SELECT id, email, name, "emailVerified", "createdAt" FROM "user" ORDER BY "createdAt" DESC LIMIT ? OFFSET ?'
      )
      .all(limit, offset)) as UserRecord[];

    // Filter out admin users
    const regularUsers = users.filter(
      (user) => user.email.toLowerCase() !== this.adminEmail.toLowerCase()
    );

    return {
      users: regularUsers.map((user) => ({
        id: user.id,
        email: user.email,
        name: user.name || null,
        emailVerified: user.emailVerified || false,
        createdAt: user.createdAt,
      })),
      total: regularUsers.length,
    };
  }

  /**
   * Checks if Better Auth is enabled
   */
  public static isEnabled(): boolean {
    return process.env.ENABLE_BETTER_AUTH === 'true';
  }
}
