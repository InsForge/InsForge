import { PoolClient } from 'pg';
import { AppError } from '@/api/middlewares/error';
import { ERROR_CODES } from '@/types/error-constants';

export async function SetEncryptionKeyForClient(client: PoolClient): Promise<void> {
  const encryptionKey = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!encryptionKey) {
    throw new AppError(
      'ENCRYPTION_KEY or JWT_SECRET must be set in environment variables',
      500,
      ERROR_CODES.NOT_FOUND
    );
  }
  const escapedKey = encryptionKey.replace(/'/g, "''");
  await client.query('SELECT set_config($1, $2, false)', ['app.encryption_key', escapedKey]);
}
