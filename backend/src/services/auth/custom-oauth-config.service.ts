import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type { CustomOAuthConfigSchema } from '@insforge/shared-schemas';

interface CustomOAuthConfigRow {
  id: string;
  key: string;
  name: string;
  discoveryEndpoint: string;
  clientId: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface CreateCustomOAuthConfigInput {
  key: string;
  name: string;
  discoveryEndpoint: string;
  clientId: string;
  clientSecret: string;
}

export interface UpdateCustomOAuthConfigInput {
  name?: string;
  discoveryEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
}

export class CustomOAuthConfigService {
  private static instance: CustomOAuthConfigService;
  private pool: Pool | null = null;
  private secretService: SecretService;

  private constructor() {
    this.secretService = SecretService.getInstance();
  }

  public static getInstance(): CustomOAuthConfigService {
    if (!CustomOAuthConfigService.instance) {
      CustomOAuthConfigService.instance = new CustomOAuthConfigService();
    }
    return CustomOAuthConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private buildSecretKey(providerKey: string): string {
    const providerKeyHash = createHash('sha256').update(providerKey).digest('hex');
    return `CUSTOM_OAUTH_${providerKeyHash}_CLIENT_SECRET`;
  }

  private mapRow(row: CustomOAuthConfigRow): CustomOAuthConfigSchema {
    const toTimestamp = (v: string | Date): string => (v instanceof Date ? v.toISOString() : v);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      discoveryEndpoint: row.discoveryEndpoint,
      clientId: row.clientId,
      createdAt: toTimestamp(row.createdAt),
      updatedAt: toTimestamp(row.updatedAt),
    };
  }

  async listConfigs(): Promise<CustomOAuthConfigSchema[]> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          key,
          name,
          discovery_endpoint AS "discoveryEndpoint",
          client_id AS "clientId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
         FROM auth.custom_oauth_configs
         ORDER BY key ASC`
      );
      return result.rows.map((row: CustomOAuthConfigRow) => this.mapRow(row));
    } catch (error) {
      logger.error('Failed to list custom OAuth configs', { error });
      throw new AppError(
        'Failed to list custom OAuth configurations',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  async getConfigByKey(key: string): Promise<CustomOAuthConfigSchema | null> {
    try {
      const keyLower = key.toLowerCase();
      const result = await this.getPool().query(
        `SELECT
          id,
          key,
          name,
          discovery_endpoint AS "discoveryEndpoint",
          client_id AS "clientId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
         FROM auth.custom_oauth_configs
         WHERE key = $1
         LIMIT 1`,
        [keyLower]
      );
      return result.rows[0] ? this.mapRow(result.rows[0] as CustomOAuthConfigRow) : null;
    } catch (error) {
      logger.error('Failed to get custom OAuth config by key', { error, key });
      throw new AppError(
        'Failed to get custom OAuth configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  async getClientSecretByKey(key: string): Promise<string | null> {
    try {
      const keyLower = key.toLowerCase();
      const result = await this.getPool().query(
        `SELECT secret_id AS "secretId"
         FROM auth.custom_oauth_configs
         WHERE key = $1
         LIMIT 1`,
        [keyLower]
      );
      if (!result.rows.length) {
        return null;
      }
      return await this.secretService.getSecretById(result.rows[0].secretId);
    } catch (error) {
      logger.error('Failed to get custom OAuth client secret', { error, key });
      throw new AppError(
        'Failed to get custom OAuth client secret',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  async createConfig(input: CreateCustomOAuthConfigInput): Promise<CustomOAuthConfigSchema> {
    const client = await this.getPool().connect();
    const keyLower = input.key.toLowerCase();
    let createdSecretId: string | null = null;
    try {
      await client.query('BEGIN');

      const secret = await this.secretService.createSecret({
        key: this.buildSecretKey(keyLower),
        value: input.clientSecret,
      });
      createdSecretId = secret.id;

      const result = await client.query(
        `INSERT INTO auth.custom_oauth_configs (
          key, name, discovery_endpoint, client_id, secret_id
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING
          id,
          key,
          name,
          discovery_endpoint AS "discoveryEndpoint",
          client_id AS "clientId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"`,
        [keyLower, input.name, input.discoveryEndpoint, input.clientId, secret.id]
      );

      await client.query('COMMIT');
      return this.mapRow(result.rows[0] as CustomOAuthConfigRow);
    } catch (error) {
      await client.query('ROLLBACK');
      if (createdSecretId) {
        try {
          await this.secretService.deleteSecret(createdSecretId);
        } catch (cleanupError) {
          logger.error('Failed to cleanup secret after create rollback', {
            cleanupError,
            createdSecretId,
          });
        }
      }
      if (error instanceof AppError) {
        throw error;
      }
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          `Custom OAuth config ${keyLower} already exists`,
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }
      logger.error('Failed to create custom OAuth config', { error, key: input.key });
      throw new AppError(
        'Failed to create custom OAuth configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }

  async updateConfig(
    key: string,
    input: UpdateCustomOAuthConfigInput
  ): Promise<CustomOAuthConfigSchema> {
    const client = await this.getPool().connect();
    const keyLower = key.toLowerCase();
    let previousSecretValue: string | null = null;
    let secretIdToRestore: string | null = null;
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, secret_id AS "secretId"
         FROM auth.custom_oauth_configs
         WHERE key = $1
         LIMIT 1`,
        [keyLower]
      );
      if (!current.rows.length) {
        throw new AppError(
          `Custom OAuth configuration for ${key} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }

      const existing = current.rows[0] as { id: string; secretId: string };
      if (input.clientSecret !== undefined) {
        previousSecretValue = await this.secretService.getSecretById(existing.secretId);
        secretIdToRestore = existing.secretId;
        const updated = await this.secretService.updateSecret(existing.secretId, {
          value: input.clientSecret,
        });
        if (!updated) {
          throw new AppError(
            `Failed to update secret for ${keyLower}`,
            500,
            ERROR_CODES.INTERNAL_ERROR
          );
        }
      }

      const updates: string[] = [];
      const values: unknown[] = [];
      let idx = 1;
      const push = (col: string, val: unknown) => {
        updates.push(`${col} = $${idx}`);
        values.push(val);
        idx += 1;
      };

      if (input.name !== undefined) {
        push('name', input.name);
      }
      if (input.discoveryEndpoint !== undefined) {
        push('discovery_endpoint', input.discoveryEndpoint);
      }
      if (input.clientId !== undefined) {
        push('client_id', input.clientId);
      }

      if (!updates.length) {
        await client.query('COMMIT');
        const config = await this.getConfigByKey(key);
        if (!config) {
          throw new AppError(
            `Custom OAuth configuration for ${key} not found`,
            404,
            ERROR_CODES.NOT_FOUND
          );
        }
        return config;
      }

      values.push(keyLower);
      const result = await client.query(
        `UPDATE auth.custom_oauth_configs
         SET ${updates.join(', ')}, updated_at = NOW()
         WHERE key = $${idx}
         RETURNING
          id,
          key,
          name,
          discovery_endpoint AS "discoveryEndpoint",
          client_id AS "clientId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"`,
        values
      );

      if (!result.rows.length) {
        throw new AppError(
          `Custom OAuth configuration for ${key} not found`,
          404,
          ERROR_CODES.NOT_FOUND
        );
      }

      await client.query('COMMIT');
      return this.mapRow(result.rows[0] as CustomOAuthConfigRow);
    } catch (error) {
      await client.query('ROLLBACK');
      if (secretIdToRestore && previousSecretValue !== null) {
        try {
          const restored = await this.secretService.updateSecret(secretIdToRestore, {
            value: previousSecretValue,
          });
          if (!restored) {
            logger.error('Failed to restore secret after rollback', {
              secretIdToRestore,
              key: keyLower,
            });
          }
        } catch (restoreError) {
          logger.error('Failed to restore secret after rollback', {
            restoreError,
            secretIdToRestore,
            key: keyLower,
          });
        }
      }
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to update custom OAuth config', { error, key: keyLower });
      throw new AppError(
        'Failed to update custom OAuth configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }

  async deleteConfig(key: string): Promise<boolean> {
    const client = await this.getPool().connect();
    const keyLower = key.toLowerCase();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        `SELECT id, secret_id AS "secretId"
         FROM auth.custom_oauth_configs
         WHERE key = $1
         LIMIT 1`,
        [keyLower]
      );
      if (!current.rows.length) {
        await client.query('ROLLBACK');
        return false;
      }

      const secretId = current.rows[0].secretId as string;
      await client.query('DELETE FROM auth.custom_oauth_configs WHERE id = $1', [
        current.rows[0].id,
      ]);
      await client.query('COMMIT');

      try {
        await this.secretService.deleteSecret(secretId);
      } catch (secretError) {
        logger.warn('Deleted config but failed to delete secret', {
          secretError,
          key: keyLower,
          secretId,
        });
      }

      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to delete custom OAuth config', { error, key: keyLower });
      throw new AppError(
        'Failed to delete custom OAuth configuration',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    } finally {
      client.release();
    }
  }
}
