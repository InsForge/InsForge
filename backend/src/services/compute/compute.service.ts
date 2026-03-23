import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { config } from '@/infra/config/app.config.js';
import { AwsFargateProvider } from '@/providers/compute/aws-fargate.provider.js';
import type { ComputeProvider, LogOpts, LogStream } from '@/providers/compute/base.provider.js';
import type { ContainerSchema, ContainerDeploymentSchema } from '@insforge/shared-schemas';

// ─── Column whitelist ────────────────────────────────────────────────────────

const ALLOWED_UPDATE_COLUMNS = new Set([
  'name',
  'github_repo',
  'github_branch',
  'image_url',
  'dockerfile_path',
  'cpu',
  'memory',
  'port',
  'health_check_path',
  'auto_deploy',
  'replicas',
  'custom_domain',
  'env_vars_encrypted',
]);

// ─── Input types ─────────────────────────────────────────────────────────────

export interface CreateContainerInput {
  project_id: string;
  name: string;
  source_type: 'github' | 'image';
  github_repo?: string | null;
  github_branch?: string | null;
  image_url?: string | null;
  dockerfile_path?: string | null;
  cpu: number;
  memory: number;
  port: number;
  health_check_path?: string | null;
  auto_deploy?: boolean;
  replicas?: number;
  region?: string;
  env_vars?: Record<string, string>;
}

export interface UpdateContainerInput {
  name?: string;
  github_repo?: string | null;
  github_branch?: string | null;
  image_url?: string | null;
  dockerfile_path?: string | null;
  cpu?: number;
  memory?: number;
  port?: number;
  health_check_path?: string | null;
  auto_deploy?: boolean;
  replicas?: number;
  custom_domain?: string | null;
  env_vars?: Record<string, string>;
}

export interface DeployInput {
  container_id: string;
  triggered_by?: 'manual' | 'git_push' | 'rollback' | 'config_change' | 'cron';
  commit_sha?: string | null;
  github_token?: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ComputeService {
  private static instance: ComputeService;
  private pool: Pool | null = null;
  private provider: ComputeProvider | null = null;

  private constructor() {}

  public static getInstance(): ComputeService {
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

  /**
   * Initialize the compute provider (call once at startup).
   */
  async initialize(): Promise<void> {
    if (!config.compute.enabled) {
      logger.info('Compute feature disabled — skipping provider initialization');
      return;
    }

    if (config.compute.provider === 'aws_fargate') {
      this.provider = new AwsFargateProvider();
      await this.provider.initialize();
      logger.info('ComputeService initialized with AwsFargateProvider');
    } else {
      logger.warn('Unknown compute provider', { provider: config.compute.provider });
    }
  }

  // ─── Container CRUD ────────────────────────────────────────────────────────

  async createContainer(input: CreateContainerInput): Promise<ContainerSchema> {
    const pool = this.getPool();

    let envVarsEncrypted: string | null = null;
    if (input.env_vars && Object.keys(input.env_vars).length > 0) {
      envVarsEncrypted = EncryptionManager.encrypt(JSON.stringify(input.env_vars));
    }

    const result = await pool.query<ContainerSchema>(
      `INSERT INTO compute.containers (
        project_id, name, source_type,
        github_repo, github_branch, image_url, dockerfile_path,
        cpu, memory, port, health_check_path,
        auto_deploy, replicas, region, env_vars_encrypted
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING
        id, project_id, name, source_type,
        github_repo, github_branch, image_url, dockerfile_path,
        cpu, memory, port, health_check_path,
        status, endpoint_url, auto_deploy, replicas,
        custom_domain, region,
        last_deployed_at, created_at, updated_at`,
      [
        input.project_id,
        input.name,
        input.source_type,
        input.github_repo ?? null,
        input.github_branch ?? null,
        input.image_url ?? null,
        input.dockerfile_path ?? null,
        input.cpu,
        input.memory,
        input.port,
        input.health_check_path ?? null,
        input.auto_deploy ?? false,
        input.replicas ?? 1,
        input.region ?? 'us-east-1',
        envVarsEncrypted,
      ]
    );

    logger.info('Container created', { id: result.rows[0].id });
    return result.rows[0];
  }

  async getContainers(projectId: string): Promise<ContainerSchema[]> {
    const result = await this.getPool().query<ContainerSchema>(
      `SELECT
        id, project_id, name, source_type,
        github_repo, github_branch, image_url, dockerfile_path,
        cpu, memory, port, health_check_path,
        status, endpoint_url, auto_deploy, replicas,
        custom_domain, region,
        last_deployed_at, created_at, updated_at
       FROM compute.containers
       WHERE project_id = $1
       ORDER BY created_at DESC`,
      [projectId]
    );
    return result.rows;
  }

  async getContainer(id: string): Promise<ContainerSchema | null> {
    const result = await this.getPool().query<ContainerSchema>(
      `SELECT
        id, project_id, name, source_type,
        github_repo, github_branch, image_url, dockerfile_path,
        cpu, memory, port, health_check_path,
        status, endpoint_url, auto_deploy, replicas,
        custom_domain, region,
        last_deployed_at, created_at, updated_at
       FROM compute.containers
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async updateContainer(id: string, input: UpdateContainerInput): Promise<ContainerSchema | null> {
    const pool = this.getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    for (const [key, value] of Object.entries(input)) {
      if (key === 'env_vars') {
        // Handle env_vars separately — encrypt and store in env_vars_encrypted
        if (ALLOWED_UPDATE_COLUMNS.has('env_vars_encrypted')) {
          const encrypted =
            value && typeof value === 'object' && Object.keys(value as object).length > 0
              ? EncryptionManager.encrypt(JSON.stringify(value))
              : null;
          setClauses.push(`env_vars_encrypted = $${paramCount++}`);
          values.push(encrypted);
        }
      } else if (ALLOWED_UPDATE_COLUMNS.has(key)) {
        setClauses.push(`${key} = $${paramCount++}`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      return this.getContainer(id);
    }

    values.push(id);

    const result = await pool.query<ContainerSchema>(
      `UPDATE compute.containers
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING
         id, project_id, name, source_type,
         github_repo, github_branch, image_url, dockerfile_path,
         cpu, memory, port, health_check_path,
         status, endpoint_url, auto_deploy, replicas,
         custom_domain, region,
         last_deployed_at, created_at, updated_at`,
      values
    );

    logger.info('Container updated', { id });
    return result.rows[0] ?? null;
  }

  async deleteContainer(id: string): Promise<boolean> {
    const result = await this.getPool().query(
      'DELETE FROM compute.containers WHERE id = $1',
      [id]
    );
    const success = (result.rowCount ?? 0) > 0;
    if (success) {
      logger.info('Container deleted', { id });
    }
    return success;
  }

  // ─── Deployment env var helper ─────────────────────────────────────────────

  private async getDecryptedEnvVars(containerId: string): Promise<Record<string, string>> {
    const result = await this.getPool().query<{ env_vars_encrypted: string | null }>(
      'SELECT env_vars_encrypted FROM compute.containers WHERE id = $1',
      [containerId]
    );
    const row = result.rows[0];
    if (!row || !row.env_vars_encrypted) {
      return {};
    }
    try {
      return JSON.parse(EncryptionManager.decrypt(row.env_vars_encrypted)) as Record<string, string>;
    } catch {
      logger.error('Failed to decrypt env vars', { containerId });
      return {};
    }
  }

  // ─── Deploy pipeline ───────────────────────────────────────────────────────

  async deploy(input: DeployInput): Promise<ContainerDeploymentSchema> {
    const pool = this.getPool();

    // Guard: reject if another deploy is in-flight
    const inFlight = await pool.query(
      `SELECT id FROM compute.deployments
       WHERE container_id = $1
       AND status IN ('pending','building','pushing','deploying')
       LIMIT 1`,
      [input.container_id]
    );
    if (inFlight.rows.length > 0) {
      throw new Error('A deployment is already in progress for this container');
    }

    const imageTag = `deploy-${Date.now()}`;

    const result = await pool.query<ContainerDeploymentSchema>(
      `INSERT INTO compute.deployments
         (container_id, status, triggered_by, commit_sha, image_tag, started_at)
       VALUES ($1, 'pending', $2, $3, $4, NOW())
       RETURNING
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at`,
      [
        input.container_id,
        input.triggered_by ?? 'manual',
        input.commit_sha ?? null,
        imageTag,
      ]
    );

    const deployment = result.rows[0];

    // Fire-and-forget
    this.executeDeploy(deployment, input.github_token).catch((err: unknown) => {
      logger.error('executeDeploy uncaught error', { deploymentId: deployment.id, err });
    });

    return deployment;
  }

  private async setDeploymentStatus(
    deploymentId: string,
    status: ContainerDeploymentSchema['status'],
    extra: {
      error_message?: string;
      build_log_url?: string;
      image_tag?: string;
    } = {}
  ): Promise<void> {
    const setClauses = ['status = $2'];
    const values: unknown[] = [deploymentId, status];
    let paramCount = 3;

    if (extra.error_message !== undefined) {
      setClauses.push(`error_message = $${paramCount++}`);
      values.push(extra.error_message);
    }
    if (extra.build_log_url !== undefined) {
      setClauses.push(`build_log_url = $${paramCount++}`);
      values.push(extra.build_log_url);
    }
    if (extra.image_tag !== undefined) {
      setClauses.push(`image_tag = $${paramCount++}`);
      values.push(extra.image_tag);
    }

    const isTerminal = status === 'live' || status === 'failed';
    if (isTerminal) {
      setClauses.push(`finished_at = NOW()`);
    }

    await this.getPool().query(
      `UPDATE compute.deployments SET ${setClauses.join(', ')} WHERE id = $1`,
      values
    );
  }

  private async setContainerStatus(
    containerId: string,
    status: ContainerSchema['status'],
    extra: { endpoint_url?: string } = {}
  ): Promise<void> {
    const setClauses = ['status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [containerId, status];
    let paramCount = 3;

    if (extra.endpoint_url !== undefined) {
      setClauses.push(`endpoint_url = $${paramCount++}`);
      values.push(extra.endpoint_url);
    }
    if (status === 'running') {
      setClauses.push(`last_deployed_at = NOW()`);
    }

    await this.getPool().query(
      `UPDATE compute.containers SET ${setClauses.join(', ')} WHERE id = $1`,
      values
    );
  }

  private async executeDeploy(
    deployment: ContainerDeploymentSchema,
    githubToken?: string
  ): Promise<void> {
    const pool = this.getPool();

    const containerResult = await pool.query(
      `SELECT
         id, project_id, name, source_type,
         github_repo, github_branch, image_url, dockerfile_path,
         cpu, memory, port, health_check_path,
         status, endpoint_url, auto_deploy, replicas,
         custom_domain, region, last_deployed_at, created_at, updated_at
       FROM compute.containers WHERE id = $1`,
      [deployment.container_id]
    );

    if (!containerResult.rows.length) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        error_message: 'Container not found',
      });
      return;
    }

    const container = containerResult.rows[0] as ContainerSchema;
    const provider = this.provider;

    if (!provider) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        error_message: 'Compute provider not configured',
      });
      await this.setContainerStatus(container.id, 'failed');
      return;
    }

    // Fetch project slug for routing
    const projectResult = await pool.query<{ slug: string }>(
      `SELECT slug FROM projects WHERE id = $1`,
      [container.project_id]
    );
    const projectSlug = projectResult.rows[0]?.slug ?? container.project_id;

    let imageUri: string;

    try {
      if (container.source_type === 'github') {
        // ── BUILD phase ────────────────────────────────────────────────────
        if (!container.github_repo || !container.github_branch) {
          throw new Error('github_repo and github_branch are required for github source');
        }
        if (!githubToken) {
          throw new Error('github_token is required to build from GitHub source');
        }

        await this.setDeploymentStatus(deployment.id, 'building');
        await this.setContainerStatus(container.id, 'building');

        const buildResult = await provider.buildImage({
          containerId: container.id,
          githubRepo: container.github_repo,
          githubBranch: container.github_branch,
          dockerfilePath: container.dockerfile_path ?? 'Dockerfile',
          githubToken,
          imageTag: deployment.image_tag ?? `deploy-${Date.now()}`,
        });

        // Poll build status — 10s intervals, 15min timeout
        const buildTimeout = Date.now() + 15 * 60 * 1000;
        let buildStatus = 'IN_PROGRESS';
        while (buildStatus === 'IN_PROGRESS' || buildStatus === 'QUEUED') {
          if (Date.now() > buildTimeout) {
            throw new Error('Build timed out after 15 minutes');
          }
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          const statusResult = await provider.getBuildStatus(buildResult.buildId);
          buildStatus = statusResult.status;
          if (statusResult.logUrl) {
            await this.setDeploymentStatus(deployment.id, 'building', {
              build_log_url: statusResult.logUrl,
            });
          }
        }

        if (buildStatus !== 'SUCCEEDED') {
          throw new Error(`Build failed with status: ${buildStatus}`);
        }

        imageUri = buildResult.imageUri;

        // ── PUSH phase (image is already in ECR, just update status) ──────
        await this.setDeploymentStatus(deployment.id, 'pushing', {
          image_tag: deployment.image_tag ?? undefined,
        });
      } else {
        // image source — use provided image_url directly
        if (!container.image_url) {
          throw new Error('image_url is required for image source type');
        }
        imageUri = container.image_url;
      }

      // ── DEPLOY phase ───────────────────────────────────────────────────
      await this.setDeploymentStatus(deployment.id, 'deploying');
      await this.setContainerStatus(container.id, 'deploying');

      // Decrypt env vars and inject PORT
      const envVars = await this.getDecryptedEnvVars(container.id);
      envVars['PORT'] = String(container.port);
      // TODO: inject INSFORGE_DB_URL etc.

      // Check if container already has a target group (subsequent deploy)
      const routeResult = await pool.query<{
        target_group_arn: string | null;
        rule_arn: string | null;
        service_arn: string | null;
        task_def_arn: string | null;
      }>(
        `SELECT target_group_arn, rule_arn, service_arn, task_def_arn
         FROM compute.container_routes
         WHERE container_id = $1
         LIMIT 1`,
        [container.id]
      );

      const existingRoute = routeResult.rows[0];
      const isFirstDeploy = !existingRoute?.target_group_arn;

      const deployResult = await provider.deploy({
        containerId: container.id,
        imageUri,
        cpu: container.cpu,
        memory: container.memory,
        port: container.port,
        healthCheckPath: container.health_check_path ?? '/health',
        envVars,
        projectSlug,
      });

      // On first deploy, store route info
      if (isFirstDeploy) {
        await pool.query(
          `INSERT INTO compute.container_routes
             (container_id, target_group_arn, rule_arn, service_arn, task_def_arn, endpoint_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (container_id) DO UPDATE SET
             target_group_arn = EXCLUDED.target_group_arn,
             rule_arn = EXCLUDED.rule_arn,
             service_arn = EXCLUDED.service_arn,
             task_def_arn = EXCLUDED.task_def_arn,
             endpoint_url = EXCLUDED.endpoint_url`,
          [
            container.id,
            deployResult.serviceArn, // We'll store serviceArn here; target_group_arn handled by provider
            null,
            deployResult.serviceArn,
            deployResult.taskDefArn,
            deployResult.endpointUrl,
          ]
        );
      } else {
        // Update existing route with new task def
        await pool.query(
          `UPDATE compute.container_routes
           SET task_def_arn = $2, service_arn = $3, endpoint_url = $4
           WHERE container_id = $1`,
          [container.id, deployResult.taskDefArn, deployResult.serviceArn, deployResult.endpointUrl]
        );
      }

      // Mark deployment as live, mark all others inactive
      await this.setDeploymentStatus(deployment.id, 'live');
      await pool.query(
        `UPDATE compute.deployments SET is_active = false WHERE container_id = $1 AND id != $2`,
        [container.id, deployment.id]
      );
      await pool.query(
        `UPDATE compute.deployments SET is_active = true WHERE id = $1`,
        [deployment.id]
      );

      await this.setContainerStatus(container.id, 'running', {
        endpoint_url: deployResult.endpointUrl,
      });

      logger.info('Deployment succeeded', {
        deploymentId: deployment.id,
        containerId: container.id,
        endpointUrl: deployResult.endpointUrl,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Deployment failed', {
        deploymentId: deployment.id,
        containerId: container.id,
        error: errorMessage,
      });
      await this.setDeploymentStatus(deployment.id, 'failed', { error_message: errorMessage });
      await this.setContainerStatus(container.id, 'failed');
    }
  }

  async getDeployments(containerId: string): Promise<ContainerDeploymentSchema[]> {
    const result = await this.getPool().query<ContainerDeploymentSchema>(
      `SELECT
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at
       FROM compute.deployments
       WHERE container_id = $1
       ORDER BY started_at DESC`,
      [containerId]
    );
    return result.rows;
  }

  async getDeployment(id: string): Promise<ContainerDeploymentSchema | null> {
    const result = await this.getPool().query<ContainerDeploymentSchema>(
      `SELECT
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at
       FROM compute.deployments
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Rollback — creates a new deployment using a previous deployment's image_tag.
   * Skips the build phase and goes straight to deploy.
   */
  async rollback(containerId: string, targetDeploymentId: string): Promise<ContainerDeploymentSchema> {
    const pool = this.getPool();

    // Guard: reject if another deploy is in-flight
    const inFlight = await pool.query(
      `SELECT id FROM compute.deployments
       WHERE container_id = $1
       AND status IN ('pending','building','pushing','deploying')
       LIMIT 1`,
      [containerId]
    );
    if (inFlight.rows.length > 0) {
      throw new Error('A deployment is already in progress for this container');
    }

    // Fetch target deployment to get its image_tag
    const targetResult = await pool.query<ContainerDeploymentSchema>(
      `SELECT id, image_tag FROM compute.deployments WHERE id = $1 AND container_id = $2`,
      [targetDeploymentId, containerId]
    );
    if (!targetResult.rows.length) {
      throw new Error('Target deployment not found');
    }

    const targetImageTag = targetResult.rows[0].image_tag;
    if (!targetImageTag) {
      throw new Error('Target deployment has no image_tag — cannot rollback');
    }

    const result = await pool.query<ContainerDeploymentSchema>(
      `INSERT INTO compute.deployments
         (container_id, status, triggered_by, image_tag, started_at)
       VALUES ($1, 'pending', 'rollback', $2, NOW())
       RETURNING
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at`,
      [containerId, targetImageTag]
    );

    const deployment = result.rows[0];

    // Fire-and-forget rollback deploy
    this.executeRollbackDeploy(deployment).catch((err: unknown) => {
      logger.error('executeRollbackDeploy uncaught error', { deploymentId: deployment.id, err });
    });

    return deployment;
  }

  private async executeRollbackDeploy(deployment: ContainerDeploymentSchema): Promise<void> {
    const pool = this.getPool();

    const containerResult = await pool.query(
      `SELECT
         id, project_id, name, source_type,
         github_repo, github_branch, image_url, dockerfile_path,
         cpu, memory, port, health_check_path,
         status, endpoint_url, auto_deploy, replicas,
         custom_domain, region, last_deployed_at, created_at, updated_at
       FROM compute.containers WHERE id = $1`,
      [deployment.container_id]
    );

    if (!containerResult.rows.length) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        error_message: 'Container not found',
      });
      return;
    }

    const container = containerResult.rows[0] as ContainerSchema;
    const provider = this.provider;

    if (!provider) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        error_message: 'Compute provider not configured',
      });
      await this.setContainerStatus(container.id, 'failed');
      return;
    }

    const projectResult = await pool.query<{ slug: string }>(
      `SELECT slug FROM projects WHERE id = $1`,
      [container.project_id]
    );
    const projectSlug = projectResult.rows[0]?.slug ?? container.project_id;

    try {
      await this.setDeploymentStatus(deployment.id, 'deploying');
      await this.setContainerStatus(container.id, 'deploying');

      const envVars = await this.getDecryptedEnvVars(container.id);
      envVars['PORT'] = String(container.port);

      // Build imageUri from the stored image_tag
      const imageUri = `${config.compute.ecrRegistry}/${container.id}:${deployment.image_tag}`;

      const deployResult = await provider.deploy({
        containerId: container.id,
        imageUri,
        cpu: container.cpu,
        memory: container.memory,
        port: container.port,
        healthCheckPath: container.health_check_path ?? '/health',
        envVars,
        projectSlug,
      });

      // Update route record
      await pool.query(
        `UPDATE compute.container_routes
         SET task_def_arn = $2, service_arn = $3, endpoint_url = $4
         WHERE container_id = $1`,
        [container.id, deployResult.taskDefArn, deployResult.serviceArn, deployResult.endpointUrl]
      );

      await this.setDeploymentStatus(deployment.id, 'live');
      await pool.query(
        `UPDATE compute.deployments SET is_active = false WHERE container_id = $1 AND id != $2`,
        [container.id, deployment.id]
      );
      await pool.query(
        `UPDATE compute.deployments SET is_active = true WHERE id = $1`,
        [deployment.id]
      );

      await this.setContainerStatus(container.id, 'running', {
        endpoint_url: deployResult.endpointUrl,
      });

      logger.info('Rollback deployment succeeded', {
        deploymentId: deployment.id,
        containerId: container.id,
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Rollback deployment failed', {
        deploymentId: deployment.id,
        containerId: container.id,
        error: errorMessage,
      });
      await this.setDeploymentStatus(deployment.id, 'failed', { error_message: errorMessage });
      await this.setContainerStatus(container.id, 'failed');
    }
  }

  async getContainerLogs(
    containerId: string,
    opts: LogOpts = {}
  ): Promise<LogStream> {
    const provider = this.provider;
    if (!provider) {
      throw new Error('Compute provider not configured');
    }

    // Fetch the service ARN from container routes
    const routeResult = await this.getPool().query<{ service_arn: string | null }>(
      `SELECT service_arn FROM compute.container_routes WHERE container_id = $1 LIMIT 1`,
      [containerId]
    );

    const serviceArn = routeResult.rows[0]?.service_arn;
    if (!serviceArn) {
      throw new Error('No deployed service found for this container');
    }

    return provider.getLogs(serviceArn, opts);
  }
}
