import axios from 'axios';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { Readable } from 'stream';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import logger from '@/utils/logger.js';

const VERCEL_UPLOAD_TIMEOUT_MS = 120_000;

// Rate-limit retry configuration for Vercel file uploads
const UPLOAD_MAX_RETRIES = 3;
const UPLOAD_BACKOFF_BASE_MS = 1000;
const UPLOAD_BACKOFF_MAX_MS = 30000;
const UPLOAD_JITTER_MAX_MS = 500;
const UPLOAD_BATCH_SIZE = 5;
const UPLOAD_INTER_BATCH_DELAY_MS = 200;

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

export interface VercelCustomDomain {
  id: string;
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  redirect: string | null;
  redirectStatusCode: number | null;
  gitBranch: string | null;
  customEnvironmentId?: string | null;
  createdAt: number;
  updatedAt: number;
  verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
}

export interface VercelDomainConfig {
  misconfigured?: boolean;
  recommendedCNAME?: Array<{
    rank: number;
    value: string;
  }>;
  recommendedIPv4?: Array<{
    rank: number;
    value: string[];
  }>;
}

export interface VercelProjectDomain {
  name: string;
  apexName: string;
  verified: boolean;
  verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
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

  private createUploadAbortController(signal?: AbortSignal): {
    controller: AbortController;
    cleanup: () => void;
  } {
    const controller = new AbortController();

    if (!signal) {
      return { controller, cleanup: () => undefined };
    }

    if (signal.aborted) {
      controller.abort(signal.reason);
      return { controller, cleanup: () => undefined };
    }

    const handleAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', handleAbort, { once: true });

    return {
      controller,
      cleanup: () => signal.removeEventListener('abort', handleAbort),
    };
  }

  private isUploadTimeoutError(error: unknown): boolean {
    return (
      axios.isAxiosError(error) &&
      (error.code === 'ECONNABORTED' || error.message.toLowerCase().includes('timeout'))
    );
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
   * Update the cached slug after a successful slug update
   * This avoids refetching all credentials from the cloud API
   */
  updateCachedSlug(slug: string | null): void {
    if (this.cloudCredentials) {
      this.cloudCredentials.slug = slug;
      logger.debug('Updated cached slug', { slug });
    }
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

  // ============================================================================
  // Custom Domain Management
  // ============================================================================

  /**
   * List domains associated with the configured Vercel project
   * GET /v9/projects/:id/domains
   */
  async listCustomDomains(): Promise<VercelCustomDomain[]> {
    const credentials = await this.getCredentials();

    try {
      const params = new URLSearchParams({
        teamId: credentials.teamId,
      });

      const response = await axios.get(
        `https://api.vercel.com/v9/projects/${credentials.projectId}/domains?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${credentials.token}` },
        }
      );

      const data = response.data as {
        domains?: VercelCustomDomain[];
      };

      const domains = data.domains ?? [];

      logger.info('Custom domains fetched from Vercel', {
        count: domains.length,
      });

      return domains;
    } catch (error) {
      logger.error('Failed to list custom domains from Vercel', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list custom domains', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get DNS configuration hints for a domain on Vercel
   * GET /v6/domains/:domain/config
   */
  async getCustomDomainConfig(domain: string): Promise<VercelDomainConfig> {
    const credentials = await this.getCredentials();

    try {
      const params = new URLSearchParams({
        teamId: credentials.teamId,
      });

      const response = await axios.get(
        `https://api.vercel.com/v6/domains/${domain}/config?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${credentials.token}` },
        }
      );

      return response.data as VercelDomainConfig;
    } catch (error) {
      logger.error('Failed to fetch custom domain config from Vercel', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to get custom domain config', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get a single domain associated with the configured Vercel project
   * GET /v9/projects/:id/domains/:domain
   */
  async getCustomDomain(domain: string): Promise<VercelProjectDomain> {
    const credentials = await this.getCredentials();

    try {
      const params = new URLSearchParams({
        teamId: credentials.teamId,
      });

      const response = await axios.get(
        `https://api.vercel.com/v9/projects/${credentials.projectId}/domains/${domain}?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${credentials.token}` },
        }
      );

      return response.data as VercelProjectDomain;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new AppError(`Domain not found on Vercel: ${domain}`, 404, ERROR_CODES.NOT_FOUND);
      }
      logger.error('Failed to fetch custom domain from Vercel', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to get custom domain', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Add a custom domain to the Vercel project
   * POST /v10/projects/:id/domains
   */
  async addCustomDomain(domain: string): Promise<{
    name: string;
    apexName: string;
    projectId: string;
    redirect: string | null;
    redirectStatusCode: number | null;
    gitBranch: string | null;
    updatedAt: number;
    createdAt: number;
    verified: boolean;
    verification: Array<{ type: string; domain: string; value: string; reason: string }>;
  }> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.post(
        `https://api.vercel.com/v10/projects/${credentials.projectId}/domains?teamId=${credentials.teamId}`,
        { name: domain },
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      logger.info('Custom domain added to Vercel project', { domain });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const msg = (error.response?.data as { error?: { message?: string } })?.error?.message;
        if (status === 409) {
          throw new AppError(
            msg || `Domain ${domain} is already added to this project`,
            409,
            ERROR_CODES.ALREADY_EXISTS
          );
        }
        if (status === 400) {
          throw new AppError(msg || `Invalid domain: ${domain}`, 400, ERROR_CODES.INVALID_INPUT);
        }
      }
      logger.error('Failed to add custom domain to Vercel', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to add custom domain', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Remove a custom domain from the Vercel project
   * DELETE /v9/projects/:id/domains/:domain
   */
  async removeCustomDomain(domain: string): Promise<void> {
    const credentials = await this.getCredentials();

    try {
      await axios.delete(
        `https://api.vercel.com/v9/projects/${credentials.projectId}/domains/${domain}?teamId=${credentials.teamId}`,
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      logger.info('Custom domain removed from Vercel project', { domain });
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Domain not found on Vercel side – treat as already removed
        return;
      }
      logger.error('Failed to remove custom domain from Vercel', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to remove custom domain', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Verify a custom domain's DNS configuration
   * POST /v9/projects/:id/domains/:domain/verify
   */
  async verifyCustomDomain(domain: string): Promise<{
    verified: boolean;
    verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
  }> {
    const credentials = await this.getCredentials();

    try {
      const response = await axios.post(
        `https://api.vercel.com/v9/projects/${credentials.projectId}/domains/${domain}/verify?teamId=${credentials.teamId}`,
        {},
        { headers: { Authorization: `Bearer ${credentials.token}` } }
      );

      const data = response.data as {
        verified: boolean;
        verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
      };

      logger.info('Custom domain verification result', { domain, verified: data.verified });
      return data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new AppError(`Domain not found on Vercel: ${domain}`, 404, ERROR_CODES.NOT_FOUND);
      }
      logger.error('Failed to verify custom domain', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to verify custom domain', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Upload a single file to Vercel
   * POST /v2/files
   */
  async uploadFile(fileContent: Buffer): Promise<string> {
    const credentials = await this.getCredentials();
    const sha = this.computeSha(fileContent);

    for (let attempt = 0; attempt <= UPLOAD_MAX_RETRIES; attempt++) {
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

        // 429 Rate limit -- retry with exponential backoff + jitter
        // Vercel uses X-RateLimit-Reset (Unix epoch seconds) instead of Retry-After
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          if (attempt < UPLOAD_MAX_RETRIES) {
            const rateLimitReset = error.response.headers['x-ratelimit-reset'];
            const parsedReset = rateLimitReset ? parseInt(rateLimitReset, 10) : NaN;
            let baseDelay: number;
            if (!isNaN(parsedReset)) {
              const resetMs = parsedReset * 1000;
              baseDelay = Math.min(
                Math.max(resetMs - Date.now(), UPLOAD_BACKOFF_BASE_MS),
                UPLOAD_BACKOFF_MAX_MS
              );
            } else {
              baseDelay = Math.min(2 ** attempt * UPLOAD_BACKOFF_BASE_MS, UPLOAD_BACKOFF_MAX_MS);
            }
            const delay = baseDelay + Math.random() * UPLOAD_JITTER_MAX_MS;

            logger.warn('Vercel rate limit hit, retrying file upload', {
              sha,
              attempt: attempt + 1,
              maxRetries: UPLOAD_MAX_RETRIES,
              delayMs: Math.round(delay),
            });

            await new Promise((resolve) => setTimeout(resolve, delay));
            continue;
          }

          logger.error('Vercel rate limit exceeded after retries', {
            sha,
            attempts: UPLOAD_MAX_RETRIES + 1,
          });
          throw new AppError(
            'Vercel rate limit exceeded for file upload. Wait a moment and retry the deployment.',
            429,
            ERROR_CODES.RATE_LIMITED
          );
        }

        logger.error('Failed to upload file to Vercel', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw new AppError('Failed to upload file to Vercel', 500, ERROR_CODES.INTERNAL_ERROR);
      }
    }

    // Unreachable, but TypeScript needs a return
    throw new AppError('Failed to upload file to Vercel', 500, ERROR_CODES.INTERNAL_ERROR);
  }

  /**
   * Stream a single file to Vercel
   * POST /v2/files
   */
  async uploadFileStream(input: {
    content: Readable;
    sha: string;
    size: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const credentials = await this.getCredentials();
    const { controller: uploadAbortController, cleanup } = this.createUploadAbortController(
      input.signal
    );

    try {
      await axios.post(
        `https://api.vercel.com/v2/files?teamId=${credentials.teamId}`,
        input.content,
        {
          headers: {
            Authorization: `Bearer ${credentials.token}`,
            'Content-Type': 'application/octet-stream',
            'Content-Length': input.size.toString(),
            'x-vercel-digest': input.sha,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: VERCEL_UPLOAD_TIMEOUT_MS,
          signal: uploadAbortController.signal,
        }
      );

      logger.info('File streamed to Vercel', { sha: input.sha, size: input.size });
      return input.sha;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if (this.isUploadTimeoutError(error)) {
        uploadAbortController.abort(
          new Error(`Vercel file upload timed out after ${VERCEL_UPLOAD_TIMEOUT_MS}ms.`)
        );
        if (!input.content.destroyed) {
          input.content.destroy();
        }

        logger.warn('Vercel timed out streamed file upload', {
          sha: input.sha,
          size: input.size,
          timeoutMs: VERCEL_UPLOAD_TIMEOUT_MS,
        });
        throw new AppError(
          `Vercel file upload timed out after ${VERCEL_UPLOAD_TIMEOUT_MS}ms. Retry the file upload.`,
          504,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      // 409 Conflict means file already exists (same SHA), which is fine.
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        logger.info('File already exists on Vercel', { sha: input.sha });
        return input.sha;
      }

      // Streaming uploads cannot be safely retried because the request body has
      // already been consumed. The client should retry with a fresh request.
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        logger.warn('Vercel rate limit hit for streamed file upload', { sha: input.sha });
        throw new AppError(
          'Vercel rate limit exceeded for file upload. Wait a moment and retry the file upload.',
          429,
          ERROR_CODES.RATE_LIMITED
        );
      }

      if (axios.isAxiosError(error) && error.response?.status === 400) {
        logger.warn('Vercel rejected streamed file upload', {
          sha: input.sha,
          status: error.response.status,
        });
        throw new AppError(
          'Uploaded file content does not match the registered deployment file.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
        throw new AppError('Vercel file upload was interrupted.', 499, ERROR_CODES.INVALID_INPUT);
      }

      logger.error('Failed to stream file to Vercel', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to upload file to Vercel', 500, ERROR_CODES.INTERNAL_ERROR);
    } finally {
      cleanup();
    }
  }

  /**
   * Upload multiple files to Vercel with limited concurrency
   */
  async uploadFiles(
    files: Array<{ path: string; content: Buffer }>
  ): Promise<Array<{ file: string; sha: string; size: number }>> {
    const results: Array<{ file: string; sha: string; size: number }> = [];

    for (let i = 0; i < files.length; i += UPLOAD_BATCH_SIZE) {
      const batch = files.slice(i, i + UPLOAD_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async ({ path, content }) => {
          const sha = await this.uploadFile(content);
          return { file: path, sha, size: content.length };
        })
      );
      results.push(...batchResults);

      // Delay between batches to avoid triggering rate limits
      if (i + UPLOAD_BATCH_SIZE < files.length) {
        await new Promise((resolve) => setTimeout(resolve, UPLOAD_INTER_BATCH_DELAY_MS));
      }
    }

    return results;
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
