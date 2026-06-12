import { DatabaseManager } from '@/infra/database/database.manager.js';
import { seedBackend } from '@/utils/seed.js';
import logger from '@/utils/logger.js';

async function main(): Promise<void> {
  const databaseManager = DatabaseManager.getInstance();
  await databaseManager.initialize();

  try {
    await seedBackend();
  } finally {
    await databaseManager.close();
  }
}

main().catch((error) => {
  logger.error('Failed to seed backend', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
