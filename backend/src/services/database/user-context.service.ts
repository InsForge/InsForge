import { Pool, PoolClient } from 'pg';
import type { UserContext } from '@/api/middlewares/auth.js';

const REQUEST_JWT_CLAIMS_SETTING = 'request.jwt.claims';
const REQUEST_JWT_SETTING_PREFIX = 'request.jwt.';

/**
 * Run `fn` with a `PoolClient` whose JWT claims and session role are
 * configured for RLS evaluation.
 *
 * Callers run inside a single transaction:
 *   BEGIN
 *   SET LOCAL ROLE <authenticated|anon|project_admin>
 *   SELECT set_config('request.jwt.claims', $jsonb, true)
 *   SELECT set_config($setting,             $value, true)  -- optional surface settings
 *   <fn(client)>
 *   COMMIT
 *
 * The backend writes only `request.jwt.claims`, matching the PostgREST
 * claim shape and avoiding parallel sources of truth. Database helper
 * functions should read the same canonical JSON claim set. `RESET ROLE`
 * always runs in `finally` before the client returns to the pool, so a
 * failed query never leaks role state.
 */
export async function withUserContext<T>(
  pool: Pool,
  ctx: UserContext,
  fn: (client: PoolClient) => Promise<T>,
  settings: Record<string, string | undefined> = {}
): Promise<T> {
  const claims: Record<string, string> = { role: ctx.role };
  if (ctx.id) {
    claims.sub = ctx.id;
  }
  if (ctx.email) {
    claims.email = ctx.email;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Postgres parameters can't bind identifiers in SET ROLE, so the role
    // string must be interpolated. Allowlist instead — a future caller that
    // builds UserContext from a JSON payload or DB row is one mistake away
    // from arbitrary SQL landing in `SET LOCAL ROLE` if we trust the type.
    if (ctx.role === 'authenticated') {
      await client.query('SET LOCAL ROLE authenticated');
    } else if (ctx.role === 'anon') {
      await client.query('SET LOCAL ROLE anon');
    } else if (ctx.role === 'project_admin') {
      await client.query('SET LOCAL ROLE project_admin');
    } else {
      throw new Error(`withUserContext: unsupported role ${JSON.stringify(ctx.role)}`);
    }
    await setTransactionLocalConfig(client, REQUEST_JWT_CLAIMS_SETTING, JSON.stringify(claims));
    for (const [setting, value] of Object.entries(settings)) {
      if (value !== undefined) {
        if (setting.startsWith(REQUEST_JWT_SETTING_PREFIX)) {
          throw new Error(
            `withUserContext: settings must not override ${REQUEST_JWT_SETTING_PREFIX}*`
          );
        }
        await setTransactionLocalConfig(client, setting, value);
      }
    }

    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('RESET ROLE').catch(() => {});
    client.release();
  }
}

async function setTransactionLocalConfig(
  client: PoolClient,
  setting: string,
  value: string
): Promise<void> {
  await client.query('SELECT set_config($1, $2, true)', [setting, value]);
}
