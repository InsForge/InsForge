import { PoolClient } from 'pg';
import { AppError } from '@/api/middleware/error';
import { ERROR_CODES } from '@/types/error-constants';

export async function SetEncryptionKeyForClient(client: PoolClient): Promise<void> {
  const encryptionKey = process.env.DB_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new AppError(
      'DB_ENCRYPTION_KEY is not set in environment variables',
      500,
      ERROR_CODES.NOT_FOUND
    );
  }
  const escapedKey = encryptionKey.replace(/'/g, "''");
  await client.query('SELECT set_config($1, $2, false)', ['app.encryption_key', escapedKey]);
}
