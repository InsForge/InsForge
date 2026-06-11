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
 *
 * It also acts as a SAFETY GUARD against a corrupted migration ledger: if the
 * database schema is already provisioned (e.g. it was restored from a backup)
 * but `system.migrations` is empty, node-pg-migrate would otherwise replay every
 * migration from scratch. Those migrations are NOT idempotent (018 moves/renames
 * tables, others DROP or mutate data), so replaying them against an already-built
 * database crashes or corrupts it. We detect that state and refuse to continue,
 * with actionable remediation, instead of letting the replay run.
 */

import pg from 'pg';
// Note: This imports a TypeScript file. This works because the script is run with `tsx`
// (see package.json migrate:bootstrap script), which can handle TypeScript imports.
// The relative path goes up 4 levels: bootstrap -> migrations -> database -> infra -> src, then into utils.
import logger from '@/utils/logger.js';

const { Pool } = pg;

/**
 * Tables that only exist once migrations have run (created/renamed by 018+).
 * If any of these exist, the database has been migrated before — so an empty
 * ledger means the ledger was lost, not that this is a fresh install.
 */
const PROVISIONED_SCHEMA_MARKERS = ['auth.users', 'system.secrets', 'storage.objects'];

/**
 * Pure decision helper (exported for unit testing).
 *
 * Returns true when node-pg-migrate must NOT be allowed to run, because doing so
 * would replay already-applied, non-idempotent migrations against a populated
 * database. That happens precisely when the ledger table exists but is empty
 * while the schema is already provisioned.
 *
 * A genuine fresh install also has an empty ledger, but its schema is NOT
 * provisioned, so this returns false and node-pg-migrate runs normally.
 */
export function shouldRefuseReplay({ ledgerTableExists, ledgerRowCount, schemaProvisioned }) {
  return Boolean(ledgerTableExists) && ledgerRowCount === 0 && Boolean(schemaProvisioned);
}

async function isSchemaProvisioned(client) {
  const { rows } = await client.query(
    `SELECT bool_or(to_regclass($1) IS NOT NULL
                 OR to_regclass($2) IS NOT NULL
                 OR to_regclass($3) IS NOT NULL) AS provisioned`,
    PROVISIONED_SCHEMA_MARKERS
  );
  return Boolean(rows[0]?.provisioned);
}

async function countLedgerRows(client) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM system.migrations');
  return rows[0]?.n ?? 0;
}

function logInconsistentLedgerError() {
  logger.error(
    [
      'Bootstrap: REFUSING TO RUN MIGRATIONS — inconsistent migration state detected.',
      '',
      'The database schema is already provisioned (auth/system/storage tables exist),',
      'but the system.migrations ledger is EMPTY. This almost always means the database',
      'was restored from a backup (or branched) WITHOUT its system.migrations rows.',
      '',
      'Running node-pg-migrate now would replay every migration from 000 against an',
      'already-migrated database. Those migrations are not idempotent (e.g. 018 moves',
      'and renames tables, others DROP/mutate data), so the replay would crash or corrupt',
      'the database. Refusing instead.',
      '',
      'To recover:',
      '  - Same-version restore/branch: run `npm run migrate:baseline` to stamp the ledger',
      '    to match the migrations already present, then restart.',
      '  - Otherwise: restore from a FULL pg_dump that includes the `system` schema',
      '    (so system.migrations is repopulated). Backups must not exclude it.',
    ].join('\n')
  );
}

export async function bootstrapMigrations() {
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
        // The ledger table already exists. Before letting node-pg-migrate proceed,
        // guard against a lost ledger on an already-provisioned database.
        const [ledgerRowCount, schemaProvisioned] = await Promise.all([
          countLedgerRows(client),
          isSchemaProvisioned(client),
        ]);

        if (
          shouldRefuseReplay({
            ledgerTableExists: true,
            ledgerRowCount,
            schemaProvisioned,
          })
        ) {
          logInconsistentLedgerError();
          process.exit(1);
        }

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

// Auto-run when executed as a script, but not when imported by unit tests.
if (!process.env.VITEST) {
  bootstrapMigrations().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Bootstrap migration failed', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  });
}
