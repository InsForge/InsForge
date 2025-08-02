/* eslint-disable no-console */
import { AuthService } from '@/core/auth/auth.js';
import { DatabaseManager } from '@/core/database/database.js';

/**
 * Ensures exactly one admin exists in Better Auth
 * - If no admin exists, creates/promotes the specified user
 * - If admin already exists, does nothing
 */
async function ensureFirstAdmin(adminEmail: string, adminPassword: string): Promise<void> {
  const dbManager = DatabaseManager.getInstance();
  const db = dbManager.getDb();

  // Check if any admin already exists
  const existingAdmin = (await db
    .prepare('SELECT email FROM "user" WHERE role = \'dashboard_user\' LIMIT 1')
    .get()) as { email: string };

  if (existingAdmin) {
    console.log(`✅ Admin already exists: ${existingAdmin.email}`);
    return;
  }

  // No admin exists, create/promote one
  const { auth } = await import('@/lib/better-auth.js');
  // Try to create new user
  const result = await auth.api.signUpEmail({
    body: { email: adminEmail, password: adminPassword, name: 'Admin' },
  });

  if (result?.user?.id) {
    await db
      .prepare('UPDATE "user" SET role = ? WHERE id = ?')
      .run('dashboard_user', result.user.id);
    console.log(`✅ First admin created: ${adminEmail}`);
  }
}

export async function seedAdmin() {
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
      let superUser = await authService.getSuperUserByEmail(adminEmail);
      if (!superUser) {
        superUser = await authService.createSuperUser(adminEmail, adminPassword, 'Admin');
        console.log(`✅ Admin account created: ${adminEmail}`);
      } else {
        console.log(`✅ Admin account exists: ${adminEmail}`);
      }
    }

    // Initialize or get the single API key
    const apiKey = await authService.initializeApiKey();

    // Get database stats
    const tableCount = await dbManager.getUserTableCount();

    console.log(
      `✅ Database connected to PostgreSQL: ${process.env.POSTGRES_HOST || 'localhost'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'insforge'}`
    );
    if (tableCount > 0) {
      console.log(`✅ Found ${tableCount} user tables`);
    }
    console.log(`\n🔑 YOUR API KEY: ${apiKey}`);
    console.log(`\n💡 Save this API key for your apps!`);

    console.log(`🎨 Self hosting Dashboard: http://localhost:7131`);
    console.log(`📡 Backend API: http://localhost:7130/api`);
  } catch (error) {
    console.error('Error during setup:', error);
  }
}
