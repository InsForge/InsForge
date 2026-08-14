import axios from 'axios';
import { z } from 'zod';
import { appConfig } from '@/infra/config/app.config.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { DatabaseProvider, DatabaseConnectionInfo, DatabasePasswordInfo } from './base.provider.js';

/**
 * Zod schema for validating database connection info response
 */
const DatabaseConnectionInfoSchema = z.object({
  connectionURL: z.string(),
  parameters: z.object({
    host: z.string(),
    port: z.number(),
    database: z.string(),
    user: z.string(),
    password: z.string(),
    sslmode: z.string(),
  }),
});

/**
 * Zod schema for validating database password response
 */
const DatabasePasswordInfoSchema = z.object({
  databasePassword: z.string(),
});

/**
 * Cloud database provider for fetching database connection info via Insforge cloud backend
 */
export class CloudDatabaseProvider implements DatabaseProvider {
  private static instance: CloudDatabaseProvider;

  private constructor() {}

  public static getInstance(): CloudDatabaseProvider {
    if (!CloudDatabaseProvider.instance) {
      CloudDatabaseProvider.instance = new CloudDatabaseProvider();
    }
    return CloudDatabaseProvider.instance;
  }

  /**
   * Get database connection string from cloud backend
   */
  async getDatabaseConnectionString(): Promise<DatabaseConnectionInfo> {
    const signToken = TokenManager.getInstance().signCloudToken('Cloud database access');
    const url = `${appConfig.cloud.apiHost}/projects/v1/${appConfig.cloud.projectId}/database-connection-string`;

    try {
      const response = await axios.get(url, {
        headers: { sign: signToken },
        timeout: 10000,
      });

      const parsed = DatabaseConnectionInfoSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new AppError(
          `Invalid database connection info response: ${parsed.error.message}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 500;
        const message = error.response?.data?.message ?? error.message;
        throw new AppError(
          `Failed to fetch database connection string: ${message}`,
          status,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
      throw new AppError(
        `Unexpected error fetching database connection string: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Get database password from cloud backend
   */
  async getDatabasePassword(): Promise<DatabasePasswordInfo> {
    const signToken = TokenManager.getInstance().signCloudToken('Cloud database access');
    const url = `${appConfig.cloud.apiHost}/projects/v1/${appConfig.cloud.projectId}/database-password`;

    try {
      const response = await axios.get(url, {
        headers: { sign: signToken },
        timeout: 10000,
      });

      const parsed = DatabasePasswordInfoSchema.safeParse(response.data);
      if (!parsed.success) {
        throw new AppError(
          `Invalid database password response: ${parsed.error.message}`,
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? 500;
        const message = error.response?.data?.message ?? error.message;
        throw new AppError(
          `Failed to fetch database password: ${message}`,
          status,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
      throw new AppError(
        `Unexpected error fetching database password: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }
}
