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
  let lockAcquired = false;
  let taskResult: T | undefined;
  let taskError: unknown;
  let unlockError: unknown;

  try {
    await client.query(LOCK_SQL_BY_MODE[mode], [lockName]);
    lockAcquired = true;
    taskResult = await task();
  } catch (error) {
    taskError = error;
  } finally {
    if (!lockAcquired) {
      client.release();
    } else {
      try {
        await client.query(UNLOCK_SQL_BY_MODE[mode], [lockName]);
        client.release();
      } catch (error) {
        unlockError = error;
        logger.error('Failed to release payments advisory lock', {
          lockName,
          mode,
          error: error instanceof Error ? error.message : String(error),
          originalError: taskError instanceof Error ? taskError.message : undefined,
        });
        client.release(true);
      }
    }
  }

  if (taskError) {
    throw taskError;
  }

  if (unlockError) {
    throw unlockError;
  }

  return taskResult as T;
}
