/* eslint-disable no-console */
import { AuthService } from '@/core/auth/auth.js';
import { DatabaseManager } from '@/core/database/database.js';

export async function seedAdmin() {
  const authService = AuthService.getInstance();
  const dbManager = DatabaseManager.getInstance();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'change-this-password';

  try {
    let superUser = await authService.getSuperUserByEmail(adminEmail);
    if (!superUser) {
      superUser = await authService.createSuperUser(adminEmail, adminPassword, 'Admin');
      console.log(`\n🚀 Insforge Backend Starting...`);
      console.log(`✅ Admin account created: ${adminEmail}`);
    } else {
      console.log(`\n🚀 Insforge Backend Starting...`);
      console.log(`✅ Admin account exists: ${adminEmail}`);
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
