import { AuthService } from '@/core/auth/auth.js';
import { DatabaseManager } from '@/core/database/database.js';
import logger from '@/utils/logger.js';
import { BetterAuthAdminService } from '@/core/auth/better-auth-admin-service.js';

/**
 * Ensures the first admin exists in Better Auth
 * Creates admin user if not exists, skips if already exists
 */
async function ensureFirstAdmin(adminEmail: string, adminPassword: string): Promise<void> {
  const betterAuthService = BetterAuthAdminService.getInstance();

  try {
    // Try to register the admin - this will check if user exists
    const result = await betterAuthService.registerAdmin({
      email: adminEmail,
      password: adminPassword,
      name: 'Administrator',
    });

    if (result?.token) {
      logger.info(`✅ First admin created: ${adminEmail}`);
    }
  } catch (error) {
    // Check if it's just an "already exists" error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code;

    if (errorCode === 'CONFLICT' || errorMessage.includes('already exists')) {
      logger.info(`✅ Admin already exists: ${adminEmail}`);
    } else {
      // Non-critical error - admin can be created manually if needed
      console.warn('Could not verify/create admin user:', errorMessage);
    }
  }
}

export async function seedAdmin(): Promise<void> {
  const authService = AuthService.getInstance();
  const dbManager = DatabaseManager.getInstance();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-password';

  try {
    logger.info(`\n🚀 Insforge Backend Starting...`);

    // Handle auth based on Better Auth flag
    if (process.env.ENABLE_BETTER_AUTH === 'true') {
      await ensureFirstAdmin(adminEmail, adminPassword);
    } else {
      // Legacy auth flow
      const superUser = await authService.getSuperUserByEmail(adminEmail);
      if (!superUser) {
        await authService.createSuperUser(adminEmail, adminPassword, 'Admin');
        logger.info(`✅ Admin account created: ${adminEmail}`);
      } else {
        logger.info(`✅ Admin account exists: ${adminEmail}`);
      }
    }

    // Initialize API key
    const apiKey = await authService.initializeApiKey();

    // Get database stats
    const tableCount = await dbManager.getUserTableCount();

    logger.info(`✅ Database connected to PostgreSQL`, {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || '5432',
      database: process.env.POSTGRES_DB || 'insforge',
    });
    // Database connection info is already logged above

    if (tableCount > 0) {
      logger.info(`✅ Found ${tableCount} user tables`);
    }
    logger.info(`API key generated: ${apiKey}`);
    logger.info(`Setup complete:
      - Save this API key for your apps!
      - Dashboard: http://localhost:7131
      - API: http://localhost:7130/api
    `);
  } catch (error) {
    logger.error('Error during setup', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
