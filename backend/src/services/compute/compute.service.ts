import { DatabaseManager } from '@/infra/database/database.manager.js';
import { Pool } from 'pg';
import logger from '@/utils/logger.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { AwsFargateProvider } from '@/providers/compute/aws-fargate.provider.js';
import type { ComputeProvider } from '@/providers/compute/base.provider.js';
import type { ContainerSchema, ContainerDeploymentSchema, TaskRunSchema, TaskRunStatus } from '@insforge/shared-schemas';
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
  run_mode: string;
  task_definition_arn: string | null;
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

interface TaskRunRow {
  id: string;
  container_id: string;
  ecs_task_arn: string | null;
  status: string;
  exit_code: number | null;
  triggered_by: string;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function mapTaskRunRow(row: TaskRunRow): TaskRunSchema {
  return {
    id: row.id,
    containerId: row.container_id,
    ecsTaskArn: row.ecs_task_arn,
    status: row.status as TaskRunStatus,
    exitCode: row.exit_code,
    triggeredBy: row.triggered_by as 'manual' | 'api',
    errorMessage: row.error_message,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
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
    runMode: row.run_mode as 'service' | 'task',
    taskDefinitionArn: row.task_definition_arn,
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
    runMode?: 'service' | 'task';
  }): Promise<ContainerSchema> {
    const result = await this.getPool().query<ContainerRow>(
      `INSERT INTO compute.containers
         (project_id, name, source_type, github_repo, github_branch, dockerfile_path, image_url, cpu, memory, port, health_check_path, auto_deploy, run_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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
        input.runMode ?? 'service',
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

    const containerResult = await pool.query<ContainerRow>(
      `SELECT * FROM compute.containers WHERE id = $1`,
      [id]
    );
    const container = containerResult.rows[0];
    if (!container) {
      throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
    }

    if (container.run_mode === 'service') {
      // For services: tear down cloud resources (ECS service, ALB, etc.)
      const routeResult = await pool.query<RouteRow>(
        `SELECT * FROM compute.container_routes WHERE container_id = $1`,
        [id]
      );
      const route = routeResult.rows[0];

      if (route?.service_arn && this.provider.isConfigured()) {
        try {
          await this.provider.teardown({
            serviceArn: route.service_arn,
            targetGroupArn: route.target_group_arn ?? '',
            ruleArn: route.rule_arn ?? '',
          });
        } catch (error) {
          logger.error('AWS teardown failed, keeping DB rows for retry', {
            containerId: id,
            error: String(error),
          });
          await pool.query(
            `UPDATE compute.containers SET status = 'teardown_failed' WHERE id = $1`,
            [id]
          );
          throw new AppError(
            'Failed to tear down cloud resources. Container marked for retry.',
            500,
            ERROR_CODES.COMPUTE_TEARDOWN_FAILED
          );
        }
      }
    } else {
      // For tasks: stop any running task runs
      if (this.provider.isConfigured()) {
        const runningTasks = await pool.query<TaskRunRow>(
          `SELECT * FROM compute.task_runs WHERE container_id = $1 AND status IN ('pending', 'running')`,
          [id]
        );
        for (const task of runningTasks.rows) {
          if (task.ecs_task_arn) {
            try {
              await this.provider.stopTask(task.ecs_task_arn);
            } catch (error) {
              logger.error('Failed to stop task during container deletion', {
                containerId: id,
                taskRunId: task.id,
                error: String(error),
              });
            }
          }
        }
      }
    }

    // Cloud resources cleaned up (or none existed) — safe to delete
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
    imageUri?: string;
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
        `INSERT INTO compute.deployments (container_id, status, triggered_by, image_uri)
         VALUES ($1, 'pending', $2, $3)
         RETURNING *`,
        [input.containerId, input.triggeredBy, input.imageUri ?? null]
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

    // Create a new deployment with the target's imageUri pre-set so
    // executeDeploy picks it up immediately (no race condition)
    return this.deploy({
      containerId: input.containerId,
      triggeredBy: 'rollback',
      imageUri: targetDeployment.imageUri,
    });
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

      // Register task definition (needed for both service and task run modes)
      const taskDefArn = await this.provider.registerTaskDefinition({
        containerId: container.id,
        imageUri,
        port: container.port,
        cpu: container.cpu,
        memory: container.memory,
        envVars,
      });

      if (container.runMode === 'task') {
        // Task mode: store the task definition ARN, mark as ready
        await pool.query(
          `UPDATE compute.containers SET task_definition_arn = $1 WHERE id = $2`,
          [taskDefArn, container.id]
        );

        // Mark deployment as live, deactivate previous
        await pool.query(
          `UPDATE compute.deployments SET is_active = (id = $1) WHERE container_id = $2`,
          [deployment.id, container.id]
        );
        await this.setDeploymentStatus(deployment.id, 'live');
        await this.setContainerStatus(container.id, 'ready');
        return;
      }

      // Service mode: provision or update ECS service
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
      try {
        await this.setDeploymentStatus(deployment.id, 'failed', errorMessage);
        const current = await this.getContainer(container.id);
        if (current && current.status === 'deploying') {
          await this.setContainerStatus(container.id, 'failed');
        }
      } catch (innerErr) {
        console.error(`[ComputeService] Failed to update status after deploy error:`, innerErr);
      }
      console.error(`[ComputeService] Deploy failed for container ${container.id}:`, err);
    }
  }

  // ─── Task Execution ──────────────────────────────────────────────────────────

  async runTask(
    containerId: string,
    triggeredBy: 'manual' | 'api' = 'manual'
  ): Promise<TaskRunSchema> {
    const container = await this.getContainer(containerId);
    if (!container) {
      throw new AppError('Container not found', 404, ERROR_CODES.NOT_FOUND);
    }
    if (container.runMode !== 'task') {
      throw new AppError(
        'Container is not configured for task execution',
        400,
        ERROR_CODES.COMPUTE_INVALID_RUN_MODE
      );
    }
    if (container.status !== 'ready') {
      throw new AppError(
        'Container is not ready. Deploy first.',
        400,
        ERROR_CODES.COMPUTE_NOT_READY
      );
    }
    if (!container.taskDefinitionArn) {
      throw new AppError(
        'No task definition registered. Deploy first.',
        400,
        ERROR_CODES.COMPUTE_NOT_READY
      );
    }

    const result = await this.getPool().query<TaskRunRow>(
      `INSERT INTO compute.task_runs (container_id, status, triggered_by)
       VALUES ($1, 'pending', $2)
       RETURNING *`,
      [containerId, triggeredBy]
    );

    const taskRun = mapTaskRunRow(result.rows[0]);

    // Fire-and-forget the async task execution
    void this.executeTaskRun(container, taskRun);

    return taskRun;
  }

  private async executeTaskRun(
    container: ContainerSchema,
    taskRun: TaskRunSchema
  ): Promise<void> {
    try {
      if (!this.provider.isConfigured()) {
        throw new Error('Compute provider is not configured');
      }

      const envVars = await this.getDecryptedEnvVars(container.id);

      const { taskArn } = await this.provider.runTask({
        containerId: container.id,
        taskDefinitionArn: container.taskDefinitionArn!,
        envVars,
        cpu: container.cpu,
        memory: container.memory,
      });

      await this.getPool().query(
        `UPDATE compute.task_runs SET ecs_task_arn = $1, status = 'running' WHERE id = $2`,
        [taskArn, taskRun.id]
      );

      await this.pollTaskCompletion(taskRun.id, taskArn);
    } catch (err) {
      const errorMessage = (err as Error).message;
      try {
        await this.getPool().query(
          `UPDATE compute.task_runs SET status = 'failed', error_message = $1 WHERE id = $2`,
          [errorMessage, taskRun.id]
        );
      } catch (innerErr) {
        console.error(`[ComputeService] Failed to update task run status after error:`, innerErr);
      }
      console.error(`[ComputeService] Task run failed for container ${container.id}:`, err);
    }
  }

  private async pollTaskCompletion(taskRunId: string, taskArn: string): Promise<void> {
    const MAX_POLLS = 360; // 30 minutes at 5s intervals
    const POLL_INTERVAL_MS = 5000;

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const status = await this.provider.getTaskStatus(taskArn);

        if (status.status === 'running') {
          continue;
        }

        // Task completed (succeeded, failed, or stopped)
        await this.getPool().query(
          `UPDATE compute.task_runs
           SET status = $1, exit_code = $2, finished_at = NOW()
           WHERE id = $3`,
          [status.status, status.exitCode, taskRunId]
        );
        return;
      } catch (err) {
        logger.error('Error polling task status', {
          taskRunId,
          taskArn,
          error: String(err),
        });
      }
    }

    // Timed out
    await this.getPool().query(
      `UPDATE compute.task_runs
       SET status = 'failed', error_message = 'Task timed out after 30 minutes', finished_at = NOW()
       WHERE id = $1`,
      [taskRunId]
    );
  }

  async stopTask(taskRunId: string): Promise<void> {
    const result = await this.getPool().query<TaskRunRow>(
      `SELECT * FROM compute.task_runs WHERE id = $1`,
      [taskRunId]
    );
    const taskRun = result.rows[0];
    if (!taskRun) {
      throw new AppError('Task run not found', 404, ERROR_CODES.COMPUTE_TASK_NOT_FOUND);
    }

    if (taskRun.ecs_task_arn && (taskRun.status === 'running' || taskRun.status === 'pending')) {
      await this.provider.stopTask(taskRun.ecs_task_arn);
    }

    await this.getPool().query(
      `UPDATE compute.task_runs SET status = 'stopped', finished_at = NOW() WHERE id = $1`,
      [taskRunId]
    );
  }

  async listTaskRuns(containerId: string): Promise<TaskRunSchema[]> {
    const result = await this.getPool().query<TaskRunRow>(
      `SELECT * FROM compute.task_runs WHERE container_id = $1 ORDER BY created_at DESC`,
      [containerId]
    );
    return result.rows.map(mapTaskRunRow);
  }

  async getTaskRun(taskRunId: string): Promise<TaskRunSchema | null> {
    const result = await this.getPool().query<TaskRunRow>(
      `SELECT * FROM compute.task_runs WHERE id = $1`,
      [taskRunId]
    );
    return result.rows[0] ? mapTaskRunRow(result.rows[0]) : null;
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
