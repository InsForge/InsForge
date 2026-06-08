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
 * Seeds the test database to match the current InsForge database model:
 *   1. deploy/docker-init/db/db-init.sql  – roles + legacy event triggers
 *   2. migrations/001 – public uid(), role(), email()
 *   3. migrations/013 – auth schema + auth.uid(), auth.role(), auth.email()
 *   4. migrations/044 – JSON-only JWT claims (drops dotted GUC fallback)
 *   5. seed.fn() – applies key parts of migrations 018 and 045:
 *        • auth schema grants (from 018)
 *        • ALTER ROLE project_admin BYPASSRLS (from 045)
 *        • drop legacy auto-policy event triggers (from 045)
 *      Full migrations can't run in isolation because they reference
 *      schemas (compute, deployments, email, etc.) that don't exist
 *      in the test DB.
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
      path.join(ROOT, 'backend/src/infra/database/migrations/044_prefer-request-jwt-claims.sql'),
    ]),
    seed.fn(async (ctx) => {
      await ctx.pg.query(`
        -- Auth schema grants (from 018 + 045)
        GRANT USAGE ON SCHEMA auth TO PUBLIC;
        GRANT USAGE ON SCHEMA auth TO project_admin;
        GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO authenticated, anon, project_admin;

        -- project_admin uses BYPASSRLS instead of per-table policies (from 045)
        ALTER ROLE project_admin BYPASSRLS;

        -- Drop legacy auto-policy event triggers and functions (from 045)
        DROP EVENT TRIGGER IF EXISTS create_policies_on_table_create;
        DROP EVENT TRIGGER IF EXISTS create_policies_on_rls_enable;
        DROP FUNCTION IF EXISTS public.create_default_policies() CASCADE;
        DROP FUNCTION IF EXISTS public.create_policies_after_rls() CASCADE;
      `);
    }),
  ]);
