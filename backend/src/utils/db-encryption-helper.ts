import { PoolClient } from 'pg';

export async function SetEncryptionKeyForClient(client: PoolClient): Promise<void> {
  const encryptionKey = process.env.DB_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error('DB_ENCRYPTION_KEY is not set in environment variables');
  }
  const escapedKey = encryptionKey.replace(/'/g, "''");
  await client.query(`SET app.encryption_key = '${escapedKey}';`);
}
