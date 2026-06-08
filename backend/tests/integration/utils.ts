import {
  getConnections as getInsforgeConnections,
  seed,
  type GetConnectionResult,
} from 'insforge-test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const MIGRATIONS = path.join(ROOT, 'backend/src/infra/database/migrations');

const migrationFiles = fs
  .readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => path.join(MIGRATIONS, f));

/**
 * Pre-configured getConnections() for InsForge integration tests.
 *
 * Seeds the test database by running the full InsForge migration chain
 * (db-init.sql + migrations 000–048) so the test schema matches production.
 *
 * pg_cron can only be installed in the database named by cron.database_name
 * (the Docker image hardcodes "insforge"), but pgsql-test creates isolated
 * databases with random names. A stub cron schema provides the table and
 * function signatures that later migrations reference. The real pgcrypto
 * and http extensions are installed normally.
 *
 * CREATE EXTENSION statements are stripped from migration files because
 * extensions are handled in the pre-seed step above.
 */
export const getConnections = (
  opts: Parameters<typeof getInsforgeConnections>[0] = {}
): Promise<GetConnectionResult> =>
  getInsforgeConnections(opts, [
    // 1. Bootstrap roles and event triggers
    seed.sqlfile([path.join(ROOT, 'deploy/docker-init/db/db-init.sql')]),
    // 2. Install real extensions + stub pg_cron
    //
    //    pgcrypto and http are real extensions from the Docker image.
    //
    //    pg_cron cannot be installed here because CREATE EXTENSION pg_cron
    //    only works in the database named by cron.database_name (hardcoded
    //    to "insforge" in postgresql.conf), and pgsql-test creates isolated
    //    databases with random names. We stub the cron schema because
    //    migrations 024 and 041 execute DO $$ blocks at migration time
    //    that SELECT FROM cron.job and PERFORM cron.schedule()/unschedule().
    seed.fn(async (ctx) => {
      await ctx.pg.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE EXTENSION IF NOT EXISTS http;

        CREATE SCHEMA IF NOT EXISTS cron;
        CREATE TABLE IF NOT EXISTS cron.job (
          jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          schedule text NOT NULL,
          command text NOT NULL,
          nodename text DEFAULT 'localhost',
          nodeport int DEFAULT 5432,
          database text DEFAULT current_database(),
          username text DEFAULT current_user,
          active boolean DEFAULT true,
          jobname text
        );
        CREATE FUNCTION cron.schedule(cron_schedule text, command text)
          RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
        CREATE FUNCTION cron.schedule(job_name text, cron_schedule text, command text)
          RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$;
        CREATE FUNCTION cron.unschedule(job_id bigint)
          RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
        CREATE FUNCTION cron.unschedule(job_name text)
          RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
      `);
    }),
    // 3. Run the full migration chain (000–048), stripping CREATE EXTENSION
    //    statements since extensions are already installed or stubbed above.
    seed.fn(async (ctx) => {
      for (const file of migrationFiles) {
        const sql = fs
          .readFileSync(file, 'utf8')
          .replace(/^CREATE EXTENSION IF NOT EXISTS \S+;$/gm, '');
        await ctx.pg.query(sql);
      }
    }),
  ]);
