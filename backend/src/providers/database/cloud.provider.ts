import jwt from 'jsonwebtoken';
import axios from 'axios';
import { z } from 'zod';
import { config } from '@/infra/config/app.config.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
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
   * Generate JWT sign token for cloud API authentication
   */
  private generateSignToken(): string {
    const projectId = config.cloud.projectId;
    const jwtSecret = config.app.jwtSecret;

    if (!projectId || projectId === 'local') {
      throw new AppError(
        'PROJECT_ID is not configured. Cannot access cloud API without cloud project setup.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    if (!jwtSecret) {
      throw new AppError(
        'JWT_SECRET is not configured. Cannot generate sign token.',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return jwt.sign({ sub: projectId }, jwtSecret, { expiresIn: '10m' });
  }

  /**
   * Get database connection string from cloud backend
   */
  async getDatabaseConnectionString(): Promise<DatabaseConnectionInfo> {
    const signToken = this.generateSignToken();
    const url = `${config.cloud.apiHost}/projects/v1/${config.cloud.projectId}/database-connection-string`;

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
    const signToken = this.generateSignToken();
    const url = `${config.cloud.apiHost}/projects/v1/${config.cloud.projectId}/database-password`;

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
