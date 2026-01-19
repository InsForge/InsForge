import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  EdgeFunctionMetadataSchema,
  UploadFunctionRequest,
  UpdateFunctionRequest,
  FunctionSchema,
  ListFunctionsResponse,
} from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { DatabaseError, Pool } from 'pg';
import fetch from 'node-fetch';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { DenoSubhostingProvider } from '@/providers/functions/deno-subhosting.provider.js';
import { SecretService } from '@/services/secrets/secret.service.js';

export class FunctionService {
  private static instance: FunctionService;
  private pool: Pool | null = null;
  private denoSubhostingProvider: DenoSubhostingProvider;
  private secretService: SecretService;
  private cachedDeploymentUrl: string | null = null;
  private deploymentTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEPLOYMENT_DEBOUNCE_MS = 2000;

  private constructor() {
    this.denoSubhostingProvider = DenoSubhostingProvider.getInstance();
    this.secretService = SecretService.getInstance();
  }

  static getInstance(): FunctionService {
    if (!FunctionService.instance) {
      FunctionService.instance = new FunctionService();
    }
    return FunctionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      const dbManager = DatabaseManager.getInstance();
      this.pool = dbManager.getPool();
    }
    return this.pool;
  }

  /**
   * List all functions with runtime health check
   */
  async listFunctions(): Promise<ListFunctionsResponse> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          slug,
          name,
          description,
          status,
          created_at as "createdAt",
          updated_at as "updatedAt",
          deployed_at as "deployedAt"
        FROM functions.definitions
        ORDER BY created_at DESC`
      );

      const functions = result.rows;

      // Check if Deno runtime is healthy
      let runtimeHealthy = false;
      try {
        const denoUrl = process.env.DENO_RUNTIME_URL || 'http://localhost:7133';
        const healthResponse = await fetch(`${denoUrl}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000), // 2 second timeout
        });
        runtimeHealthy = healthResponse.ok;
      } catch (error) {
        logger.debug('Deno runtime health check failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return {
        functions,
        runtime: {
          status: runtimeHealthy ? 'running' : 'unavailable',
        },
      };
    } catch (error) {
      logger.error('Failed to list functions', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'listFunctions',
      });
      throw error;
    }
  }

  /**
   * Get a specific function by slug
   */
  async getFunction(slug: string): Promise<FunctionSchema | undefined> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          slug,
          name,
          description,
          code,
          status,
          created_at as "createdAt",
          updated_at as "updatedAt",
          deployed_at as "deployedAt"
        FROM functions.definitions
        WHERE slug = $1`,
        [slug]
      );

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to get function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'getFunction',
        slug,
      });
      throw error;
    }
  }

  /**
   * Create a new function
   */
  async createFunction(data: UploadFunctionRequest): Promise<FunctionSchema> {
    const client = await this.getPool().connect();
    try {
      const { name, code, description, status } = data;
      const slug = data.slug || name.toLowerCase().replace(/\s+/g, '-');

      // Basic security validation
      this.validateCode(code);

      // Generate UUID
      const id = crypto.randomUUID();

      // Insert function
      await client.query(
        `INSERT INTO functions.definitions (id, slug, name, description, code, status)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, slug, name, description || null, code, status]
      );

      // If status is active, update deployed_at
      if (status === 'active') {
        await client.query(
          `UPDATE functions.definitions SET deployed_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [id]
        );
      }

      // Fetch the created function
      const result = await client.query(
        `SELECT id, slug, name, description, status, created_at as "createdAt"
        FROM functions.definitions WHERE id = $1`,
        [id]
      );

      // Trigger deployment to Deno Subhosting (async, non-blocking)
      if (status === 'active') {
        this.scheduleDeployment();
      }

      return result.rows[0];
    } catch (error) {
      // Re-throw AppErrors as-is
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to create function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'createFunction',
      });

      // Handle unique constraint error
      if (error instanceof DatabaseError && error.code === '23505') {
        throw new AppError(
          'Function with this slug already exists',
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Update an existing function
   */
  async updateFunction(
    slug: string,
    updates: UpdateFunctionRequest
  ): Promise<FunctionSchema | null> {
    const client = await this.getPool().connect();
    try {
      // Check if function exists
      const existingResult = await client.query(
        'SELECT id FROM functions.definitions WHERE slug = $1',
        [slug]
      );
      if (existingResult.rows.length === 0) {
        return null;
      }

      // Validate code if provided
      if (updates.code !== undefined) {
        this.validateCode(updates.code);
      }

      // Update fields
      if (updates.name !== undefined) {
        await client.query('UPDATE functions.definitions SET name = $1 WHERE slug = $2', [
          updates.name,
          slug,
        ]);
      }

      if (updates.description !== undefined) {
        await client.query('UPDATE functions.definitions SET description = $1 WHERE slug = $2', [
          updates.description,
          slug,
        ]);
      }

      if (updates.code !== undefined) {
        await client.query('UPDATE functions.definitions SET code = $1 WHERE slug = $2', [
          updates.code,
          slug,
        ]);
      }

      if (updates.status !== undefined) {
        await client.query('UPDATE functions.definitions SET status = $1 WHERE slug = $2', [
          updates.status,
          slug,
        ]);

        // Update deployed_at if status changes to active
        if (updates.status === 'active') {
          await client.query(
            'UPDATE functions.definitions SET deployed_at = CURRENT_TIMESTAMP WHERE slug = $1',
            [slug]
          );
        }
      }

      // Update updated_at
      await client.query(
        'UPDATE functions.definitions SET updated_at = CURRENT_TIMESTAMP WHERE slug = $1',
        [slug]
      );

      // Fetch updated function
      const result = await client.query(
        `SELECT id, slug, name, description, status, updated_at as "updatedAt", deployed_at as "deployedAt"
        FROM functions.definitions WHERE slug = $1`,
        [slug]
      );

      // Trigger deployment if code or status changed
      const shouldDeploy = updates.code !== undefined || updates.status !== undefined;
      if (shouldDeploy) {
        this.scheduleDeployment();
      }

      return result.rows[0];
    } catch (error) {
      logger.error('Failed to update function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'updateFunction',
        slug,
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a function
   */
  async deleteFunction(slug: string): Promise<boolean> {
    try {
      const result = await this.getPool().query(
        'DELETE FROM functions.definitions WHERE slug = $1',
        [slug]
      );

      if (result.rowCount === 0) {
        return false;
      }

      // Trigger redeployment without the deleted function
      this.scheduleDeployment();

      return true;
    } catch (error) {
      logger.error('Failed to delete function', {
        error: error instanceof Error ? error.message : String(error),
        operation: 'deleteFunction',
        slug,
      });
      throw error;
    }
  }

  /**
   * Get functions metadata (public method for non-admin users)
   */
  async getMetadata(): Promise<Array<EdgeFunctionMetadataSchema>> {
    try {
      const result = await this.getPool().query(
        `SELECT slug, name, description, status
        FROM functions.definitions
        ORDER BY created_at DESC`
      );

      return result.rows as Array<EdgeFunctionMetadataSchema>;
    } catch (error) {
      logger.error('Failed to get edge functions metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Validate function code for dangerous patterns
   */
  private validateCode(code: string): void {
    const dangerousPatterns = [
      /Deno\.run/i,
      /Deno\.spawn/i,
      /Deno\.Command/i,
      /child_process/i,
      /process\.exit/i,
      /require\(['"]fs['"]\)/i,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw new AppError(
          `Code contains potentially dangerous pattern: ${pattern.toString()}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
    }
  }

  // ============================================
  // Deno Subhosting Integration
  // ============================================

  /**
   * Get the Deno Subhosting project ID for this InsForge instance
   * Format: {app_key}-functions (max 26 chars for Deno Subhosting)
   */
  private getDenoProjectId(): string {
    const appKey = process.env.APP_KEY || process.env.PROJECT_ID || 'local';
    return `${appKey}-functions`;
  }

  /**
   * Schedule a deployment with debouncing to coalesce rapid changes
   */
  private scheduleDeployment(): void {
    if (this.deploymentTimer) {
      clearTimeout(this.deploymentTimer);
    }
    this.deploymentTimer = setTimeout(() => {
      this.deploymentTimer = null;
      void this.triggerDeployment();
    }, FunctionService.DEPLOYMENT_DEBOUNCE_MS);
  }

  /**
   * Trigger deployment of all active functions to Deno Subhosting
   * This is called asynchronously after function CRUD operations
   */
  private async triggerDeployment(): Promise<void> {
    if (!this.denoSubhostingProvider.isConfigured()) {
      logger.debug('Deno Subhosting not configured, skipping deployment');
      return;
    }

    const projectId = this.getDenoProjectId();

    try {
      const activeFunctions = await this.getActiveFunctionsWithCode();
      const secrets = await this.getFunctionSecrets();
      const functionSlugs = activeFunctions.map((f) => f.slug);

      logger.info('Deploying to Deno Subhosting', {
        projectId,
        functionCount: activeFunctions.length,
        functions: functionSlugs,
      });

      const result = await this.denoSubhostingProvider.deployFunctions(
        projectId,
        activeFunctions,
        secrets
      );

      // Save initial deployment record
      await this.saveDeployment({
        id: result.id,
        projectId: result.projectId,
        status: 'pending',
        url: result.url,
        functionCount: activeFunctions.length,
        functions: functionSlugs,
      });

      logger.info('Deno Subhosting deployment created', {
        deploymentId: result.id,
        status: result.status,
        url: result.url,
      });

      // Poll for final status in background
      void this.pollDeploymentStatus(result.id, functionSlugs);
    } catch (error) {
      logger.error('Deno Subhosting deployment failed', {
        error: error instanceof Error ? error.message : String(error),
        projectId,
      });
      // Don't re-throw - this is a background operation
    }
  }

  /**
   * Poll for deployment status and update DB when complete
   */
  private async pollDeploymentStatus(deploymentId: string, functions: string[]): Promise<void> {
    try {
      const result = await this.denoSubhostingProvider.waitForDeployment(deploymentId);

      // Update deployment record with final status
      await this.updateDeployment(deploymentId, {
        status: result.status,
        url: result.url,
        errorMessage: result.errorMessage,
        errorFile: result.errorFile,
        errorFunction: result.errorFunction,
        buildLogs: result.buildLogs,
      });

      if (result.status === 'success') {
        // Update cached deployment URL
        if (result.url) {
          this.cachedDeploymentUrl = result.url;
        }
        logger.info('Deno Subhosting deployment succeeded', {
          deploymentId,
          url: result.url,
          functions,
        });
      } else {
        logger.error('Deno Subhosting deployment failed', {
          deploymentId,
          errorMessage: result.errorMessage,
          errorFile: result.errorFile,
          errorFunction: result.errorFunction,
        });
      }
    } catch (error) {
      logger.error('Error polling deployment status', {
        error: error instanceof Error ? error.message : String(error),
        deploymentId,
      });
    }
  }

  /**
   * Save deployment record to database
   */
  private async saveDeployment(deployment: {
    id: string;
    projectId: string;
    status: string;
    url: string | null;
    functionCount: number;
    functions: string[];
  }): Promise<void> {
    await this.getPool().query(
      `INSERT INTO functions.deployments (id, project_id, status, url, function_count, functions)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        deployment.id,
        deployment.projectId,
        deployment.status,
        deployment.url,
        deployment.functionCount,
        JSON.stringify(deployment.functions),
      ]
    );
  }

  /**
   * Update deployment record with final status
   */
  private async updateDeployment(
    deploymentId: string,
    update: {
      status: string;
      url: string | null;
      errorMessage?: string;
      errorFile?: string;
      errorFunction?: string;
      buildLogs?: string[];
    }
  ): Promise<void> {
    await this.getPool().query(
      `UPDATE functions.deployments
       SET status = $1, url = $2, error_message = $3, error_file = $4, error_function = $5, build_logs = $6
       WHERE id = $7`,
      [
        update.status,
        update.url,
        update.errorMessage || null,
        update.errorFile || null,
        update.errorFunction || null,
        update.buildLogs ? JSON.stringify(update.buildLogs) : null,
        deploymentId,
      ]
    );
  }

  /**
   * Check if Deno Subhosting is configured
   */
  isSubhostingConfigured(): boolean {
    return this.denoSubhostingProvider.isConfigured();
  }

  /**
   * Trigger redeployment of functions (public wrapper)
   * Used when secrets are updated to redeploy with new values
   */
  redeploy(): void {
    this.scheduleDeployment();
  }

  /**
   * Get the latest successful deployment URL (cached)
   */
  async getDeploymentUrl(): Promise<string | null> {
    // Return cached URL if available
    if (this.cachedDeploymentUrl) {
      return this.cachedDeploymentUrl;
    }

    try {
      const result = await this.getPool().query(
        `SELECT url FROM functions.deployments
         WHERE status = 'success' AND url IS NOT NULL
         ORDER BY created_at DESC LIMIT 1`
      );
      const url = result.rows[0]?.url || null;
      if (url) {
        this.cachedDeploymentUrl = url;
      }
      return url;
    } catch (error) {
      logger.error('Failed to get deployment URL', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Sync existing functions to Deno Subhosting on server startup
   * Only deploys if there's no existing successful deployment
   */
  async syncDeployment(): Promise<void> {
    if (!this.denoSubhostingProvider.isConfigured()) {
      logger.debug('Deno Subhosting not configured, skipping sync');
      return;
    }

    try {
      // Check if there's already a successful deployment
      const existingUrl = await this.getDeploymentUrl();
      if (existingUrl) {
        logger.info('Existing Deno Subhosting deployment found, skipping sync', {
          url: existingUrl,
        });
        return;
      }

      const activeFunctions = await this.getActiveFunctionsWithCode();

      if (activeFunctions.length === 0) {
        logger.debug('No active functions to sync');
        return;
      }

      logger.info('No existing deployment found, syncing functions to Deno Subhosting', {
        functionCount: activeFunctions.length,
        functions: activeFunctions.map((f) => f.slug),
      });

      await this.triggerDeployment();
    } catch (error) {
      logger.error('Failed to sync functions on startup', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - server should still start
    }
  }

  /**
   * Get all active functions with their code
   */
  private async getActiveFunctionsWithCode(): Promise<Array<{ slug: string; code: string }>> {
    const result = await this.getPool().query(
      `SELECT slug, code FROM functions.definitions WHERE status = 'active' ORDER BY created_at`
    );
    return result.rows;
  }

  /**
   * Get all active secrets for function injection
   */
  private async getFunctionSecrets(): Promise<Record<string, string>> {
    try {
      const secrets = await this.secretService.listSecrets();
      const secretMap: Record<string, string> = {};

      for (const secret of secrets) {
        if (secret.isActive) {
          const value = await this.secretService.getSecretByKey(secret.key);
          if (value) {
            secretMap[secret.key] = value;
          }
        }
      }

      return secretMap;
    } catch (error) {
      logger.warn('Failed to fetch secrets for deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }
}
