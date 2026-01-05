import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { VercelProvider } from '@/providers/deployments/vercel.provider.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import type { DeploymentRecord } from '@/types/deployments.js';
import logger from '@/utils/logger.js';
import type { CreateDeploymentRequest } from '@insforge/shared-schemas';

export type { DeploymentRecord };

export class DeploymentService {
  private static instance: DeploymentService;
  private pool: Pool | null = null;
  private vercelProvider: VercelProvider;

  private constructor() {
    this.vercelProvider = VercelProvider.getInstance();
  }

  public static getInstance(): DeploymentService {
    if (!DeploymentService.instance) {
      DeploymentService.instance = new DeploymentService();
    }
    return DeploymentService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Check if deployment service is configured
   */
  isConfigured(): boolean {
    return this.vercelProvider.isConfigured();
  }

  /**
   * Create a new deployment
   */
  async createDeployment(input: CreateDeploymentRequest): Promise<DeploymentRecord> {
    try {
      // Create deployment on Vercel
      const vercelDeployment = await this.vercelProvider.createDeployment({
        name: input.name,
        files: input.files,
        target: input.target,
        projectSettings: input.projectSettings,
        meta: input.meta,
      });

      // Store deployment record in database
      const result = await this.getPool().query(
        `INSERT INTO system.deployments (deployment_id, provider, status, url, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING
           id,
           deployment_id as "deploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          vercelDeployment.id,
          'vercel',
          vercelDeployment.readyState || vercelDeployment.state || 'pending',
          vercelDeployment.url,
          JSON.stringify({
            name: vercelDeployment.name,
            target: input.target || 'production',
          }),
        ]
      );

      const deployment = result.rows[0] as DeploymentRecord;

      logger.info('Deployment created', {
        id: deployment.id,
        deploymentId: deployment.deploymentId,
        provider: deployment.provider,
      });

      return deployment;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to create deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to create deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment by deployment ID (returns database record only)
   */
  async getDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          deployment_id as "deploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM system.deployments
         WHERE deployment_id = $1`,
        [deploymentId]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Sync deployment status from provider and update database
   */
  async syncDeployment(deploymentId: string): Promise<DeploymentRecord | null> {
    try {
      // Get deployment record from database
      const dbResult = await this.getPool().query(
        `SELECT provider FROM system.deployments WHERE deployment_id = $1`,
        [deploymentId]
      );

      if (!dbResult.rows.length) {
        return null;
      }

      // Fetch latest status from provider
      const providerStatus = await this.vercelProvider.getDeployment(deploymentId);

      // Update database with latest status
      const result = await this.getPool().query(
        `UPDATE system.deployments
         SET status = $1, url = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE deployment_id = $4
         RETURNING
           id,
           deployment_id as "deploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          providerStatus.readyState || providerStatus.state,
          providerStatus.url,
          JSON.stringify({
            lastSyncedAt: new Date().toISOString(),
            providerState: providerStatus.state,
            providerReadyState: providerStatus.readyState,
            ...(providerStatus.error && { error: providerStatus.error }),
          }),
          deploymentId,
        ]
      );

      logger.info('Deployment synced', {
        deploymentId,
        status: providerStatus.readyState || providerStatus.state,
      });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to sync deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError('Failed to sync deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * List all deployments
   */
  async listDeployments(limit: number = 50, offset: number = 0): Promise<DeploymentRecord[]> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          deployment_id as "deploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM system.deployments
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      return result.rows;
    } catch (error) {
      logger.error('Failed to list deployments', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list deployments', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Cancel a deployment
   */
  async cancelDeployment(deploymentId: string): Promise<void> {
    try {
      await this.vercelProvider.cancelDeployment(deploymentId);

      await this.getPool().query(
        `UPDATE system.deployments
         SET status = 'CANCELED'
         WHERE deployment_id = $1`,
        [deploymentId]
      );

      logger.info('Deployment cancelled', { deploymentId });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to cancel deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError('Failed to cancel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Update deployment status from webhook event
   */
  async updateDeploymentFromWebhook(
    deploymentId: string,
    status: string,
    url: string | null,
    webhookMetadata: Record<string, unknown>
  ): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `UPDATE system.deployments
         SET status = $1, url = COALESCE($2, url), metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE deployment_id = $4
         RETURNING
           id,
           deployment_id as "deploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          status,
          url,
          JSON.stringify({
            lastWebhookAt: new Date().toISOString(),
            ...webhookMetadata,
          }),
          deploymentId,
        ]
      );

      if (!result.rows.length) {
        logger.warn('Deployment not found for webhook update', { deploymentId });
        return null;
      }

      logger.info('Deployment updated from webhook', {
        deploymentId,
        status,
      });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to update deployment from webhook', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError(
        'Failed to update deployment from webhook',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }
}
