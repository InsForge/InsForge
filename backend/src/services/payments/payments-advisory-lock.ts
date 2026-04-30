import type { Pool } from 'pg';
import logger from '@/utils/logger.js';

export type PaymentSessionAdvisoryLockMode = 'exclusive' | 'shared';

const LOCK_SQL_BY_MODE: Record<PaymentSessionAdvisoryLockMode, string> = {
  exclusive: 'SELECT pg_advisory_lock(hashtext($1))',
  shared: 'SELECT pg_advisory_lock_shared(hashtext($1))',
};

const UNLOCK_SQL_BY_MODE: Record<PaymentSessionAdvisoryLockMode, string> = {
  exclusive: 'SELECT pg_advisory_unlock(hashtext($1))',
  shared: 'SELECT pg_advisory_unlock_shared(hashtext($1))',
};

export async function withPaymentSessionAdvisoryLock<T>(
  pool: Pool,
  lockName: string,
  task: () => Promise<T>,
  mode: PaymentSessionAdvisoryLockMode = 'exclusive'
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query(LOCK_SQL_BY_MODE[mode], [lockName]);
    return await task();
  } finally {
    try {
      await client.query(UNLOCK_SQL_BY_MODE[mode], [lockName]);
      client.release();
    } catch (unlockError) {
      logger.error('Failed to release payments advisory lock', {
        lockName,
        mode,
        error: unlockError instanceof Error ? unlockError.message : String(unlockError),
      });
      client.release(true);
      throw unlockError;
    }
  }
}
