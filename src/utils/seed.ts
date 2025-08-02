/* eslint-disable no-console */
import { AuthService } from '@/core/auth/auth.js';
import { DatabaseManager } from '@/core/database/database.js';

export async function seedAdmin() {
  const authService = AuthService.getInstance();
  const dbManager = DatabaseManager.getInstance();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-password';

  try {
    console.log(`\n🚀 Insforge Backend Starting...`);
    
    // Handle auth based on Better Auth flag
    if (process.env.ENABLE_BETTER_AUTH === 'true') {
      // Use Better Auth to create initial admin
      const { auth } = await import('@/lib/better-auth.js');
      
      try {
        // Try to create admin user with Better Auth
        await auth.api.signUpEmail({
          body: {
            email: adminEmail,
            password: adminPassword,
            name: 'Admin',
            role: 'dashboard_user', // Admin role
          },
        });
        console.log(`✅ Admin account created via Better Auth: ${adminEmail}`);
      } catch (error: any) {
        // If email already exists, that's fine
        if (error.message?.includes('already exists') || error.code === 'USER_ALREADY_EXISTS') {
          console.log(`✅ Admin account already exists in Better Auth: ${adminEmail}`);
        } else {
          console.error('Better Auth error:', error);
        }
      }
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
