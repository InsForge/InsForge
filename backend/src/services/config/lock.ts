import type { Pool } from 'pg';
import { createHash } from 'node:crypto';

const LOCK_NAMESPACE = 0x1f06c0; // arbitrary 24-bit namespace; "config-apply"

/**
 * Serializes config-apply for a single project. Uses pg_advisory_lock keyed
 * on (LOCK_NAMESPACE, hash(projectRef)) so different projects never block
 * each other.
 *
 * In OSS single-tenant deployments the caller passes a fixed string like
 * 'default'; in cloud-multi-tenant the caller passes the project ref. The
 * helper doesn't care — it only cares that the same string keys the same
 * advisory slot.
 */
export async function withConfigApplyLock<T>(
  pool: Pool,
  projectRef: string,
  fn: () => Promise<T>
): Promise<T> {
  const key = projectKey(projectRef);
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await client.query('SELECT pg_advisory_lock($1, $2)', [LOCK_NAMESPACE, key]);
    lockAcquired = true;
    return await fn();
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1, $2)', [LOCK_NAMESPACE, key]);
      } finally {
        client.release();
      }
    } else {
      client.release();
    }
  }
}

function projectKey(projectRef: string): number {
  // pg advisory keys are 32-bit signed; hash to fit.
  const hash = createHash('sha256').update(projectRef).digest();
  // Take 4 bytes, interpret as int32. May be negative — that's fine for pg.
  return hash.readInt32BE(0);
}
