import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { StorageConfigSchema, UpdateStorageConfigRequest } from '@insforge/shared-schemas';

const DEFAULT_MAX_FILE_SIZE_MB = 50;

export class StorageConfigService {
  private static instance: StorageConfigService;
  private pool: Pool | null = null;

  private constructor() {
    logger.info('StorageConfigService initialized');
  }

  public static getInstance(): StorageConfigService {
    if (!StorageConfigService.instance) {
      StorageConfigService.instance = new StorageConfigService();
    }
    return StorageConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get the storage configuration.
   * Returns the singleton row or a default if none exists.
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
      logger.error('Failed to get storage config', { error });
      throw new AppError('Failed to get storage configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Returns the configured max file size in bytes (DB config or env fallback).
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
   * Update the storage configuration.
   */
  async updateStorageConfig(input: UpdateStorageConfigRequest): Promise<StorageConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const existingResult = await client.query(
        'SELECT id FROM storage.configs LIMIT 1 FOR UPDATE'
      );

      if (!existingResult.rows.length) {
        await client.query('ROLLBACK');
        throw new AppError(
          'Storage configuration not found. Please run migrations.',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const result = await client.query(
        `UPDATE storage.configs
         SET max_file_size_mb = $1, updated_at = NOW()
         RETURNING
           id,
           max_file_size_mb as "maxFileSizeMb",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [input.maxFileSizeMb]
      );

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
