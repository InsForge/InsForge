/**
 * Baseline script for the node-pg-migrate ledger.
 *
 * Recovery tool for the case the bootstrap guard refuses: the database schema is
 * already provisioned (restored from a backup / branched) but `system.migrations`
 * is empty. This stamps the ledger with every migration currently on disk, so
 * node-pg-migrate treats them as applied and only runs genuinely-new migrations
 * on the next `migrate:up`.
 *
 * SAFETY:
 * - Only runs when the ledger is EMPTY. If it already has rows it refuses, so it
 *   can never clobber real migration history.
 * - Use ONLY when the restored schema is at the SAME migration version as this
 *   build (the normal same-version restore / branch / DR case). If the schema is
 *   from an OLDER version, stamping every on-disk migration would skip the newer
 *   ones — in that case restore from a backup that includes system.migrations
 *   instead.
 *
 * The cloud-backend restore path should invoke this after a same-version restore,
 * or an operator can run `npm run migrate:baseline` manually.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import logger from '@/utils/logger.js';

const { Pool } = pg;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// bootstrap -> migrations
const MIGRATIONS_DIR = path.resolve(currentDir, '..');

/**
 * The migration "name" node-pg-migrate stores is the filename without the `.sql`
 * extension, ordered lexicographically (matching node-pg-migrate's own ordering).
 * Exported for unit testing.
 */
export function readMigrationNames(dir = MIGRATIONS_DIR) {
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => file.replace(/\.sql$/, ''));
}

export async function baselineMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    logger.error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const names = readMigrationNames();
  if (names.length === 0) {
    logger.error('Baseline: no migration files found, aborting');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });

  try {
    const client = await pool.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS system');
      await client.query(`
        CREATE TABLE IF NOT EXISTS system.migrations (
          id SERIAL PRIMARY KEY,
          name varchar(255) NOT NULL,
          run_on timestamp NOT NULL
        )
      `);

      await client.query('BEGIN');
      try {
        // Lock the table so a concurrent boot can't race us, then re-check empty.
        await client.query('LOCK TABLE system.migrations IN EXCLUSIVE MODE');
        const { rows } = await client.query('SELECT count(*)::int AS n FROM system.migrations');
        if ((rows[0]?.n ?? 0) > 0) {
          await client.query('ROLLBACK');
          logger.error(
            'Baseline: system.migrations is not empty — refusing to clobber existing ' +
              'migration history. No changes made.'
          );
          process.exit(1);
        }

        await client.query(
          `INSERT INTO system.migrations (name, run_on)
           SELECT name, now() FROM unnest($1::text[]) AS name`,
          [names]
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      logger.info(
        `Baseline: stamped ${names.length} migrations as applied ` +
          `(${names[0]} … ${names[names.length - 1]}). node-pg-migrate will now only run new migrations.`
      );
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Baseline failed', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (!process.env.VITEST) {
  baselineMigrations().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Baseline failed', {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  });
}
