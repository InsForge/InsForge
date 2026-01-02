import jwt from 'jsonwebtoken';
import axios from 'axios';
import { config } from '@/infra/config/app.config.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { DatabaseProvider, DatabaseConnectionInfo, DatabasePasswordInfo } from './base.provider.js';

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

    const response = await axios.get(url, {
      headers: { sign: signToken },
      timeout: 10000,
    });

    return response.data;
  }

  /**
   * Get database password from cloud backend
   */
  async getDatabasePassword(): Promise<DatabasePasswordInfo> {
    const signToken = this.generateSignToken();
    const url = `${config.cloud.apiHost}/projects/v1/${config.cloud.projectId}/database-password`;

    const response = await axios.get(url, {
      headers: { sign: signToken },
      timeout: 10000,
    });

    return response.data;
  }
}
