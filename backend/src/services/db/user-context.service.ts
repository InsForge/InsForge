import { Pool, PoolClient } from 'pg';

/**
 * Identity that is propagated into a Postgres connection so RLS policies
 * can read it via `auth.jwt() ->> 'sub'` (or the per-claim
 * `current_setting('request.jwt.claim.sub', true)` form for callers that
 * still use the legacy GUC).
 *
 * `isAdmin` short-circuits the role/context dance — admin connections
 * stay on the default postgres role and bypass RLS, matching how the
 * dashboard, the API key, and the `project_admin` role have always
 * worked across the rest of the codebase.
 */
export type UserContext = {
  userId?: string;
  role: 'authenticated' | 'anon';
  email?: string;
  isAdmin?: boolean;
};

/**
 * Run `fn` with a `PoolClient` whose JWT-claim GUCs and session role are
 * configured for RLS evaluation. Generalizes the pattern in
 * `realtime-auth.service.ts` so storage and any future RLS-enforced
 * surface use the same plumbing.
 *
 * Non-admin callers run inside a single transaction:
 *   BEGIN
 *   SET LOCAL ROLE <authenticated|anon>
 *   SELECT set_config('request.jwt.claims',      $jsonb,  true)  -- whole claims as jsonb
 *   SELECT set_config('request.jwt.claim.sub',   $userId, true)  -- legacy per-claim
 *   SELECT set_config('request.jwt.claim.role',  $role,   true)
 *   SELECT set_config('request.jwt.claim.email', $email,  true)  -- if present
 *   <fn(client)>
 *   COMMIT
 *
 * Both GUC styles are set so policies that use `auth.jwt() ->> 'sub'`
 * (the recommended form for non-UUID third-party auth subs) and policies
 * that read `current_setting('request.jwt.claim.sub', true)` (legacy)
 * both see the calling user. `RESET ROLE` always runs in `finally`
 * before the client returns to the pool, so a failed query never leaks
 * role state.
 *
 * Admin callers (apiKey or project_admin) skip the dance and use a plain
 * pool connection so postgres bypasses RLS the way it always has.
 */
export async function withUserContext<T>(
  pool: Pool,
  ctx: UserContext,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (ctx.isAdmin) {
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  const claims: Record<string, string> = { role: ctx.role };
  if (ctx.userId) {
    claims.sub = ctx.userId;
  }
  if (ctx.email) {
    claims.email = ctx.email;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${ctx.role}`);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [ctx.userId ?? '']);
    await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [ctx.role]);
    if (ctx.email) {
      await client.query("SELECT set_config('request.jwt.claim.email', $1, true)", [ctx.email]);
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
