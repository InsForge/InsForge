/* eslint-disable no-console */
import { AuthService } from '@/core/auth/auth.js';
import { DatabaseManager } from '@/core/database/database.js';
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
      console.log(`✅ First admin created: ${adminEmail}`);
    }
  } catch (error) {
    // Check if it's just an "already exists" error
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as { code?: string })?.code;

    if (errorCode === 'CONFLICT' || errorMessage.includes('already exists')) {
      console.log(`✅ Admin already exists: ${adminEmail}`);
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
    console.log(`\n🚀 Insforge Backend Starting...`);

    // Handle auth based on Better Auth flag
    if (process.env.ENABLE_BETTER_AUTH === 'true') {
      await ensureFirstAdmin(adminEmail, adminPassword);
    } else {
      // Legacy auth flow
      const superUser = await authService.getSuperUserByEmail(adminEmail);
      if (!superUser) {
        await authService.createSuperUser(adminEmail, adminPassword, 'Admin');
        console.log(`✅ Admin account created: ${adminEmail}`);
      } else {
        console.log(`✅ Admin account exists: ${adminEmail}`);
      }
    }

    // Initialize API key
    const apiKey = await authService.initializeApiKey();

    // Get database stats
    const tableCount = await dbManager.getUserTableCount();

    // Database connection info
    const dbHost = process.env.POSTGRES_HOST || 'localhost';
    const dbPort = process.env.POSTGRES_PORT || '5432';
    const dbName = process.env.POSTGRES_DB || 'insforge';
    console.log(`✅ Database connected to PostgreSQL: ${dbHost}:${dbPort}/${dbName}`);

    if (tableCount > 0) {
      console.log(`✅ Found ${tableCount} user tables`);
    }

    console.log(`\n🔑 YOUR API KEY: ${apiKey}`);
    console.log(`\n💡 Save this API key for your apps!`);

    // Display URLs using configured base URLs
    const apiBaseUrl =
      process.env.VITE_API_BASE_URL || `http://localhost:${process.env.PORT || 7130}`;
    const dashboardPort = process.env.DASHBOARD_PORT || 7131;

    console.log(`🎨 Self hosting Dashboard: http://localhost:${dashboardPort}`);
    console.log(`📡 Backend API: ${apiBaseUrl}/api`);
  } catch (error) {
    console.error('Error during setup:', error);
  }
}
