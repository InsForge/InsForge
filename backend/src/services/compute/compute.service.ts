import { DatabaseManager } from '@/infra/database/database.manager.js';
import { Pool } from 'pg';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AwsFargateProvider } from '@/providers/compute/aws-fargate.provider.js';
import type { ComputeProvider } from '@/providers/compute/base.provider.js';
import type { ContainerSchema, ContainerDeploymentSchema } from '@insforge/shared-schemas';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';

interface ContainerRow {
  id: string;
  project_id: string;
  name: string;
  source_type: string;
  github_repo: string | null;
  github_branch: string | null;
  dockerfile_path: string | null;
  image_url: string | null;
  cpu: number;
  memory: number;
  port: number;
  health_check_path: string;
  auto_deploy: boolean;
  status: string;
  endpoint_url: string | null;
  created_at: string;
  updated_at: string;
}

interface DeploymentRow {
  id: string;
  container_id: string;
  status: string;
  image_uri: string | null;
  image_tag: string | null;
  triggered_by: string;
  is_active: boolean;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

interface RouteRow {
  id: string;
  container_id: string;
  service_arn: string | null;
  task_def_arn: string | null;
  target_group_arn: string | null;
  rule_arn: string | null;
  endpoint_url: string | null;
}

function mapContainerRow(row: ContainerRow): ContainerSchema {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sourceType: row.source_type as ContainerSchema['sourceType'],
    githubRepo: row.github_repo,
    githubBranch: row.github_branch,
    dockerfilePath: row.dockerfile_path,
    imageUrl: row.image_url,
    cpu: row.cpu,
    memory: row.memory,
    port: row.port,
    healthCheckPath: row.health_check_path,
    autoDeploy: row.auto_deploy,
    status: row.status as ContainerSchema['status'],
    endpointUrl: row.endpoint_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeploymentRow(row: DeploymentRow): ContainerDeploymentSchema {
  return {
    id: row.id,
    containerId: row.container_id,
    status: row.status as ContainerDeploymentSchema['status'],
    imageUri: row.image_uri,
    imageTag: row.image_tag,
    triggeredBy: row.triggered_by,
    isActive: row.is_active,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ComputeService {
  private static instance: ComputeService;
  private pool: Pool | null = null;
  private provider: ComputeProvider;

  private constructor() {
    this.provider = AwsFargateProvider.getInstance();
  }

  static getInstance(): ComputeService {
    if (!ComputeService.instance) {
      ComputeService.instance = new ComputeService();
    }
    return ComputeService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────────

  async listContainers(projectId: string): Promise<ContainerSchema[]> {
    const result = await this.getPool().query<ContainerRow>(
      `SELECT * FROM compute.containers WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return result.rows.map(mapContainerRow);
  }

  async getContainer(id: string): Promise<ContainerSchema | null> {
    const result = await this.getPool().query<ContainerRow>(
      `SELECT * FROM compute.containers WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapContainerRow(result.rows[0]) : null;
  }

  async createContainer(input: {
    projectId: string;
    name: string;
    sourceType: string;
    githubRepo?: string;
    githubBranch?: string;
    dockerfilePath?: string;
    imageUrl?: string;
    cpu: number;
    memory: number;
    port: number;
    healthCheckPath: string;
    autoDeploy: boolean;
  }): Promise<ContainerSchema> {
    const result = await this.getPool().query<ContainerRow>(
      `INSERT INTO compute.containers
         (project_id, name, source_type, github_repo, github_branch, dockerfile_path, image_url, cpu, memory, port, health_check_path, auto_deploy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        input.projectId,
        input.name,
        input.sourceType,
        input.githubRepo ?? null,
        input.githubBranch ?? 'main',
        input.dockerfilePath ?? './Dockerfile',
        input.imageUrl ?? null,
        input.cpu,
        input.memory,
        input.port,
        input.healthCheckPath,
        input.autoDeploy,
      ]
    );
    return mapContainerRow(result.rows[0]);
  }

  async updateContainer(id: string, data: Record<string, unknown>): Promise<ContainerSchema> {
    const allowedFields: Record<string, string> = {
      name: 'name',
      githubBranch: 'github_branch',
      imageUrl: 'image_url',
      dockerfilePath: 'dockerfile_path',
      cpu: 'cpu',
      memory: 'memory',
      port: 'port',
      healthCheckPath: 'health_check_path',
      autoDeploy: 'auto_deploy',
    };

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    for (const [key, dbColumn] of Object.entries(allowedFields)) {
      if (data[key] !== undefined) {
        setClauses.push(`${dbColumn} = $${paramIndex}`);
        values.push(data[key]);
        paramIndex++;
      }
    }

    // Handle encrypted env vars separately
    if (data.envVars && typeof data.envVars === 'object') {
      const encrypted = EncryptionManager.encrypt(JSON.stringify(data.envVars));
      setClauses.push(`env_vars_encrypted = $${paramIndex}`);
      values.push(encrypted);
      paramIndex++;
    }

    if (setClauses.length === 0) {
      const existing = await this.getContainer(id);
      if (!existing) {
        throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
      }
      return existing;
    }

    values.push(id);
    const result = await this.getPool().query<ContainerRow>(
      `UPDATE compute.containers SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
    }
    return mapContainerRow(result.rows[0]);
  }

  async deleteContainer(id: string): Promise<void> {
    const pool = this.getPool();

    // Fetch route info before attempting teardown
    const routeResult = await pool.query<RouteRow>(
      `SELECT * FROM compute.container_routes WHERE container_id = $1`,
      [id]
    );
    const route = routeResult.rows[0];

    // If we have cloud resources, tear them down FIRST
    if (route?.service_arn && this.provider.isConfigured()) {
      try {
        await this.provider.teardown({
          serviceArn: route.service_arn,
          targetGroupArn: route.target_group_arn ?? '',
          ruleArn: route.rule_arn ?? '',
        });
      } catch (error) {
        // Mark container as teardown_failed — do NOT delete the row
        logger.error('AWS teardown failed, keeping DB rows for retry', {
          containerId: id,
          error: String(error),
        });
        await pool.query(`UPDATE compute.containers SET status = 'teardown_failed' WHERE id = $1`, [
          id,
        ]);
        throw new AppError(
          'Failed to tear down cloud resources. Container marked for retry.',
          500,
          ERROR_CODES.COMPUTE_TEARDOWN_FAILED
        );
      }
    }

    // Teardown succeeded (or no cloud resources) — safe to delete
    await pool.query(`DELETE FROM compute.containers WHERE id = $1`, [id]);
  }

  // ─── Deployments ──────────────────────────────────────────────────────────────

  async listDeployments(containerId: string): Promise<ContainerDeploymentSchema[]> {
    const result = await this.getPool().query<DeploymentRow>(
      `SELECT * FROM compute.deployments WHERE container_id = $1 ORDER BY created_at DESC`,
      [containerId]
    );
    return result.rows.map(mapDeploymentRow);
  }

  async getDeployment(id: string): Promise<ContainerDeploymentSchema | null> {
    const result = await this.getPool().query<DeploymentRow>(
      `SELECT * FROM compute.deployments WHERE id = $1`,
      [id]
    );
    return result.rows[0] ? mapDeploymentRow(result.rows[0]) : null;
  }

  // ─── Deploy pipeline ─────────────────────────────────────────────────────────

  /**
   * Initiate a deployment. Creates a pending deployment record inside a transaction
   * (atomic with the in-flight check), then kicks off the async deploy pipeline.
   * Returns the deployment record immediately.
   */
  async deploy(input: {
    containerId: string;
    triggeredBy: string;
    githubToken?: string;
  }): Promise<ContainerDeploymentSchema> {
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Lock the container row to serialize concurrent deploys
      const containerResult = await client.query<ContainerRow>(
        `SELECT * FROM compute.containers WHERE id = $1 FOR UPDATE`,
        [input.containerId]
      );
      if (containerResult.rows.length === 0) {
        throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
      }

      // The partial unique index enforces at most one in-flight deployment,
      // but we check explicitly for a better error message
      const inFlight = await client.query(
        `SELECT id FROM compute.deployments
         WHERE container_id = $1 AND status IN ('pending', 'building', 'pushing', 'deploying')`,
        [input.containerId]
      );
      if (inFlight.rows.length > 0) {
        throw new AppError(
          'A deployment is already in progress for this container',
          409,
          ERROR_CODES.COMPUTE_DEPLOY_IN_PROGRESS
        );
      }

      const deployResult = await client.query<DeploymentRow>(
        `INSERT INTO compute.deployments (container_id, status, triggered_by)
         VALUES ($1, 'pending', $2)
         RETURNING *`,
        [input.containerId, input.triggeredBy]
      );

      await client.query('COMMIT');

      const deployment = mapDeploymentRow(deployResult.rows[0]);
      const container = mapContainerRow(containerResult.rows[0]);

      // Fire-and-forget the async pipeline
      void this.executeDeploy(container, deployment, input.githubToken);

      return deployment;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Rollback to a previous deployment's image.
   */
  async rollback(input: {
    containerId: string;
    deploymentId: string;
  }): Promise<ContainerDeploymentSchema> {
    const targetDeployment = await this.getDeployment(input.deploymentId);
    if (!targetDeployment || targetDeployment.containerId !== input.containerId) {
      throw new AppError('Target deployment not found', 404, ERROR_CODES.NOT_FOUND);
    }
    if (!targetDeployment.imageUri) {
      throw new AppError(
        'Target deployment has no image URI to rollback to',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    // Create a new deployment record for the rollback
    const deployment = await this.deploy({
      containerId: input.containerId,
      triggeredBy: 'rollback',
    });

    // Override the image URI on the new deployment so executeDeploy uses it
    await this.getPool().query(
      `UPDATE compute.deployments SET image_uri = $1, image_tag = $2 WHERE id = $3`,
      [targetDeployment.imageUri, targetDeployment.imageTag, deployment.id]
    );

    return deployment;
  }

  // ─── Logs ─────────────────────────────────────────────────────────────────────

  async getContainerLogs(
    containerId: string,
    options?: { limit?: number; startTime?: number; nextToken?: string }
  ) {
    if (!this.provider.isConfigured()) {
      throw new AppError(
        'Compute provider not configured',
        503,
        ERROR_CODES.COMPUTE_NOT_CONFIGURED
      );
    }
    return this.provider.getLogs(containerId, options);
  }

  // ─── Async deploy pipeline (never throws) ────────────────────────────────────

  private async executeDeploy(
    container: ContainerSchema,
    deployment: ContainerDeploymentSchema,
    githubToken?: string
  ): Promise<void> {
    const pool = this.getPool();

    try {
      await this.setContainerStatus(container.id, 'deploying');

      if (!this.provider.isConfigured()) {
        throw new Error('Compute provider is not configured');
      }

      // Resolve image URI
      let imageUri = deployment.imageUri ?? '';
      let imageTag = deployment.imageTag ?? '';

      if (!imageUri) {
        if (container.sourceType === 'github') {
          // Build phase
          await this.setDeploymentStatus(deployment.id, 'building');
          const buildResult = await this.provider.buildImage({
            containerId: container.id,
            githubRepo: container.githubRepo ?? '',
            githubBranch: container.githubBranch ?? 'main',
            dockerfilePath: container.dockerfilePath ?? './Dockerfile',
            githubToken,
          });
          imageUri = buildResult.imageUri;
          imageTag = buildResult.imageTag;
        } else {
          // Image source: use the URL directly
          imageUri = container.imageUrl ?? '';
          imageTag = '';
        }
      }

      // Store the resolved image URI on the deployment record
      await pool.query(
        `UPDATE compute.deployments SET image_uri = $1, image_tag = $2 WHERE id = $3`,
        [imageUri, imageTag || null, deployment.id]
      );

      await this.setDeploymentStatus(deployment.id, 'deploying');

      // Resolve env vars
      const envVars = await this.getDecryptedEnvVars(container.id);
      const projectSlug = container.name
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .slice(0, 60);

      // Check if this is first deploy or redeploy
      const routeResult = await pool.query<RouteRow>(
        `SELECT * FROM compute.container_routes WHERE container_id = $1`,
        [container.id]
      );
      const existingRoute = routeResult.rows[0];

      if (!existingRoute) {
        // First deploy → provision infrastructure
        const result = await this.provider.provision({
          containerId: container.id,
          projectSlug,
          imageUri,
          port: container.port,
          cpu: container.cpu,
          memory: container.memory,
          healthCheckPath: container.healthCheckPath,
          envVars,
        });

        // Persist route info
        await pool.query(
          `INSERT INTO compute.container_routes
             (container_id, service_arn, task_def_arn, target_group_arn, rule_arn, endpoint_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            container.id,
            result.serviceArn,
            result.taskDefArn,
            result.targetGroupArn,
            result.ruleArn,
            result.endpointUrl,
          ]
        );

        await pool.query(`UPDATE compute.containers SET endpoint_url = $1 WHERE id = $2`, [
          result.endpointUrl,
          container.id,
        ]);
      } else {
        // Redeploy → update existing service
        const result = await this.provider.updateService({
          containerId: container.id,
          serviceArn: existingRoute.service_arn ?? '',
          imageUri,
          port: container.port,
          cpu: container.cpu,
          memory: container.memory,
          healthCheckPath: container.healthCheckPath,
          envVars,
        });

        await pool.query(
          `UPDATE compute.container_routes
           SET task_def_arn = $1, service_arn = $2
           WHERE container_id = $3`,
          [result.taskDefArn, result.serviceArn, container.id]
        );
      }

      // Mark deployment as live, deactivate previous
      await pool.query(
        `UPDATE compute.deployments SET is_active = (id = $1) WHERE container_id = $2`,
        [deployment.id, container.id]
      );
      await this.setDeploymentStatus(deployment.id, 'live');
      await this.setContainerStatus(container.id, 'running');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Deployment failed', {
        deploymentId: deployment.id,
        containerId: container.id,
        error: errorMessage,
      });
      await this.setDeploymentStatus(deployment.id, 'failed', errorMessage);

      // Only mark container as failed if it wasn't already running
      const current = await this.getContainer(container.id);
      if (current && current.status !== 'running') {
        await this.setContainerStatus(container.id, 'failed');
      }
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async setContainerStatus(id: string, status: string): Promise<void> {
    await this.getPool().query(`UPDATE compute.containers SET status = $1 WHERE id = $2`, [
      status,
      id,
    ]);
  }

  private async setDeploymentStatus(
    id: string,
    status: string,
    errorMessage?: string
  ): Promise<void> {
    if (errorMessage) {
      await this.getPool().query(
        `UPDATE compute.deployments SET status = $1, error_message = $2 WHERE id = $3`,
        [status, errorMessage, id]
      );
    } else {
      await this.getPool().query(`UPDATE compute.deployments SET status = $1 WHERE id = $2`, [
        status,
        id,
      ]);
    }
  }

  private async getDecryptedEnvVars(containerId: string): Promise<Record<string, string>> {
    const result = await this.getPool().query<{ env_vars_encrypted: string | null }>(
      `SELECT env_vars_encrypted FROM compute.containers WHERE id = $1`,
      [containerId]
    );
    const row = result.rows[0];
    if (!row?.env_vars_encrypted) {
      return {};
    }
    try {
      return JSON.parse(EncryptionManager.decrypt(row.env_vars_encrypted)) as Record<
        string,
        string
      >;
    } catch (error) {
      logger.error('Failed to decrypt env vars — aborting deploy', {
        containerId,
        error: String(error),
      });
      throw new Error('Stored environment variables could not be decrypted');
    }
  }
}
