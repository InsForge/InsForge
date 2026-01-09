/**
 * Bootstrap script for migrations table migration
 *
 * This script handles the one-time migration of the node-pg-migrate tracking table
 * from `public._migrations` to `system.migrations`.
 *
 * Why this is needed:
 * - node-pg-migrate checks for the migrations table BEFORE running any migrations
 * - If we try to move the table inside a migration file, node-pg-migrate will have
 *   already looked for `system.migrations`, not found it, and created an empty one
 * - This would cause all migrations to appear as "pending" and fail
 *
 * This script runs BEFORE node-pg-migrate and handles the table move gracefully.
 */

import pg from 'pg';
// Note: This imports a TypeScript file. This works because the script is run with `tsx`
// (see package.json migrate:bootstrap script), which can handle TypeScript imports.
// The relative path goes up 4 levels: bootstrap -> migrations -> database -> infra -> src, then into utils.
import logger from '../../../../utils/logger.js';

const { Pool } = pg;

async function bootstrapMigrations() {
  // Use DATABASE_URL from environment (set by dotenv-cli in npm scripts)
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    logger.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    const client = await pool.connect();

    try {
      // Check if old _migrations table exists in public schema
      const oldTableExists = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = '_migrations'
        ) as exists
      `);

      // Check if new system.migrations table already exists
      const newTableExists = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'system' AND table_name = 'migrations'
        ) as exists
      `);

      if (oldTableExists.rows[0].exists && !newTableExists.rows[0].exists) {
        logger.info('Bootstrap: Moving _migrations table to system.migrations...');

        // Create system schema if it doesn't exist
        await client.query('CREATE SCHEMA IF NOT EXISTS system');

        // Move the table in a transaction to avoid partial state
        await client.query('BEGIN');
        try {
          await client.query('ALTER TABLE public._migrations SET SCHEMA system');
          await client.query('ALTER TABLE system._migrations RENAME TO migrations');
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }

        logger.info('Bootstrap: Successfully moved _migrations to system.migrations');
      } else if (newTableExists.rows[0].exists) {
        // Already migrated, nothing to do
        logger.info('Bootstrap: system.migrations already exists, skipping');
      } else if (!oldTableExists.rows[0].exists && !newTableExists.rows[0].exists) {
        // Fresh install - create system schema so node-pg-migrate can create its table there
        logger.info('Bootstrap: No existing migrations table, fresh install');
        await client.query('CREATE SCHEMA IF NOT EXISTS system');
        logger.info('Bootstrap: Created system schema for migrations');
      }
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Bootstrap migration failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

bootstrapMigrations().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('Bootstrap migration failed', {
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
