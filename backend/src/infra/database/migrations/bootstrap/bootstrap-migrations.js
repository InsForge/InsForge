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

const { Pool } = pg;

async function bootstrapMigrations() {
  // Use DATABASE_URL from environment (set by dotenv-cli in npm scripts)
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set');
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
        console.log('Bootstrap: Moving _migrations table to system.migrations...');

        // Create system schema if it doesn't exist
        await client.query('CREATE SCHEMA IF NOT EXISTS system');

        // Move the table
        await client.query('ALTER TABLE public._migrations SET SCHEMA system');
        await client.query('ALTER TABLE system._migrations RENAME TO migrations');

        console.log('Bootstrap: Successfully moved _migrations to system.migrations');
      } else if (newTableExists.rows[0].exists) {
        // Already migrated, nothing to do
        console.log('Bootstrap: system.migrations already exists, skipping');
      } else if (!oldTableExists.rows[0].exists && !newTableExists.rows[0].exists) {
        // Fresh install - create system schema so node-pg-migrate can create its table there
        console.log('Bootstrap: No existing migrations table, fresh install');
        await client.query('CREATE SCHEMA IF NOT EXISTS system');
        console.log('Bootstrap: Created system schema for migrations');
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Bootstrap migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

bootstrapMigrations();
