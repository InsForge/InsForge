import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { StorageConfigSchema, UpdateStorageConfigRequest } from '@insforge/shared-schemas';

const DEFAULT_MAX_FILE_SIZE_MB = 50;

/**
 * Singleton service responsible for reading and updating the storage
 * configuration persisted in the `storage.configs` database table.
 */
export class StorageConfigService {
  private static instance: StorageConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('StorageConfigService initialized');
  }

  /**
   * Returns the singleton StorageConfigService instance,
   * creating it on first access.
   */
  public static getInstance(): StorageConfigService {
    if (!StorageConfigService.instance) {
      StorageConfigService.instance = new StorageConfigService();
    }
    return StorageConfigService.instance;
  }

  /**
   * Returns the lazily-initialized database connection pool.
   */
  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Retrieves the storage configuration from the database.
   * Returns the singleton row, or a fallback using the env-based /
   * default max file size when the table is empty or the query fails.
   */
  async getStorageConfig(): Promise<StorageConfigSchema> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          max_file_size_mb as "maxFileSizeMb",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM storage.configs
         LIMIT 1`
      );

      if (!result.rows.length) {
        logger.warn('No storage config found, returning default fallback values');
        return {
          id: '00000000-0000-0000-0000-000000000000',
          maxFileSizeMb: DEFAULT_MAX_FILE_SIZE_MB,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get storage config, returning fallback values', { error });
      // Return the effective fallback so the UI still sees the active cap
      const envValue = parseInt(process.env.MAX_FILE_SIZE || '');
      const effectiveMb = envValue ? Math.round(envValue / (1024 * 1024)) : DEFAULT_MAX_FILE_SIZE_MB;
      return {
        id: '00000000-0000-0000-0000-000000000000',
        maxFileSizeMb: effectiveMb,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Returns the configured maximum file size in bytes.
   * Reads from the database configuration first; falls back to the
   * `MAX_FILE_SIZE` environment variable or 50 MB default on failure.
   */
  async getMaxFileSizeBytes(): Promise<number> {
    try {
      const config = await this.getStorageConfig();
      return config.maxFileSizeMb * 1024 * 1024;
    } catch {
      // Fall back to env if DB is unavailable
      const envValue = parseInt(process.env.MAX_FILE_SIZE || '');
      return envValue || DEFAULT_MAX_FILE_SIZE_MB * 1024 * 1024;
    }
  }

  /**
   * Updates the storage configuration with the provided values.
   * If the singleton row does not yet exist (e.g. migrations were not run),
   * it will be created automatically via an INSERT instead of failing.
   */
  async updateStorageConfig(input: UpdateStorageConfigRequest): Promise<StorageConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT id FROM storage.configs LIMIT 1 FOR UPDATE'
      );

      let result;

      if (!existingResult.rows.length) {
        // Singleton row is missing — create it with the requested value
        result = await client.query(
          `INSERT INTO storage.configs (max_file_size_mb)
           VALUES ($1)
           RETURNING
             id,
             max_file_size_mb as "maxFileSizeMb",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [input.maxFileSizeMb]
        );
      } else {
        result = await client.query(
          `UPDATE storage.configs
           SET max_file_size_mb = $1, updated_at = NOW()
           RETURNING
             id,
             max_file_size_mb as "maxFileSizeMb",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [input.maxFileSizeMb]
        );
      }

      await client.query('COMMIT');
      logger.info('Storage config updated', { maxFileSizeMb: input.maxFileSizeMb });
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update storage config', { error });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to update storage configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }
}
