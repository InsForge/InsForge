import { Pool } from 'pg';
import AdmZip from 'adm-zip';
import jwt from 'jsonwebtoken';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { VercelProvider } from '@/providers/deployments/vercel.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import {
  DeploymentStatus,
  type DeploymentRecord,
  type DeploymentStatusType,
} from '@/types/deployments.js';
import logger from '@/utils/logger.js';
import type {
  CreateDeploymentResponse,
  StartDeploymentRequest,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
} from '@insforge/shared-schemas';

export type { DeploymentRecord, UpdateSlugResponse, DeploymentMetadataResponse };

// Deployment files are stored in a special "_deployments" bucket
const DEPLOYMENT_BUCKET = '_deployments';
const getDeploymentKey = (id: string) => `${id}.zip`;

export class DeploymentService {
  private static instance: DeploymentService;
  private pool: Pool | null = null;
  private vercelProvider: VercelProvider;
  private s3Provider: S3StorageProvider | null = null;

  private constructor() {
    this.vercelProvider = VercelProvider.getInstance();
    this.initializeS3Provider();
  }

  private initializeS3Provider(): void {
    const s3Bucket = process.env.AWS_S3_BUCKET;
    const appKey = process.env.APP_KEY || 'local';

    if (s3Bucket) {
      this.s3Provider = new S3StorageProvider(
        s3Bucket,
        appKey,
        process.env.AWS_REGION || 'us-east-2'
      );
      this.s3Provider.initialize();
    }
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
   * Only available in cloud environment
   */
  isConfigured(): boolean {
    if (!isCloudEnvironment()) {
      return false;
    }
    return this.vercelProvider.isConfigured() && this.s3Provider !== null;
  }

  /**
   * Create a new deployment record with WAITING status
   * Returns presigned URL for uploading source zip file
   */
  async createDeployment(): Promise<CreateDeploymentResponse> {
    if (!isCloudEnvironment()) {
      throw new AppError(
        'Deployments are only available in cloud environment.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    if (!this.s3Provider) {
      throw new AppError(
        'S3 storage is required for deployments. Please configure AWS_S3_BUCKET.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      // Create deployment record in database with WAITING status
      const result = await this.getPool().query(
        `INSERT INTO system.deployments (provider, status)
         VALUES ($1, $2)
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        ['vercel', DeploymentStatus.WAITING]
      );

      const deployment = result.rows[0] as DeploymentRecord;

      // Generate presigned URL for uploading zip file (reuse existing storage method)
      const uploadInfo = await this.s3Provider.getUploadStrategy(
        DEPLOYMENT_BUCKET,
        getDeploymentKey(deployment.id),
        { size: 100 * 1024 * 1024 } // 100MB max
      );

      logger.info('Deployment record created', {
        id: deployment.id,
        status: deployment.status,
      });

      return {
        id: deployment.id,
        uploadUrl: uploadInfo.uploadUrl,
        uploadFields: uploadInfo.fields || {},
      };
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
   * Start a deployment - download zip from S3, extract, upload to Vercel, create deployment
   */
  async startDeployment(id: string, input: StartDeploymentRequest = {}): Promise<DeploymentRecord> {
    if (!isCloudEnvironment()) {
      throw new AppError(
        'Deployments are only available in cloud environment.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    if (!this.s3Provider) {
      throw new AppError(
        'S3 storage is required for deployments. Please configure AWS_S3_BUCKET.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      // Get deployment record
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      // Verify deployment is in WAITING status
      if (deployment.status !== DeploymentStatus.WAITING) {
        throw new AppError(
          `Deployment is not in WAITING status. Current status: ${deployment.status}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Set UPLOADING status - server is now processing
      await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING);

      // Check if zip file exists
      const zipExists = await this.s3Provider.verifyObjectExists(
        DEPLOYMENT_BUCKET,
        getDeploymentKey(id)
      );
      if (!zipExists) {
        await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
          error: 'Source zip file not found. Please upload the source files first.',
        });
        throw new AppError(
          'Source zip file not found. Please upload the source files first.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Download zip from S3
      const zipBuffer = await this.s3Provider.getObject(DEPLOYMENT_BUCKET, getDeploymentKey(id));
      if (!zipBuffer) {
        await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
          error: 'Failed to download source zip file.',
        });
        throw new AppError('Failed to download source zip file.', 500, ERROR_CODES.INTERNAL_ERROR);
      }

      // Extract files from zip
      const files = this.extractFilesFromZip(zipBuffer);

      if (files.length === 0) {
        await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
          error: 'No files found in source zip.',
        });
        throw new AppError('No files found in source zip.', 400, ERROR_CODES.INVALID_INPUT);
      }

      logger.info('Extracted files from zip', {
        deploymentId: id,
        fileCount: files.length,
      });

      // Upsert environment variables if provided
      if (input.envVars && input.envVars.length > 0) {
        await this.vercelProvider.upsertEnvironmentVariables(input.envVars);
      }

      // Upload files to Vercel
      const uploadedFiles = await this.vercelProvider.uploadFiles(files);

      logger.info('Files uploaded to Vercel', {
        deploymentId: id,
        fileCount: uploadedFiles.length,
      });

      // Create deployment on Vercel
      const vercelDeployment = await this.vercelProvider.createDeploymentWithFiles(uploadedFiles, {
        projectSettings: input.projectSettings,
        meta: input.meta,
      });

      // Use Vercel's status directly (uppercase to match our enum)
      const vercelStatus = (
        vercelDeployment.readyState ||
        vercelDeployment.state ||
        'BUILDING'
      ).toUpperCase();

      // Get current env var keys from Vercel (for visibility)
      const envVarKeys = await this.vercelProvider.getEnvironmentVariableKeys();

      // Update deployment record with Vercel deployment info
      const updateResult = await this.getPool().query(
        `UPDATE system.deployments
         SET provider_deployment_id = $1,
             status = $2,
             url = $3,
             metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
         WHERE id = $5
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          vercelDeployment.id,
          vercelStatus,
          this.getDeploymentUrl(vercelDeployment.url),
          JSON.stringify({
            vercelName: vercelDeployment.name,
            fileCount: uploadedFiles.length,
            envVarKeys,
            startedAt: new Date().toISOString(),
          }),
          id,
        ]
      );

      // Clean up S3 deployment zip
      await this.s3Provider.deleteObject(DEPLOYMENT_BUCKET, getDeploymentKey(id)).catch((error) => {
        logger.warn('Failed to clean up deployment zip', {
          deploymentId: id,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      logger.info('Deployment started', {
        id,
        providerDeploymentId: vercelDeployment.id,
        status: vercelStatus,
      });

      return updateResult.rows[0] as DeploymentRecord;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to start deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      // Update status to ERROR
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {});
      throw new AppError('Failed to start deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get the deployment URL - uses custom domain if APP_KEY is set, otherwise falls back to provider URL
   */
  private getDeploymentUrl(providerUrl: string | null): string | null {
    const appKey = process.env.APP_KEY;
    if (appKey) {
      return `https://${appKey}.insforge.site`;
    }
    return providerUrl;
  }

  /**
   * Extract files from a zip buffer
   */
  private extractFilesFromZip(zipBuffer: Buffer): Array<{ path: string; content: Buffer }> {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const files: Array<{ path: string; content: Buffer }> = [];

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) {
        continue;
      }

      // Get file content
      const content = entry.getData();
      let filePath = entry.entryName;

      // Remove leading slash if present
      if (filePath.startsWith('/')) {
        filePath = filePath.substring(1);
      }

      files.push({
        path: filePath,
        content,
      });
    }

    return files;
  }

  /**
   * Update deployment status
   */
  private async updateDeploymentStatus(
    id: string,
    status: DeploymentStatusType,
    additionalMetadata?: Record<string, unknown>
  ): Promise<void> {
    const metadataUpdate = additionalMetadata
      ? `, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb`
      : '';
    const params = additionalMetadata
      ? [status, id, JSON.stringify(additionalMetadata)]
      : [status, id];

    await this.getPool().query(
      `UPDATE system.deployments SET status = $1${metadataUpdate} WHERE id = $2`,
      params
    );
  }

  /**
   * Get deployment by database ID
   */
  async getDeploymentById(id: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          provider_deployment_id as "providerDeploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM system.deployments
         WHERE id = $1`,
        [id]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment by ID', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment by Vercel deployment ID
   */
  async getDeploymentByVercelId(vercelDeploymentId: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          provider_deployment_id as "providerDeploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM system.deployments
         WHERE provider_deployment_id = $1`,
        [vercelDeploymentId]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment by Vercel ID', {
        error: error instanceof Error ? error.message : String(error),
        vercelDeploymentId,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Sync deployment status from provider and update database
   */
  async syncDeploymentById(id: string): Promise<DeploymentRecord | null> {
    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        return null;
      }

      if (!deployment.providerDeploymentId) {
        throw new AppError(
          'Cannot sync deployment: no provider deployment ID yet. Deployment may still be in WAITING status.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Fetch latest status from Vercel
      const vercelDeployment = await this.vercelProvider.getDeployment(
        deployment.providerDeploymentId
      );

      // Use Vercel's status directly (uppercase to match our enum)
      const vercelStatus = (
        vercelDeployment.readyState ||
        vercelDeployment.state ||
        'BUILDING'
      ).toUpperCase();

      // Update database with latest status
      const result = await this.getPool().query(
        `UPDATE system.deployments
         SET status = $1, url = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          vercelStatus,
          this.getDeploymentUrl(vercelDeployment.url),
          JSON.stringify({
            lastSyncedAt: new Date().toISOString(),
            ...(vercelDeployment.error && { error: vercelDeployment.error }),
          }),
          id,
        ]
      );

      logger.info('Deployment synced', { id, status: vercelStatus });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to sync deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to sync deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * List all deployments with total count for pagination
   */
  async listDeployments(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ deployments: DeploymentRecord[]; total: number }> {
    try {
      const [dataResult, countResult] = await Promise.all([
        this.getPool().query(
          `SELECT
            id,
            provider_deployment_id as "providerDeploymentId",
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
        ),
        this.getPool().query(`SELECT COUNT(*)::int as count FROM system.deployments`),
      ]);

      return {
        deployments: dataResult.rows,
        total: countResult.rows[0]?.count ?? 0,
      };
    } catch (error) {
      logger.error('Failed to list deployments', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list deployments', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Cancel a deployment by database ID
   */
  async cancelDeploymentById(id: string): Promise<void> {
    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      // If deployment has a Vercel ID, cancel it on Vercel
      if (deployment.providerDeploymentId) {
        await this.vercelProvider.cancelDeployment(deployment.providerDeploymentId);
      }

      // If deployment is in WAITING status, clean up S3 zip
      if (deployment.status === DeploymentStatus.WAITING && this.s3Provider) {
        await this.s3Provider
          .deleteObject(DEPLOYMENT_BUCKET, getDeploymentKey(id))
          .catch((error) => {
            logger.warn('Failed to clean up deployment zip on cancel', {
              id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      await this.getPool().query(
        `UPDATE system.deployments
         SET status = $1
         WHERE id = $2`,
        [DeploymentStatus.CANCELED, id]
      );

      logger.info('Deployment cancelled', {
        id,
        providerDeploymentId: deployment.providerDeploymentId,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to cancel deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to cancel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Update deployment status from webhook event
   * Uses Vercel deployment ID to find the deployment
   *
   * Note: For ERROR status, we fetch deployment details from Vercel API
   * to get error information since webhooks don't include error reasons.
   */
  async updateDeploymentFromWebhook(
    vercelDeploymentId: string,
    status: string,
    url: string | null,
    webhookMetadata: Record<string, unknown>
  ): Promise<DeploymentRecord | null> {
    try {
      // For ERROR status, fetch deployment details to get error information
      // Vercel webhooks don't include error reasons in the payload
      let errorInfo: { errorCode?: string; errorMessage?: string } | undefined;
      if (status === 'ERROR') {
        try {
          const vercelDeployment = await this.vercelProvider.getDeployment(vercelDeploymentId);
          if (vercelDeployment.error) {
            errorInfo = {
              errorCode: vercelDeployment.error.code,
              errorMessage: vercelDeployment.error.message,
            };
            logger.info('Fetched error details from Vercel API', {
              vercelDeploymentId,
              errorCode: errorInfo.errorCode,
            });
          }
        } catch (fetchError) {
          // Log but don't fail the webhook update if we can't fetch error details
          logger.warn('Failed to fetch error details from Vercel API', {
            vercelDeploymentId,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          });
        }
      }

      const result = await this.getPool().query(
        `UPDATE system.deployments
         SET status = $1, url = COALESCE($2, url), metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE provider_deployment_id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          status,
          this.getDeploymentUrl(url),
          JSON.stringify({
            lastWebhookAt: new Date().toISOString(),
            ...webhookMetadata,
            ...(errorInfo && { error: errorInfo }),
          }),
          vercelDeploymentId,
        ]
      );

      if (!result.rows.length) {
        logger.warn('Deployment not found for webhook update', { vercelDeploymentId });
        return null;
      }

      logger.info('Deployment updated from webhook', {
        vercelDeploymentId,
        status,
        ...(errorInfo && { errorCode: errorInfo.errorCode }),
      });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to update deployment from webhook', {
        error: error instanceof Error ? error.message : String(error),
        vercelDeploymentId,
      });
      throw new AppError(
        'Failed to update deployment from webhook',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Update the custom slug for the project
   * Calls cloud API: PUT /sites/v1/:projectId/slug
   */
  async updateSlug(slug: string | null): Promise<UpdateSlugResponse> {
    if (!isCloudEnvironment()) {
      throw new AppError(
        'Custom slugs are only available in cloud environment.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const projectId = process.env.PROJECT_ID;
    if (!projectId) {
      throw new AppError(
        'PROJECT_ID not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError(
        'JWT_SECRET not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      const signature = jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });
      const cloudApiHost = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';

      const response = await fetch(`${cloudApiHost}/sites/v1/${projectId}/slug`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sign: signature,
          slug: slug,
        }),
      });

      if (response.status === 409) {
        const errorData = (await response.json()) as { error?: string };
        throw new AppError(
          errorData.error || 'Slug is already taken',
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(
          `Failed to update slug: ${response.statusText} - ${errorText}`,
          response.status,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const data = (await response.json()) as UpdateSlugResponse;

      // Update cached slug in VercelProvider so subsequent calls get the correct value
      this.vercelProvider.updateCachedSlug(data.slug);

      logger.info('Custom domain slug updated', {
        projectId,
        slug: data.slug,
        domain: data.domain,
      });

      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to update slug', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to update slug', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment metadata including current deployment and domain URLs
   */
  async getMetadata(): Promise<DeploymentMetadataResponse> {
    try {
      // Get the latest READY deployment
      const result = await this.getPool().query(
        `SELECT
          id,
          url
         FROM system.deployments
         WHERE status = 'READY'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      const latestReadyDeployment = result.rows[0] as
        | { id: string; url: string | null }
        | undefined;

      // Get the custom domain URL from Vercel provider (which has the slug from cloud credentials)
      const customDomainUrl = await this.vercelProvider.getCustomDomainUrl();

      return {
        currentDeploymentId: latestReadyDeployment?.id ?? null,
        defaultDomainUrl: latestReadyDeployment?.url ?? null,
        customDomainUrl,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to get deployment metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to get deployment metadata', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
