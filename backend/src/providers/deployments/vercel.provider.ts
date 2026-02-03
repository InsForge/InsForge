import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

interface CloudCredentialsResponse {
  team_id: string;
  vercel_project_id: string;
  bearer_token: string;
  expires_at: string;
  webhook_secret: string | null;
  slug: string | null;
}

interface VercelCredentials {
  token: string;
  teamId: string;
  projectId: string;
  expiresAt: Date | null;
  slug: string | null;
}

export interface VercelDeploymentResult {
  id: string;
  url: string | null;
  state: string;
  readyState: string;
  name: string;
  createdAt: Date;
  error?: {
    code: string;
    message: string;
  };
}

export interface CreateDeploymentOptions {
  name?: string;
  files?: Array<{
    file: string;
    sha: string;
    size: number;
  }>;
  projectSettings?: {
    buildCommand?: string | null;
    outputDirectory?: string | null;
    installCommand?: string | null;
    devCommand?: string | null;
    rootDirectory?: string | null;
  };
  meta?: Record<string, string>;
}

export interface DeploymentFile {
  path: string;
  content: Buffer;
  sha: string;
  size: number;
}

export class VercelProvider {
  private static instance: VercelProvider;
  private cloudCredentials: VercelCredentials | undefined;
  private fetchPromise: Promise<VercelCredentials> | null = null;
  private secretService: SecretService;

  private constructor() {
    this.secretService = SecretService.getInstance();
  }

  static getInstance(): VercelProvider {
    if (!VercelProvider.instance) {
      VercelProvider.instance = new VercelProvider();
    }
    return VercelProvider.instance;
  }

  /**
   * Get Vercel credentials based on environment
   */
  async getCredentials(): Promise<VercelCredentials> {
    if (isCloudEnvironment()) {
      if (
        this.cloudCredentials &&
        (!this.cloudCredentials.expiresAt || new Date() < this.cloudCredentials.expiresAt)
      ) {
        return this.cloudCredentials;
      }
      return await this.fetchCloudCredentials();
    }

    const token = process.env.VERCEL_TOKEN;
    const teamId = process.env.VERCEL_TEAM_ID;
    const projectId = process.env.VERCEL_PROJECT_ID;

    if (!token) {
      throw new AppError(
        'VERCEL_TOKEN not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    if (!teamId) {
      throw new AppError(
        'VERCEL_TEAM_ID not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
    if (!projectId) {
      throw new AppError(
        'VERCEL_PROJECT_ID not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    return { token, teamId, projectId, expiresAt: null, slug: null };
  }

  /**
   * Check if Vercel is properly configured
   */
  isConfigured(): boolean {
    if (isCloudEnvironment()) {
      return true;
    }
    return !!(
      process.env.VERCEL_TOKEN &&
      process.env.VERCEL_TEAM_ID &&
      process.env.VERCEL_PROJECT_ID
    );
  }

  /**
   * Fetch credentials from cloud service
   */
  private async fetchCloudCredentials(): Promise<VercelCredentials> {
    if (this.fetchPromise) {
      logger.info('Vercel credentials fetch already in progress, waiting for completion...');
      return this.fetchPromise;
    }

    this.fetchPromise = (async () => {
      try {
        const projectId = process.env.PROJECT_ID;
        if (!projectId) {
          throw new Error('PROJECT_ID not found in environment variables');
        }

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          throw new Error('JWT_SECRET not found in environment variables');
        }

        const signature = jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });

        const response = await fetch(
          `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/sites/v1/credentials/${projectId}?sign=${signature}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch Vercel credentials: ${response.statusText}`);
        }

        const data = (await response.json()) as CloudCredentialsResponse;

        if (!data.bearer_token || !data.vercel_project_id) {
          throw new Error('Invalid response: missing Vercel credentials');
        }

        if (data.webhook_secret) {
          await this.storeWebhookSecret(data.webhook_secret);
        }

        this.cloudCredentials = {
          token: data.bearer_token,
          teamId: data.team_id,
          projectId: data.vercel_project_id,
          expiresAt: new Date(data.expires_at),
          slug: data.slug,
        };

        logger.info('Successfully fetched Vercel credentials from cloud', {
          expiresAt: this.cloudCredentials.expiresAt?.toISOString(),
        });

        return this.cloudCredentials;
      } catch (error) {
        logger.error('Failed to fetch Vercel credentials', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  /**
   * Store webhook secret in secrets service
   */
  private async storeWebhookSecret(webhookSecret: string): Promise<void> {
    const secretKey = 'VERCEL_WEBHOOK_SECRET';

    try {
      const existingSecret = await this.secretService.getSecretByKey(secretKey);

      if (existingSecret === webhookSecret) {
        return;
      }

      if (existingSecret !== null) {
        await this.secretService.updateSecretByKey(secretKey, { value: webhookSecret });
        logger.info('Vercel webhook secret updated');
      } else {
        await this.secretService.createSecret({
          key: secretKey,
          value: webhookSecret,
          isReserved: true,
        });
        logger.info('Vercel webhook secret created');
      }
    } catch (error) {
      logger.warn('Failed to store Vercel webhook secret', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create a new deployment on Vercel
   * POST /v13/deployments
   */
  async createDeployment(options: CreateDeploymentOptions = {}): Promise<VercelDeploymentResult> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.post(
        `https://api.vercel.com/v13/deployments?teamId=${credentials.teamId}&skipAutoDetectionConfirmation=1`,
        {
          name: options.name || 'deployment',
          target: 'production',
          project: credentials.projectId,
          files: options.files,
          projectSettings: options.projectSettings,
          meta: options.meta,
        },
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      const deployment = response.data;

      logger.info('Vercel deployment created', {
        id: deployment.id,
        url: deployment.url,
        readyState: deployment.readyState,
      });

      return {
        id: deployment.id,
        url: deployment.url ? `https://${deployment.url}` : null,
        state: deployment.readyState,
        readyState: deployment.readyState,
        name: deployment.name,
        createdAt: new Date(deployment.createdAt),
      };
    } catch (error) {
      logger.error('Failed to create Vercel deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to create Vercel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment status by deployment ID
   * GET /v13/deployments/:id
   */
  async getDeployment(deploymentId: string): Promise<VercelDeploymentResult> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.get(
        `https://api.vercel.com/v13/deployments/${deploymentId}?teamId=${credentials.teamId}`,
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );
      const deployment = response.data;

      return {
        id: deployment.id,
        url: deployment.url ? `https://${deployment.url}` : null,
        state: deployment.readyState,
        readyState: deployment.readyState,
        name: deployment.name,
        createdAt: new Date(deployment.createdAt),
        error: deployment.errorCode
          ? {
              code: deployment.errorCode,
              message: deployment.errorMessage || 'Unknown error',
            }
          : undefined,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new AppError(`Deployment not found: ${deploymentId}`, 404, ERROR_CODES.NOT_FOUND);
      }
      logger.error('Failed to get Vercel deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError('Failed to get Vercel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Cancel a deployment
   * PATCH /v12/deployments/:id/cancel
   */
  async cancelDeployment(deploymentId: string): Promise<void> {
    const credentials = await this.getCredentials();

    try {
      await axios.patch(
        `https://api.vercel.com/v12/deployments/${deploymentId}/cancel?teamId=${credentials.teamId}`,
        {},
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );
      logger.info('Vercel deployment cancelled', { deploymentId });
    } catch (error) {
      logger.error('Failed to cancel Vercel deployment', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
      throw new AppError('Failed to cancel Vercel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Upsert environment variables for the project
   */
  async upsertEnvironmentVariables(envVars: Array<{ key: string; value: string }>): Promise<void> {
    const credentials = await this.getCredentials();

    try {
      const payload = envVars.map((env) => ({
        key: env.key,
        value: env.value,
        type: 'encrypted',
        target: ['production', 'preview', 'development'],
      }));

      await axios.post(
        `https://api.vercel.com/v10/projects/${credentials.projectId}/env?teamId=${credentials.teamId}&upsert=true`,
        payload,
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      logger.info('Environment variables upserted', {
        count: envVars.length,
        keys: envVars.map((e) => e.key),
      });
    } catch (error) {
      logger.error('Failed to upsert environment variables', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to upsert environment variables', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get all environment variable keys for the project
   */
  async getEnvironmentVariableKeys(): Promise<string[]> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.get(
        `https://api.vercel.com/v10/projects/${credentials.projectId}/env?teamId=${credentials.teamId}`,
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      const data = response.data as { envs?: Array<{ key: string }> };
      return (data.envs || []).map((env) => env.key);
    } catch (error) {
      logger.warn('Failed to get environment variable keys', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get all environment variables for the project (without values for security)
   * GET /v10/projects/:idOrName/env
   * https://docs.vercel.com/docs/rest-api/reference/endpoints/projects/retrieve-the-environment-variables-of-a-project-by-id-or-name
   */
  async listEnvironmentVariables(): Promise<
    Array<{
      id: string;
      key: string;
      type: string;
      updatedAt?: number;
    }>
  > {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.get(
        `https://api.vercel.com/v10/projects/${credentials.projectId}/env`,
        {
          headers: { Authorization: `Bearer ${credentials.token}` },
          params: {
            teamId: credentials.teamId,
          },
        }
      );

      const data = response.data as {
        envs?: Array<{
          id: string;
          key: string;
          type: string;
          updatedAt?: number;
        }>;
      };

      // Return only id, key, type, updatedAt - values are fetched separately for security
      return (data.envs || []).map((env) => ({
        id: env.id,
        key: env.key,
        type: env.type,
        updatedAt: env.updatedAt,
      }));
    } catch (error) {
      logger.error('Failed to list environment variables', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list environment variables', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get a single environment variable with its decrypted value
   * GET /v1/projects/:idOrName/env/:id
   * https://docs.vercel.com/docs/rest-api/reference/endpoints/projects/retrieve-the-decrypted-value-of-an-environment-variable-of-a-project-by-id
   */
  async getEnvironmentVariable(envId: string): Promise<{
    id: string;
    key: string;
    value: string;
    type: string;
    updatedAt?: number;
  }> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.get(
        `https://api.vercel.com/v1/projects/${credentials.projectId}/env/${envId}`,
        {
          headers: { Authorization: `Bearer ${credentials.token}` },
          params: {
            teamId: credentials.teamId,
          },
        }
      );

      const data = response.data as {
        id: string;
        key: string;
        value: string;
        type: string;
        updatedAt?: number;
      };

      return {
        id: data.id,
        key: data.key,
        value: data.value,
        type: data.type,
        updatedAt: data.updatedAt,
      };
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new AppError(`Environment variable not found: ${envId}`, 404, ERROR_CODES.NOT_FOUND);
      }
      logger.error('Failed to get environment variable', {
        error: error instanceof Error ? error.message : String(error),
        envId,
      });
      throw new AppError('Failed to get environment variable', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Delete an environment variable by its Vercel ID
   */
  async deleteEnvironmentVariable(envId: string): Promise<void> {
    const credentials = await this.getCredentials();

    try {
      await axios.delete(
        `https://api.vercel.com/v10/projects/${credentials.projectId}/env/${envId}?teamId=${credentials.teamId}`,
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      logger.info('Environment variable deleted', { envId });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new AppError(`Environment variable not found: ${envId}`, 404, ERROR_CODES.NOT_FOUND);
      }
      logger.error('Failed to delete environment variable', {
        error: error instanceof Error ? error.message : String(error),
        envId,
      });
      throw new AppError('Failed to delete environment variable', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Clear cached credentials
   */
  clearCredentials(): void {
    this.cloudCredentials = undefined;
    this.fetchPromise = null;
    logger.info('Vercel credentials cache cleared');
  }

  /**
   * Get the current custom slug from cached credentials
   * Returns null if not in cloud environment or no slug is set
   */
  async getSlug(): Promise<string | null> {
    if (!isCloudEnvironment()) {
      return null;
    }
    const credentials = await this.getCredentials();
    return credentials.slug;
  }

  /**
   * Get the custom domain URL based on the slug
   * Returns null if no slug is set
   */
  async getCustomDomainUrl(): Promise<string | null> {
    const slug = await this.getSlug();
    return slug ? `https://${slug}.insforge.site` : null;
  }

  /**
   * Upload a single file to Vercel
   * POST /v2/files
   */
  async uploadFile(fileContent: Buffer): Promise<string> {
    const credentials = await this.getCredentials();
    const sha = this.computeSha(fileContent);

    try {
      await axios.post(
        `https://api.vercel.com/v2/files?teamId=${credentials.teamId}`,
        fileContent,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': fileContent.length.toString(),
            'x-vercel-digest': sha,
          },
        }
      );

      logger.info('File uploaded to Vercel', { sha, size: fileContent.length });
      return sha;
    } catch (error) {
      // 409 Conflict means file already exists (same SHA), which is fine
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        logger.info('File already exists on Vercel', { sha });
        return sha;
      }
      logger.error('Failed to upload file to Vercel', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to upload file to Vercel', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Upload multiple files to Vercel in parallel
   */
  async uploadFiles(
    files: Array<{ path: string; content: Buffer }>
  ): Promise<Array<{ file: string; sha: string; size: number }>> {
    const uploadPromises = files.map(async ({ path, content }) => {
      const sha = await this.uploadFile(content);
      return {
        file: path,
        sha,
        size: content.length,
      };
    });

    return Promise.all(uploadPromises);
  }

  /**
   * Compute SHA-1 hash of file content
   */
  private computeSha(content: Buffer): string {
    return crypto.createHash('sha1').update(content).digest('hex');
  }

  /**
   * Create deployment using file SHAs (files must be pre-uploaded)
   */
  async createDeploymentWithFiles(
    files: Array<{ file: string; sha: string; size: number }>,
    options: Omit<CreateDeploymentOptions, 'files'> = {}
  ): Promise<VercelDeploymentResult> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.post(
        `https://api.vercel.com/v13/deployments?teamId=${credentials.teamId}&skipAutoDetectionConfirmation=1`,
        {
          name: options.name || 'deployment',
          target: 'production',
          project: credentials.projectId,
          files: files,
          projectSettings: options.projectSettings,
          meta: options.meta,
        },
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      const deployment = response.data;

      logger.info('Vercel deployment created with file SHAs', {
        id: deployment.id,
        url: deployment.url,
        readyState: deployment.readyState,
        fileCount: files.length,
      });

      return {
        id: deployment.id,
        url: deployment.url ? `https://${deployment.url}` : null,
        state: deployment.readyState,
        readyState: deployment.readyState,
        name: deployment.name,
        createdAt: new Date(deployment.createdAt),
      };
    } catch (error) {
      logger.error('Failed to create Vercel deployment with files', {
        error: error instanceof Error ? error.message : String(error),
        fileCount: files.length,
      });
      throw new AppError('Failed to create Vercel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
