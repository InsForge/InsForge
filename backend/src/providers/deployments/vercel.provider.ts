import { Vercel } from '@vercel/sdk';
import jwt from 'jsonwebtoken';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

interface CloudCredentialsResponse {
  project_id: string;
  vercel_project_id: string;
  bearer_token: string;
  expires_at: string;
  webhook_secret: string | null;
}

interface VercelCredentials {
  token: string;
  teamId: string;
  projectId: string;
  expiresAt: Date | null;
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
  private vercelClient: Vercel | null = null;
  private currentToken: string | undefined;
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
   * Get or create Vercel SDK client
   * Recreates client if token has changed
   */
  private async getClient(): Promise<Vercel> {
    const credentials = await this.getCredentials();

    // Recreate client if token changed
    if (!this.vercelClient || this.currentToken !== credentials.token) {
      this.currentToken = credentials.token;
      this.vercelClient = new Vercel({
        bearerToken: credentials.token,
      });
    }

    return this.vercelClient;
  }

  /**
   * Get Vercel credentials based on environment
   * In cloud environment: fetches from cloud API with JWT authentication
   * In local environment: returns from environment variables
   */
  async getCredentials(): Promise<VercelCredentials> {
    if (isCloudEnvironment()) {
      // Check if we have valid cached credentials (not expired)
      if (
        this.cloudCredentials &&
        (!this.cloudCredentials.expiresAt || new Date() < this.cloudCredentials.expiresAt)
      ) {
        return this.cloudCredentials;
      }
      // Fetch new credentials if expired or not present
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

    // Local credentials don't expire
    return {
      token,
      teamId,
      projectId,
      expiresAt: null,
    };
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
   * Uses promise memoization to prevent duplicate fetch requests
   */
  private async fetchCloudCredentials(): Promise<VercelCredentials> {
    // If fetch is already in progress, wait for it
    if (this.fetchPromise) {
      logger.info('Vercel credentials fetch already in progress, waiting for completion...');
      return this.fetchPromise;
    }

    // Start new fetch and store the promise
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

        // Sign a token for authentication
        const signature = jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });

        // Fetch credentials from cloud service with sign token as query parameter
        const response = await fetch(
          `${process.env.CLOUD_API_HOST || 'https://api.insforge.dev'}/sites/v1/credentials/${projectId}?sign=${signature}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch Vercel credentials: ${response.statusText}`);
        }

        const data = (await response.json()) as CloudCredentialsResponse;

        // Validate response
        if (!data.bearer_token || !data.vercel_project_id) {
          throw new Error('Invalid response: missing Vercel credentials');
        }

        // Store webhook secret if provided
        if (data.webhook_secret) {
          await this.storeWebhookSecret(data.webhook_secret);
        }

        // Store credentials with expiry
        this.cloudCredentials = {
          token: data.bearer_token,
          teamId: data.project_id, // project_id from response is the team ID
          projectId: data.vercel_project_id,
          expiresAt: new Date(data.expires_at),
        };

        // Reset client to force recreation with new token
        this.vercelClient = null;

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
        // Clear the promise after completion (success or failure)
        this.fetchPromise = null;
      }
    })();

    return this.fetchPromise;
  }

  /**
   * Store webhook secret in secrets service if it doesn't exist or has changed
   */
  private async storeWebhookSecret(webhookSecret: string): Promise<void> {
    const secretKey = 'VERCEL_WEBHOOK_SECRET';

    try {
      // Check if secret already exists and matches
      const existingSecret = await this.secretService.getSecretByKey(secretKey);

      if (existingSecret === webhookSecret) {
        // Secret unchanged, no need to update
        return;
      }

      if (existingSecret !== null) {
        // Update existing secret
        await this.secretService.updateSecretByKey(secretKey, { value: webhookSecret });
        logger.info('Vercel webhook secret updated');
      } else {
        // Create new secret
        await this.secretService.createSecret({
          key: secretKey,
          value: webhookSecret,
          isReserved: true,
        });
        logger.info('Vercel webhook secret created');
      }
    } catch (error) {
      // Log but don't fail - webhook secret is not critical for deployments
      logger.warn('Failed to store Vercel webhook secret', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Create a new deployment on Vercel
   */
  async createDeployment(options: CreateDeploymentOptions = {}): Promise<VercelDeploymentResult> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();

    try {
      const deployment = await client.deployments.createDeployment({
        teamId: credentials.teamId,
        requestBody: {
          name: options.name || 'deployment',
          target: 'production',
          project: credentials.projectId,
          files: options.files,
          projectSettings: options.projectSettings,
          meta: options.meta,
        },
        skipAutoDetectionConfirmation: '1',
      });

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
   */
  async getDeployment(deploymentId: string): Promise<VercelDeploymentResult> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();

    try {
      const deployment = await client.deployments.getDeployment({
        idOrUrl: deploymentId,
        teamId: credentials.teamId,
      });

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
      // Check for 404 errors
      if (error instanceof Error && error.message.includes('404')) {
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
   */
  async cancelDeployment(deploymentId: string): Promise<void> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();

    try {
      await client.deployments.cancelDeployment({
        id: deploymentId,
        teamId: credentials.teamId,
      });

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
   * Creates new variables or updates existing ones
   */
  async upsertEnvironmentVariables(envVars: Array<{ key: string; value: string }>): Promise<void> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();

    try {
      // Vercel SDK expects the upsert format
      const upsertPayload = envVars.map((env) => ({
        key: env.key,
        value: env.value,
        type: 'encrypted' as const,
        target: ['production', 'preview', 'development'] as (
          | 'production'
          | 'preview'
          | 'development'
        )[],
      }));

      await client.projects.createProjectEnv({
        idOrName: credentials.projectId,
        teamId: credentials.teamId,
        upsert: 'true',
        requestBody: upsertPayload,
      });

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
   * Get all environment variable keys for the project (values not returned for security)
   */
  async getEnvironmentVariableKeys(): Promise<string[]> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();

    try {
      const response = await client.projects.filterProjectEnvs({
        idOrName: credentials.projectId,
        teamId: credentials.teamId,
      });

      // SDK returns a union type - check if response has 'envs' array
      if ('envs' in response && Array.isArray(response.envs)) {
        return response.envs.map((env) => env.key);
      }

      // Single env var response (shouldn't happen for list endpoint, but handle it)
      if ('key' in response) {
        return [response.key];
      }

      return [];
    } catch (error) {
      logger.warn('Failed to get environment variable keys', {
        error: error instanceof Error ? error.message : String(error),
      });
      return []; // Non-critical, return empty array
    }
  }

  /**
   * Clear cached credentials (useful for forcing a refresh)
   */
  clearCredentials(): void {
    this.cloudCredentials = undefined;
    this.fetchPromise = null;
    this.vercelClient = null;
    this.currentToken = undefined;
    logger.info('Vercel credentials cache cleared');
  }

  /**
   * Upload a single file to Vercel
   * Returns the SHA of the uploaded file
   */
  async uploadFile(fileContent: Buffer): Promise<string> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();
    const sha = await this.computeSha(fileContent);
    try {
      await client.deployments.uploadFile({
        teamId: credentials.teamId,
        xVercelDigest: sha,
        contentLength: fileContent.length,
        requestBody: fileContent,
      });

      logger.info('File uploaded to Vercel', { sha, size: fileContent.length });
      return sha;
    } catch (error) {
      // 409 Conflict means file already exists (same SHA), which is fine
      if (error instanceof Error && error.message.includes('409')) {
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
   * Returns array of file info with paths and SHAs
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
   * Compute SHA-1 hash of file content (Vercel uses SHA-1 for file deduplication)
   */
  private async computeSha(content: Buffer): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha1').update(content).digest('hex');
  }

  /**
   * Create deployment using file SHAs (files must be pre-uploaded)
   */
  async createDeploymentWithFiles(
    files: Array<{ file: string; sha: string; size: number }>,
    options: Omit<CreateDeploymentOptions, 'files'> = {}
  ): Promise<VercelDeploymentResult> {
    const client = await this.getClient();
    const credentials = await this.getCredentials();
    try {
      const deployment = await client.deployments.createDeployment({
        teamId: credentials.teamId,
        requestBody: {
          name: options.name || 'deployment',
          target: 'production',
          project: credentials.projectId,
          files: files,
          projectSettings: options.projectSettings,
          meta: options.meta,
        },
        skipAutoDetectionConfirmation: '1',
      });

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
