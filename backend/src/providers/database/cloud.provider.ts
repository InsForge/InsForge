import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import {
  DatabaseProvider,
  DatabaseConnectionInfo,
  DatabasePasswordInfo,
} from './base.provider.js';

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
   * @returns JWT token signed with project secret
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

    const payload = {
      sub: projectId,
    };

    return jwt.sign(payload, jwtSecret, {
      expiresIn: '10m',
    });
  }

  /**
   * Get database connection string from cloud backend
   * @returns Database connection info with masked password
   */
  async getDatabaseConnectionString(): Promise<DatabaseConnectionInfo> {
    try {
      const projectId = config.cloud.projectId;
      const apiHost = config.cloud.apiHost;
      const signToken = this.generateSignToken();

      const url = `${apiHost}/projects/v1/${projectId}/database-connection-string`;
      const response = await axios.get(url, {
        headers: {
          sign: signToken,
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      this.handleAxiosError(error, 'database connection string');
      throw error;
    }
  }

  /**
   * Get database password from cloud backend
   * @returns Database password (unmasked)
   */
  async getDatabasePassword(): Promise<DatabasePasswordInfo> {
    try {
      const projectId = config.cloud.projectId;
      const apiHost = config.cloud.apiHost;
      const signToken = this.generateSignToken();

      const url = `${apiHost}/projects/v1/${projectId}/database-password`;
      const response = await axios.get(url, {
        headers: {
          sign: signToken,
        },
        timeout: 10000,
      });

      return response.data;
    } catch (error) {
      this.handleAxiosError(error, 'database password');
      throw error;
    }
  }

  /**
   * Handle axios errors with consistent error messages
   */
  private handleAxiosError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const message = error.response?.data?.message || error.message;

      logger.error(`Failed to get ${operation} from cloud backend`, {
        projectId: config.cloud.projectId,
        status,
        message,
      });

      if (status === 401) {
        throw new AppError(
          'Authentication failed with cloud API. Check PROJECT_ID and JWT_SECRET.',
          status,
          ERROR_CODES.AUTH_UNAUTHORIZED
        );
      } else if (status === 403) {
        throw new AppError(
          `Access denied to ${operation}.`,
          status,
          ERROR_CODES.FORBIDDEN
        );
      } else if (status === 404) {
        throw new AppError(
          'Project not found in cloud backend.',
          status,
          ERROR_CODES.NOT_FOUND
        );
      } else {
        throw new AppError(
          `Failed to get ${operation}: ${message}`,
          status || 500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }
    }

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      `Failed to get ${operation}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      500,
      ERROR_CODES.INTERNAL_ERROR
    );
  }
}
