import crypto from 'crypto';
import { Pool } from 'pg';
import { LRUCache } from 'lru-cache';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type {
  S3AccessKeySchema,
  S3AccessKeyWithSecretSchema,
  CreateS3AccessKeyRequest,
} from '@insforge/shared-schemas';

const ACCESS_KEY_ID_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const ACCESS_KEY_ID_RANDOM_LEN = 16;
const SECRET_RANDOM_BYTES = 30;
const MAX_KEYS_PER_PROJECT = 50;

export class S3AccessKeyService {
  private static instance: S3AccessKeyService | null = null;

  private cache = new LRUCache<string, { id: string; secret: string }>({
    max: 1024,
    ttl: 1000 * 60 * 5,
  });

  constructor(private pool: Pool) {}

  static getInstance(): S3AccessKeyService {
    if (!this.instance) {
      this.instance = new S3AccessKeyService(DatabaseManager.getInstance().getPool());
    }
    return this.instance;
  }

  private generateAccessKeyId(): string {
    const bytes = crypto.randomBytes(ACCESS_KEY_ID_RANDOM_LEN);
    let out = '';
    for (let i = 0; i < ACCESS_KEY_ID_RANDOM_LEN; i++) {
      out += ACCESS_KEY_ID_CHARSET[bytes[i] % ACCESS_KEY_ID_CHARSET.length];
    }
    return `INSF${out}`;
  }

  private generateSecretAccessKey(): string {
    return crypto.randomBytes(SECRET_RANDOM_BYTES).toString('base64url');
  }

  async create(input: CreateS3AccessKeyRequest): Promise<S3AccessKeyWithSecretSchema> {
    const accessKeyId = this.generateAccessKeyId();
    const secretAccessKey = this.generateSecretAccessKey();
    const encrypted = EncryptionManager.encrypt(secretAccessKey);

    // Count + insert in a single SERIALIZABLE transaction so two concurrent
    // requests cannot both pass the cap check and each insert a row. Without
    // this guard the 50-key-per-project limit is racy.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      const countResult = await client.query(
        'SELECT count(*)::int AS count FROM storage.s3_access_keys'
      );
      const count = Number(countResult.rows[0].count);
      if (count >= MAX_KEYS_PER_PROJECT) {
        await client.query('ROLLBACK');
        throw new AppError(
          `S3 access key limit reached (${MAX_KEYS_PER_PROJECT}). Delete an existing key first.`,
          400,
          ERROR_CODES.S3_ACCESS_KEY_LIMIT_EXCEEDED
        );
      }

      const result = await client.query(
        `INSERT INTO storage.s3_access_keys
           (access_key_id, secret_access_key_encrypted, description)
         VALUES ($1, $2, $3)
         RETURNING id, access_key_id, description, created_at, last_used_at`,
        [accessKeyId, encrypted, input.description ?? null]
      );
      await client.query('COMMIT');
      const row = result.rows[0];
      logger.info('S3 access key created', { accessKeyId });

      return {
        id: row.id,
        accessKeyId: row.access_key_id,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
        secretAccessKey,
      };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // swallow — outer error takes precedence
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async list(): Promise<S3AccessKeySchema[]> {
    const result = await this.pool.query(
      `SELECT id, access_key_id, description, created_at, last_used_at
       FROM storage.s3_access_keys
       ORDER BY created_at DESC`
    );
    return result.rows.map((r) => ({
      id: r.id,
      accessKeyId: r.access_key_id,
      description: r.description,
      createdAt: r.created_at.toISOString(),
      lastUsedAt: r.last_used_at ? r.last_used_at.toISOString() : null,
    }));
  }

  async delete(id: string): Promise<void> {
    const result = await this.pool.query(
      'DELETE FROM storage.s3_access_keys WHERE id = $1 RETURNING access_key_id',
      [id]
    );
    if (result.rowCount === 0) {
      throw new AppError('S3 access key not found', 404, ERROR_CODES.S3_ACCESS_KEY_NOT_FOUND);
    }
    this.cache.delete(result.rows[0].access_key_id);
    logger.info('S3 access key deleted', { accessKeyId: result.rows[0].access_key_id });
  }

  /**
   * Used by SigV4 middleware. Returns plaintext secret + id when found.
   * NOT exposed via any HTTP endpoint.
   */
  async resolveAccessKeyForVerification(
    accessKeyId: string
  ): Promise<{ id: string; secret: string } | null> {
    const cached = this.cache.get(accessKeyId);
    if (cached) {
      return cached;
    }

    const result = await this.pool.query(
      `SELECT id, secret_access_key_encrypted
       FROM storage.s3_access_keys
       WHERE access_key_id = $1`,
      [accessKeyId]
    );
    if (result.rowCount === 0) {
      return null;
    }
    const row = result.rows[0];
    const value = {
      id: row.id,
      secret: EncryptionManager.decrypt(row.secret_access_key_encrypted),
    };
    this.cache.set(accessKeyId, value);
    return value;
  }

  async touchLastUsed(id: string): Promise<void> {
    await this.pool.query('UPDATE storage.s3_access_keys SET last_used_at = NOW() WHERE id = $1', [
      id,
    ]);
  }
}
