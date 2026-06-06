import {
  getConnections as getInsforgeConnections,
  seed,
  type GetConnectionResult,
} from 'insforge-test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Pre-configured getConnections() for InsForge integration tests.
 *
 * Seeds the test database with:
 *   1. deploy/docker-init/db/db-init.sql  – roles + auto-RLS event triggers
 *   2. migrations/001 – public uid(), role(), email()
 *   3. migrations/013 – auth schema + auth.uid(), auth.role(), auth.email()
 *   4. auth schema grants – mirrors grants from migrations 018 and 045
 *      (full migrations can't run in isolation because they move/rename
 *       tables and reference schemas that don't exist in the test DB)
 *
 * No pgpm workspace required — uses seed.sqlfile() with InsForge's own SQL.
 */
export const getConnections = (
  opts: Parameters<typeof getInsforgeConnections>[0] = {}
): Promise<GetConnectionResult> =>
  getInsforgeConnections(opts, [
    seed.sqlfile([
      path.join(ROOT, 'deploy/docker-init/db/db-init.sql'),
      path.join(ROOT, 'backend/src/infra/database/migrations/001_create-helper-functions.sql'),
      path.join(ROOT, 'backend/src/infra/database/migrations/013_create-auth-schema-functions.sql'),
    ]),
    // Grants from 018_schema-rework.sql (GRANT USAGE ON SCHEMA auth TO PUBLIC)
    // and 045_project-admin-public-privileges.sql (auth grants to project_admin).
    // These migrations are too large to run in isolation (they ALTER/RENAME
    // tables and reference schemas that don't exist in a fresh test DB),
    // so we apply only the relevant grants here.
    seed.fn(async (ctx) => {
      await ctx.pg.query(`
        GRANT USAGE ON SCHEMA auth TO PUBLIC;
        GRANT USAGE ON SCHEMA auth TO project_admin;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, project_admin;
      `);
    }),
  ]);
