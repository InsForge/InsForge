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
  projectId: string;
  name: string;
  sourceType: 'github' | 'image';
  githubRepo?: string | null;
  githubBranch?: string | null;
  imageUrl?: string | null;
  dockerfilePath?: string | null;
  cpu: number;
  memory: number;
  port: number;
  healthCheckPath?: string | null;
  autoDeploy?: boolean;
  replicas?: number;
  region?: string;
  envVars?: Record<string, string>;
}

export interface UpdateContainerInput {
  name?: string;
  githubRepo?: string | null;
  githubBranch?: string | null;
  imageUrl?: string | null;
  dockerfilePath?: string | null;
  cpu?: number;
  memory?: number;
  port?: number;
  healthCheckPath?: string | null;
  autoDeploy?: boolean;
  replicas?: number;
  customDomain?: string | null;
  envVars?: Record<string, string>;
}

export interface DeployInput {
  containerId: string;
  triggeredBy?: 'manual' | 'git_push' | 'rollback' | 'config_change' | 'cron';
  commitSha?: string | null;
  githubToken?: string;
}

// ─── Row type returned by SQL queries (snake_case DB columns) ────────────────

interface ContainerRow {
  id: string;
  project_id: string;
  name: string;
  source_type: string;
  github_repo: string | null;
  github_branch: string | null;
  image_url: string | null;
  dockerfile_path: string | null;
  cpu: number;
  memory: number;
  port: number;
  health_check_path: string | null;
  status: string;
  endpoint_url: string | null;
  auto_deploy: boolean;
  replicas: number;
  custom_domain: string | null;
  region: string;
  last_deployed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DeploymentRow {
  id: string;
  container_id: string;
  commit_sha: string | null;
  image_tag: string | null;
  build_log_url: string | null;
  status: string;
  error_message: string | null;
  triggered_by: string;
  is_active: boolean;
  started_at: string;
  finished_at: string | null;
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function mapContainerRow(row: ContainerRow): ContainerSchema {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    sourceType: row.source_type as ContainerSchema['sourceType'],
    githubRepo: row.github_repo,
    githubBranch: row.github_branch,
    imageUrl: row.image_url,
    dockerfilePath: row.dockerfile_path,
    cpu: row.cpu,
    memory: row.memory,
    port: row.port,
    healthCheckPath: row.health_check_path,
    status: row.status as ContainerSchema['status'],
    endpointUrl: row.endpoint_url,
    autoDeploy: row.auto_deploy,
    replicas: row.replicas,
    customDomain: row.custom_domain,
    region: row.region,
    lastDeployedAt: row.last_deployed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDeploymentRow(row: DeploymentRow): ContainerDeploymentSchema {
  return {
    id: row.id,
    containerId: row.container_id,
    commitSha: row.commit_sha,
    imageTag: row.image_tag,
    buildLogUrl: row.build_log_url,
    status: row.status as ContainerDeploymentSchema['status'],
    errorMessage: row.error_message,
    triggeredBy: row.triggered_by as ContainerDeploymentSchema['triggeredBy'],
    isActive: row.is_active,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
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
    if (input.envVars && Object.keys(input.envVars).length > 0) {
      envVarsEncrypted = EncryptionManager.encrypt(JSON.stringify(input.envVars));
    }

    const result = await pool.query<ContainerRow>(
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
        input.projectId,
        input.name,
        input.sourceType,
        input.githubRepo ?? null,
        input.githubBranch ?? null,
        input.imageUrl ?? null,
        input.dockerfilePath ?? null,
        input.cpu,
        input.memory,
        input.port,
        input.healthCheckPath ?? null,
        input.autoDeploy ?? false,
        input.replicas ?? 1,
        input.region ?? 'us-east-1',
        envVarsEncrypted,
      ]
    );

    logger.info('Container created', { id: result.rows[0].id });
    return mapContainerRow(result.rows[0]);
  }

  async getContainers(projectId: string): Promise<ContainerSchema[]> {
    const result = await this.getPool().query<ContainerRow>(
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
    return result.rows.map(mapContainerRow);
  }

  async getContainer(id: string): Promise<ContainerSchema | null> {
    const result = await this.getPool().query<ContainerRow>(
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
    const row = result.rows[0];
    return row ? mapContainerRow(row) : null;
  }

  async updateContainer(id: string, input: UpdateContainerInput): Promise<ContainerSchema | null> {
    const pool = this.getPool();
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramCount = 1;

    // Map camelCase input keys to snake_case DB column names
    const camelToSnake: Record<string, string> = {
      name: 'name',
      githubRepo: 'github_repo',
      githubBranch: 'github_branch',
      imageUrl: 'image_url',
      dockerfilePath: 'dockerfile_path',
      cpu: 'cpu',
      memory: 'memory',
      port: 'port',
      healthCheckPath: 'health_check_path',
      autoDeploy: 'auto_deploy',
      replicas: 'replicas',
      customDomain: 'custom_domain',
    };

    for (const [key, value] of Object.entries(input)) {
      if (key === 'envVars') {
        if (ALLOWED_UPDATE_COLUMNS.has('env_vars_encrypted')) {
          const encrypted =
            value && typeof value === 'object' && Object.keys(value as object).length > 0
              ? EncryptionManager.encrypt(JSON.stringify(value))
              : null;
          setClauses.push(`env_vars_encrypted = $${paramCount++}`);
          values.push(encrypted);
        }
      } else {
        const dbColumn = camelToSnake[key];
        if (dbColumn && ALLOWED_UPDATE_COLUMNS.has(dbColumn)) {
          setClauses.push(`${dbColumn} = $${paramCount++}`);
          values.push(value);
        }
      }
    }

    if (setClauses.length === 0) {
      return this.getContainer(id);
    }

    values.push(id);

    const result = await pool.query<ContainerRow>(
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
    const row = result.rows[0];
    return row ? mapContainerRow(row) : null;
  }

  async deleteContainer(id: string): Promise<boolean> {
    const pool = this.getPool();

    // Fetch route info before deleting
    const routeResult = await pool.query<{
      target_group_arn: string | null;
      rule_arn: string | null;
      service_arn: string | null;
    }>(
      `SELECT target_group_arn, rule_arn, service_arn
       FROM compute.container_routes
       WHERE container_id = $1
       LIMIT 1`,
      [id]
    );

    const route = routeResult.rows[0];

    // Clean up AWS resources before deleting DB row
    if (route && this.provider) {
      try {
        if (route.service_arn) {
          await this.provider.destroy(route.service_arn);
        }
        if (route.target_group_arn && route.rule_arn) {
          await this.provider.deleteRoute(route.target_group_arn, route.rule_arn);
        }
      } catch (err: unknown) {
        logger.warn('Failed to clean up AWS resources during container delete', { id, err });
        // Continue with DB deletion even if AWS cleanup fails
      }
    }

    const result = await pool.query('DELETE FROM compute.containers WHERE id = $1', [id]);
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
      return JSON.parse(EncryptionManager.decrypt(row.env_vars_encrypted)) as Record<
        string,
        string
      >;
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
      [input.containerId]
    );
    if (inFlight.rows.length > 0) {
      throw new Error('A deployment is already in progress for this container');
    }

    const imageTag = `deploy-${Date.now()}`;

    const result = await pool.query<DeploymentRow>(
      `INSERT INTO compute.deployments
         (container_id, status, triggered_by, commit_sha, image_tag, started_at)
       VALUES ($1, 'pending', $2, $3, $4, NOW())
       RETURNING
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at`,
      [input.containerId, input.triggeredBy ?? 'manual', input.commitSha ?? null, imageTag]
    );

    const deployment = mapDeploymentRow(result.rows[0]);

    // Fire-and-forget
    this.executeDeploy(deployment, input.githubToken).catch((err: unknown) => {
      logger.error('executeDeploy uncaught error', { deploymentId: deployment.id, err });
    });

    return deployment;
  }

  private async setDeploymentStatus(
    deploymentId: string,
    status: ContainerDeploymentSchema['status'],
    extra: {
      errorMessage?: string;
      buildLogUrl?: string;
      imageTag?: string;
    } = {}
  ): Promise<void> {
    const setClauses = ['status = $2'];
    const values: unknown[] = [deploymentId, status];
    let paramCount = 3;

    if (extra.errorMessage !== undefined) {
      setClauses.push(`error_message = $${paramCount++}`);
      values.push(extra.errorMessage);
    }
    if (extra.buildLogUrl !== undefined) {
      setClauses.push(`build_log_url = $${paramCount++}`);
      values.push(extra.buildLogUrl);
    }
    if (extra.imageTag !== undefined) {
      setClauses.push(`image_tag = $${paramCount++}`);
      values.push(extra.imageTag);
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
    extra: { endpointUrl?: string } = {}
  ): Promise<void> {
    const setClauses = ['status = $2', 'updated_at = NOW()'];
    const values: unknown[] = [containerId, status];
    let paramCount = 3;

    if (extra.endpointUrl !== undefined) {
      setClauses.push(`endpoint_url = $${paramCount++}`);
      values.push(extra.endpointUrl);
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

    const containerResult = await pool.query<ContainerRow>(
      `SELECT
         id, project_id, name, source_type,
         github_repo, github_branch, image_url, dockerfile_path,
         cpu, memory, port, health_check_path,
         status, endpoint_url, auto_deploy, replicas,
         custom_domain, region, last_deployed_at, created_at, updated_at
       FROM compute.containers WHERE id = $1`,
      [deployment.containerId]
    );

    if (!containerResult.rows.length) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        errorMessage: 'Container not found',
      });
      return;
    }

    const container = mapContainerRow(containerResult.rows[0]);
    const provider = this.provider;

    if (!provider) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        errorMessage: 'Compute provider not configured',
      });
      await this.setContainerStatus(container.id, 'failed');
      return;
    }

    // Fetch project slug for routing
    const projectResult = await pool.query<{ slug: string }>(
      `SELECT slug FROM projects WHERE id = $1`,
      [container.projectId]
    );
    const projectSlug = projectResult.rows[0]?.slug ?? container.projectId;

    let imageUri: string;

    try {
      if (container.sourceType === 'github') {
        // ── BUILD phase ────────────────────────────────────────────────────
        if (!container.githubRepo || !container.githubBranch) {
          throw new Error('githubRepo and githubBranch are required for github source');
        }
        if (!githubToken) {
          throw new Error('githubToken is required to build from GitHub source');
        }

        await this.setDeploymentStatus(deployment.id, 'building');
        await this.setContainerStatus(container.id, 'building');

        const buildResult = await provider.buildImage({
          containerId: container.id,
          githubRepo: container.githubRepo,
          githubBranch: container.githubBranch,
          dockerfilePath: container.dockerfilePath ?? 'Dockerfile',
          githubToken,
          imageTag: deployment.imageTag ?? `deploy-${Date.now()}`,
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
              buildLogUrl: statusResult.logUrl,
            });
          }
        }

        if (buildStatus !== 'SUCCEEDED') {
          throw new Error(`Build failed with status: ${buildStatus}`);
        }

        imageUri = buildResult.imageUri;

        // ── PUSH phase (image is already in ECR, just update status) ──────
        await this.setDeploymentStatus(deployment.id, 'pushing', {
          imageTag: deployment.imageTag ?? undefined,
        });
      } else {
        // image source — use provided imageUrl directly
        if (!container.imageUrl) {
          throw new Error('imageUrl is required for image source type');
        }
        imageUri = container.imageUrl;
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
        healthCheckPath: container.healthCheckPath ?? '/health',
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
            deployResult.targetGroupArn,
            deployResult.ruleArn,
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
      await pool.query(`UPDATE compute.deployments SET is_active = true WHERE id = $1`, [
        deployment.id,
      ]);

      await this.setContainerStatus(container.id, 'running', {
        endpointUrl: deployResult.endpointUrl,
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
      await this.setDeploymentStatus(deployment.id, 'failed', { errorMessage });
      await this.setContainerStatus(container.id, 'failed');
    }
  }

  async getDeployments(containerId: string): Promise<ContainerDeploymentSchema[]> {
    const result = await this.getPool().query<DeploymentRow>(
      `SELECT
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at
       FROM compute.deployments
       WHERE container_id = $1
       ORDER BY started_at DESC`,
      [containerId]
    );
    return result.rows.map(mapDeploymentRow);
  }

  async getDeployment(id: string): Promise<ContainerDeploymentSchema | null> {
    const result = await this.getPool().query<DeploymentRow>(
      `SELECT
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at
       FROM compute.deployments
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    return row ? mapDeploymentRow(row) : null;
  }

  /**
   * Rollback — creates a new deployment using a previous deployment's image_tag.
   * Skips the build phase and goes straight to deploy.
   */
  async rollback(
    containerId: string,
    targetDeploymentId: string
  ): Promise<ContainerDeploymentSchema> {
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
    const targetResult = await pool.query<DeploymentRow>(
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

    const result = await pool.query<DeploymentRow>(
      `INSERT INTO compute.deployments
         (container_id, status, triggered_by, image_tag, started_at)
       VALUES ($1, 'pending', 'rollback', $2, NOW())
       RETURNING
         id, container_id, commit_sha, image_tag,
         build_log_url, status, error_message,
         triggered_by, is_active, started_at, finished_at`,
      [containerId, targetImageTag]
    );

    const deployment = mapDeploymentRow(result.rows[0]);

    // Fire-and-forget rollback deploy
    this.executeRollbackDeploy(deployment).catch((err: unknown) => {
      logger.error('executeRollbackDeploy uncaught error', { deploymentId: deployment.id, err });
    });

    return deployment;
  }

  private async executeRollbackDeploy(deployment: ContainerDeploymentSchema): Promise<void> {
    const pool = this.getPool();

    const containerResult = await pool.query<ContainerRow>(
      `SELECT
         id, project_id, name, source_type,
         github_repo, github_branch, image_url, dockerfile_path,
         cpu, memory, port, health_check_path,
         status, endpoint_url, auto_deploy, replicas,
         custom_domain, region, last_deployed_at, created_at, updated_at
       FROM compute.containers WHERE id = $1`,
      [deployment.containerId]
    );

    if (!containerResult.rows.length) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        errorMessage: 'Container not found',
      });
      return;
    }

    const container = mapContainerRow(containerResult.rows[0]);
    const provider = this.provider;

    if (!provider) {
      await this.setDeploymentStatus(deployment.id, 'failed', {
        errorMessage: 'Compute provider not configured',
      });
      await this.setContainerStatus(container.id, 'failed');
      return;
    }

    const projectResult = await pool.query<{ slug: string }>(
      `SELECT slug FROM projects WHERE id = $1`,
      [container.projectId]
    );
    const projectSlug = projectResult.rows[0]?.slug ?? container.projectId;

    try {
      await this.setDeploymentStatus(deployment.id, 'deploying');
      await this.setContainerStatus(container.id, 'deploying');

      const envVars = await this.getDecryptedEnvVars(container.id);
      envVars['PORT'] = String(container.port);

      // Build imageUri from the stored image_tag
      const imageUri = `${config.compute.ecrRegistry}/${container.id}:${deployment.imageTag}`;

      const deployResult = await provider.deploy({
        containerId: container.id,
        imageUri,
        cpu: container.cpu,
        memory: container.memory,
        port: container.port,
        healthCheckPath: container.healthCheckPath ?? '/health',
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
      await pool.query(`UPDATE compute.deployments SET is_active = true WHERE id = $1`, [
        deployment.id,
      ]);

      await this.setContainerStatus(container.id, 'running', {
        endpointUrl: deployResult.endpointUrl,
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
      await this.setDeploymentStatus(deployment.id, 'failed', { errorMessage });
      await this.setContainerStatus(container.id, 'failed');
    }
  }

  async getContainerLogs(containerId: string, opts: LogOpts = {}): Promise<LogStream> {
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
