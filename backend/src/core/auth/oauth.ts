import { Pool } from 'pg';
import { DatabaseManager } from '@/core/database/manager.js';
import { SecretService } from '@/core/secrets/secrets.js';
import { AppError } from '@/api/middleware/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import { OAuthConfigSchema, OAuthProvidersSchema } from '@insforge/shared-schemas';

export interface CreateOAuthConfigInput {
  provider: OAuthProvidersSchema;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  useSharedKey?: boolean;
}

export interface UpdateOAuthConfigInput {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  scopes?: string[];
  useSharedKey?: boolean;
}

export class OAuthConfigService {
  private static instance: OAuthConfigService;
  private pool: Pool | null = null;
  private secretService: SecretService;

  private constructor() {
    this.secretService = new SecretService();
    logger.info('OAuthService initialized');
  }

  public static getInstance(): OAuthConfigService {
    if (!OAuthConfigService.instance) {
      OAuthConfigService.instance = new OAuthConfigService();
    }
    return OAuthConfigService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get all OAuth configurations
   */
  async getAllConfigs(): Promise<OAuthConfigSchema[]> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT
          id,
          provider,
          client_id as "clientId",
          redirect_uri as "redirectUri",
          scopes,
          use_shared_key as "useSharedKey",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM _oauth_configs
         ORDER BY provider ASC`
      );

      return result.rows;
    } catch (error) {
      logger.error('Failed to get OAuth configs', { error });
      throw new AppError('Failed to get OAuth configurations', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Get OAuth configuration by provider name
   */
  async getConfigByProvider(provider: string): Promise<OAuthConfigSchema | null> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT
          id,
          provider,
          client_id as "clientId",
          redirect_uri as "redirectUri",
          scopes,
          use_shared_key as "useSharedKey",
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM _oauth_configs
         WHERE LOWER(provider) = LOWER($1)
         LIMIT 1`,
        [provider]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get OAuth config by provider', { error, provider });
      throw new AppError('Failed to get OAuth configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Get OAuth provider secret
   */
  async getClientSecretByProvider(provider: string): Promise<string | null> {
    const client = await this.getPool().connect();
    try {
      const result = await client.query(
        `SELECT
          secret_id as "secretId"
         FROM _oauth_configs
         WHERE LOWER(provider) = LOWER($1)
         LIMIT 1`,
        [provider]
      );

      if (!result.rows.length) {
        return null;
      }

      const config = result.rows[0];
      const clientSecret = await this.secretService.getSecretById(config.secretId);
      if (!clientSecret) {
        logger.warn('OAuth config exists but secret not found', { provider });
        return null;
      }

      return clientSecret;
    } catch (error) {
      logger.error('Failed to get OAuth config with secret', { error, provider });
      throw new AppError('Failed to get OAuth configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Create OAuth configuration
   */
  async createConfig(input: CreateOAuthConfigInput): Promise<OAuthConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Check if config already exists for this provider
      const existingConfig = await client.query(
        'SELECT id FROM _oauth_configs WHERE LOWER(provider) = LOWER($1)',
        [input.provider]
      );

      if (existingConfig.rows.length) {
        throw new AppError(
          `OAuth configuration for ${input.provider} already exists`,
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      let secretId: string | null = null;

      // Only create secret if clientSecret is provided and not using shared key
      if (input.clientSecret && !input.useSharedKey) {
        // Create new secret
        const secret = await this.secretService.createSecret({
          key: `${input.provider.toUpperCase()}_CLIENT_SECRET`,
          value: input.clientSecret,
        });
        secretId = secret.id;
      }

      // Set default scopes if not provided
      let scopes = input.scopes;
      if (!scopes) {
        switch (input.provider) {
          case 'google':
            scopes = ['openid', 'email', 'profile'];
            break;
          case 'github':
            scopes = ['user:email'];
            break;
          case 'discord':
            scopes = ['identify', 'email'];
            break;
          case 'linkedin':
            scopes = ['openid', 'profile', 'email'];
            break;
          case 'facebook':
            scopes = ['email', 'public_profile'];
            break;
          case 'instagram':
            scopes = ['user_profile', 'user_media'];
            break;
          case 'tiktok':
            scopes = ['user.info.basic'];
            break;
          case 'apple':
            scopes = ['name', 'email'];
            break;
          case 'x':
            scopes = ['tweet.read', 'users.read'];
            break;
          case 'spotify':
            scopes = ['user-read-email', 'user-read-private'];
            break;
          case 'microsoft':
            scopes = ['User.Read'];
            break;
          default:
            scopes = ['email', 'profile'];
        }
      }

      // Create new OAuth config
      const result = await client.query(
        `INSERT INTO _oauth_configs (provider, client_id, secret_id, redirect_uri, scopes, use_shared_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING
           id,
           provider,
           client_id as "clientId",
           redirect_uri as "redirectUri",
           scopes,
           use_shared_key as "useSharedKey",
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          input.provider.toLowerCase(),
          input.clientId || null,
          secretId,
          null, // Deprecating redirect_uri
          scopes,
          input.useSharedKey || false,
        ]
      );

      await client.query('COMMIT');
      logger.info('OAuth config created', { provider: input.provider });

      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to create OAuth config', { error, provider: input.provider });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to create OAuth configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Update OAuth configuration
   */
  async updateConfig(provider: string, input: UpdateOAuthConfigInput): Promise<OAuthConfigSchema> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Get existing config with secret_id
      const existingResult = await client.query(
        `SELECT id, secret_id as "secretId" FROM _oauth_configs WHERE LOWER(provider) = LOWER($1)`,
        [provider]
      );

      if (!existingResult.rows.length) {
        throw new AppError('OAuth configuration not found', 404, ERROR_CODES.NOT_FOUND);
      }

      const existingConfig = existingResult.rows[0];

      // Update or create secret if provided
      if (input.clientSecret !== undefined) {
        if (existingConfig.secretId) {
          // Update existing secret
          await this.secretService.updateSecret(existingConfig.secretId, {
            value: input.clientSecret,
          });
        } else {
          // Create new secret if it doesn't exist
          const secret = await this.secretService.createSecret({
            key: `${provider.toUpperCase()}_CLIENT_SECRET`,
            value: input.clientSecret,
          });
          // Add secret_id to the update query
          await client.query(`UPDATE _oauth_configs SET secret_id = $1 WHERE id = $2`, [
            secret.id,
            existingConfig.id,
          ]);
        }
      }

      // Build update query
      const updates: string[] = [];
      const values: (string | string[] | boolean | null)[] = [];
      let paramCount = 1;

      if (input.clientId !== undefined) {
        updates.push(`client_id = $${paramCount++}`);
        values.push(input.clientId);
      }

      if (input.redirectUri !== undefined) {
        updates.push(`redirect_uri = $${paramCount++}`);
        values.push(input.redirectUri);
      }

      if (input.scopes !== undefined) {
        updates.push(`scopes = $${paramCount++}`);
        values.push(input.scopes);
      }

      if (input.useSharedKey !== undefined) {
        updates.push(`use_shared_key = $${paramCount++}`);
        values.push(input.useSharedKey);
      }

      if (!updates.length && input.clientSecret === undefined) {
        await client.query('COMMIT');
        // Return the config in the correct format
        const config = await this.getConfigByProvider(provider);
        if (!config) {
          throw new AppError('Failed to retrieve configuration', 500, ERROR_CODES.INTERNAL_ERROR);
        }
        return config;
      }

      if (updates.length) {
        updates.push('updated_at = NOW()');
        values.push(provider.toLowerCase());

        const result = await client.query(
          `UPDATE _oauth_configs
           SET ${updates.join(', ')}
           WHERE LOWER(provider) = $${paramCount}
           RETURNING
             id,
             provider,
             client_id as "clientId",
             redirect_uri as "redirectUri",
             scopes,
             use_shared_key as "useSharedKey",
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          values
        );

        await client.query('COMMIT');
        logger.info('OAuth config updated', { provider });
        return result.rows[0];
      }

      // Only secret was updated
      await client.query('COMMIT');
      const updatedConfig = await this.getConfigByProvider(provider);
      if (!updatedConfig) {
        throw new AppError(
          'Failed to retrieve updated configuration',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
      return updatedConfig;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to update OAuth config', { error, provider });
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError('Failed to update OAuth configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }

  /**
   * Delete OAuth configuration
   */
  async deleteConfig(provider: string): Promise<boolean> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Get existing config with secret_id
      const existingResult = await client.query(
        `SELECT id, secret_id as "secretId" FROM _oauth_configs WHERE LOWER(provider) = LOWER($1)`,
        [provider]
      );

      if (!existingResult.rows.length) {
        await client.query('ROLLBACK');
        return false;
      }

      const existingConfig = existingResult.rows[0];

      // Delete OAuth config (secret will be restricted due to foreign key)
      const result = await client.query(
        'DELETE FROM _oauth_configs WHERE LOWER(provider) = LOWER($1)',
        [provider]
      );

      // Try to delete the associated secret (will fail if still referenced)
      try {
        await client.query('DELETE FROM _secrets WHERE id = $1', [existingConfig.secretId]);
        logger.info('Associated secret deleted', { secretId: existingConfig.secretId });
      } catch {
        logger.warn('Could not delete associated secret, it may be in use elsewhere', {
          provider,
          secretId: existingConfig.secretId,
        });
      }

      await client.query('COMMIT');

      const success = (result.rowCount ?? 0) > 0;
      if (success) {
        logger.info('OAuth config deleted', { provider });
      }
      return success;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to delete OAuth config', { error, provider });
      throw new AppError('Failed to delete OAuth configuration', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      client.release();
    }
  }
}
