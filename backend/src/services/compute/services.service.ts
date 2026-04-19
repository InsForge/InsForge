import { Pool } from 'pg';
import { createHash } from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { FlyProvider } from '@/providers/compute/fly.provider.js';
import { CloudComputeProvider } from '@/providers/compute/cloud.provider.js';
import type { ComputeProvider } from '@/providers/compute/compute.provider.js';
import { config } from '@/infra/config/app.config.js';
import { ERROR_CODES, NEXT_ACTION } from '@/types/error-constants.js';
import { AppError } from '@/api/middlewares/error.js';
import logger from '@/utils/logger.js';
import type { ServiceSchema } from '@insforge/shared-schemas';

export interface CreateServiceInput {
  projectId: string;
  name: string;
  imageUrl: string;
  port: number;
  cpu: string;
  memory: number;
  region: string;
  envVars?: Record<string, string>;
}

export interface UpdateServiceInput {
  imageUrl?: string;
  port?: number;
  cpu?: string;
  memory?: number;
  region?: string;
  envVars?: Record<string, string>;
}

interface ServiceRow {
  id: string;
  project_id: string;
  name: string;
  image_url: string;
  port: number;
  cpu: string;
  memory: number;
  region: string;
  fly_app_id: string | null;
  fly_machine_id: string | null;
  status: string;
  endpoint_url: string | null;
  env_vars_encrypted: string | null;
  created_at: string;
  updated_at: string;
}

function mapRowToSchema(row: ServiceRow): ServiceSchema {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    imageUrl: row.image_url,
    port: row.port,
    cpu: row.cpu as ServiceSchema['cpu'],
    memory: row.memory,
    region: row.region,
    flyAppId: row.fly_app_id,
    flyMachineId: row.fly_machine_id,
    status: row.status as ServiceSchema['status'],
    endpointUrl: row.endpoint_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function makeFlyAppName(name: string, projectId: string): string {
  const suffix = `-${projectId}`;
  const maxBase = 60 - suffix.length;
  // Need at least 8 chars for truncated name: 1 letter + dash + 6-char hash
  if (maxBase < 8) {
    throw new AppError(
      `projectId is too long to produce a valid Fly app name (max ~51 chars, got ${projectId.length})`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  if (name.length <= maxBase) {
    return name + suffix;
  }
  // When truncating, append a short hash of the full name to avoid collisions
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 6);
  const truncated = name.slice(0, maxBase - 7); // 6 chars hash + 1 dash
  return `${truncated}-${hash}${suffix}`;
}

function makeNetwork(projectId: string): string {
  return `${projectId}-network`;
}

export function selectComputeProvider(): ComputeProvider {
  if (config.fly.apiToken) {
    return FlyProvider.getInstance();
  }
  if (config.cloud.computeEnabled) {
    return CloudComputeProvider.getInstance();
  }
  throw new AppError(
    'Compute services not configured. Set FLY_API_TOKEN for self-host, ' +
      'or enable CLOUD_COMPUTE_ENABLED to use cloud-managed compute.',
    503,
    ERROR_CODES.COMPUTE_NOT_CONFIGURED,
    'Self-hosted: set FLY_API_TOKEN in .env. Cloud: set CLOUD_COMPUTE_ENABLED=true and verify PROJECT_ID is set.'
  );
}

export class ComputeServicesService {
  private static instance: ComputeServicesService;
  private pool: Pool | null = null;
  private readonly compute: ComputeProvider = selectComputeProvider();

  private constructor() {}

  static getInstance(): ComputeServicesService {
    if (!ComputeServicesService.instance) {
      ComputeServicesService.instance = new ComputeServicesService();
    }
    return ComputeServicesService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private getCompute(): ComputeProvider {
    return this.compute;
  }

  async listServices(projectId: string): Promise<ServiceSchema[]> {
    const result = await this.getPool().query(
      `SELECT * FROM compute.services WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId]
    );
    return result.rows.map(mapRowToSchema);
  }

  async getService(id: string): Promise<ServiceSchema> {
    const result = await this.getPool().query(`SELECT * FROM compute.services WHERE id = $1`, [id]);
    if (!result.rows.length) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }
    return mapRowToSchema(result.rows[0]);
  }

  async createService(input: CreateServiceInput): Promise<ServiceSchema> {
    const fly = this.getCompute();

    if (!fly.isConfigured()) {
      throw new AppError(
        'Compute services are not enabled on this project.',
        503,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED,
        NEXT_ACTION.ENABLE_COMPUTE
      );
    }

    const envVarsEncrypted = input.envVars
      ? EncryptionManager.encrypt(JSON.stringify(input.envVars))
      : null;

    // Insert initial row — check for duplicate name before calling Fly APIs
    let insertResult;
    try {
      insertResult = await this.getPool().query(
        `INSERT INTO compute.services (project_id, name, image_url, port, cpu, memory, region, env_vars_encrypted, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'creating')
         RETURNING *`,
        [
          input.projectId,
          input.name,
          input.imageUrl,
          input.port,
          input.cpu,
          input.memory,
          input.region,
          envVarsEncrypted,
        ]
      );
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          'A service with this name already exists',
          409,
          ERROR_CODES.COMPUTE_SERVICE_ALREADY_EXISTS
        );
      }
      throw error;
    }

    const row: ServiceRow = insertResult.rows[0];
    const serviceId = row.id;
    const flyAppName = makeFlyAppName(input.name, input.projectId);
    const network = makeNetwork(input.projectId);
    const endpointUrl = `https://${flyAppName}.${config.fly.domain}`;

    let flyMachineId: string | undefined;
    try {
      await fly.createApp({
        name: flyAppName,
        network,
        org: config.fly.org,
      });

      const { machineId } = await fly.launchMachine({
        appId: flyAppName,
        image: input.imageUrl,
        port: input.port,
        cpu: input.cpu,
        memory: input.memory,
        envVars: input.envVars ?? {},
        region: input.region,
      });
      flyMachineId = machineId;

      const updateResult = await this.getPool().query(
        `UPDATE compute.services
         SET fly_app_id = $1, fly_machine_id = $2, endpoint_url = $3, status = $4
         WHERE id = $5
         RETURNING *`,
        [flyAppName, machineId, endpointUrl, 'running', serviceId]
      );

      logger.info('Compute service deployed', { serviceId, flyAppName, machineId });
      return mapRowToSchema(updateResult.rows[0]);
    } catch (error) {
      logger.error('Failed to deploy compute service', { serviceId, error });

      // Clean up orphaned Fly resources (machine + app) to avoid leaked infrastructure
      if (flyMachineId) {
        try {
          await fly.destroyMachine(flyAppName, flyMachineId);
        } catch (destroyError) {
          logger.error('Failed to clean up orphaned Fly machine', {
            flyAppName,
            flyMachineId,
            error: destroyError,
          });
        }
      }
      try {
        await fly.destroyApp(flyAppName);
      } catch (destroyError) {
        logger.error('Failed to clean up orphaned Fly app', { flyAppName, error: destroyError });
      }

      // Mark as failed
      await this.getPool().query(`UPDATE compute.services SET status = $1 WHERE id = $2`, [
        'failed',
        serviceId,
      ]);

      throw new AppError(
        'Compute service operation failed',
        502,
        ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
      );
    }
  }

  async prepareForDeploy(input: CreateServiceInput): Promise<ServiceSchema> {
    const fly = this.getCompute();

    if (!fly.isConfigured()) {
      throw new AppError(
        'Compute services are not enabled on this project.',
        503,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED,
        NEXT_ACTION.ENABLE_COMPUTE
      );
    }

    const envVarsEncrypted = input.envVars
      ? EncryptionManager.encrypt(JSON.stringify(input.envVars))
      : null;

    const flyAppName = makeFlyAppName(input.name, input.projectId);
    const network = makeNetwork(input.projectId);
    const endpointUrl = `https://${flyAppName}.${config.fly.domain}`;

    // Insert row — check for duplicate name before calling Fly APIs
    let insertResult;
    try {
      insertResult = await this.getPool().query(
        `INSERT INTO compute.services (project_id, name, image_url, port, cpu, memory, region, env_vars_encrypted, fly_app_id, endpoint_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'deploying')
         RETURNING *`,
        [
          input.projectId,
          input.name,
          input.imageUrl || 'dockerfile',
          input.port,
          input.cpu,
          input.memory,
          input.region,
          envVarsEncrypted,
          flyAppName,
          endpointUrl,
        ]
      );
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          'A service with this name already exists',
          409,
          ERROR_CODES.COMPUTE_SERVICE_ALREADY_EXISTS
        );
      }
      throw error;
    }

    // Create Fly app (no machine — flyctl deploy will create it)
    try {
      await fly.createApp({ name: flyAppName, network, org: config.fly.org });
    } catch (error) {
      // App might already exist from a previous deploy attempt — ignore "already exists"
      const msg = error instanceof Error ? error.message : '';
      const status = (error as { status?: number }).status;
      const isAlreadyExists =
        (status === 422 || msg.includes('422')) && msg.toLowerCase().includes('already exists');
      if (!isAlreadyExists) {
        // Clean up DB record and rethrow
        await this.getPool().query(`DELETE FROM compute.services WHERE id = $1`, [
          insertResult.rows[0].id,
        ]);
        throw error;
      }
    }

    logger.info('Compute service prepared for deploy', { flyAppName });
    return mapRowToSchema(insertResult.rows[0]);
  }

  async syncAfterDeploy(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);

    if (!svc.flyAppId) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    const fly = this.getCompute();
    const machines = await fly.listMachines(svc.flyAppId);

    if (machines.length === 0) {
      // Deploy may have failed — mark as failed
      await this.getPool().query(`UPDATE compute.services SET status = 'failed' WHERE id = $1`, [
        id,
      ]);
      return this.getService(id);
    }

    const machine = machines[0];
    const status =
      machine.state === 'started' || machine.state === 'running'
        ? 'running'
        : machine.state === 'stopped'
          ? 'stopped'
          : 'deploying';

    const result = await this.getPool().query(
      `UPDATE compute.services SET fly_machine_id = $1, status = $2 WHERE id = $3 RETURNING *`,
      [machine.id, status, id]
    );

    if (!result.rows.length) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    logger.info('Compute service synced after deploy', { id, machineId: machine.id, status });
    return mapRowToSchema(result.rows[0]);
  }

  async updateService(id: string, data: UpdateServiceInput): Promise<ServiceSchema> {
    const existing = await this.getService(id);

    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    if (data.imageUrl !== undefined) {
      updates.push(`image_url = $${paramIdx++}`);
      values.push(data.imageUrl);
    }
    if (data.port !== undefined) {
      updates.push(`port = $${paramIdx++}`);
      values.push(data.port);
    }
    if (data.cpu !== undefined) {
      updates.push(`cpu = $${paramIdx++}`);
      values.push(data.cpu);
    }
    if (data.memory !== undefined) {
      updates.push(`memory = $${paramIdx++}`);
      values.push(data.memory);
    }
    if (data.region !== undefined) {
      updates.push(`region = $${paramIdx++}`);
      values.push(data.region);
    }
    if (data.envVars !== undefined) {
      updates.push(`env_vars_encrypted = $${paramIdx++}`);
      values.push(EncryptionManager.encrypt(JSON.stringify(data.envVars)));
    }

    if (updates.length === 0) {
      return existing;
    }

    // If deployment-affecting fields changed and a machine exists, update Fly FIRST.
    // Only commit to DB after Fly accepts the new config to avoid stale DB state.
    const deployFields = ['imageUrl', 'port', 'cpu', 'memory', 'envVars'] as const;
    const hasDeployChange = deployFields.some((f) => data[f] !== undefined);

    if (hasDeployChange && existing.flyAppId && existing.flyMachineId) {
      // Fetch existing encrypted env vars to merge with update
      const existingRow = await this.getPool().query(
        `SELECT env_vars_encrypted FROM compute.services WHERE id = $1`,
        [id]
      );
      const existingEnvVarsEncrypted: string | null =
        existingRow.rows[0]?.env_vars_encrypted ?? null;
      const envVars = data.envVars ?? this.decryptEnvVars(existingEnvVarsEncrypted);

      // NOTE: Region changes are persisted in the DB but Fly machine region cannot
      // be changed in-place via updateMachine — a region change requires redeployment
      // (destroy + recreate). The region field is stored for the next deploy.
      try {
        await this.getCompute().updateMachine({
          appId: existing.flyAppId,
          machineId: existing.flyMachineId,
          image: data.imageUrl ?? existing.imageUrl,
          port: data.port ?? existing.port,
          cpu: data.cpu ?? existing.cpu,
          memory: data.memory ?? existing.memory,
          envVars,
        });
        logger.info('Compute service machine updated', { id });
      } catch (error) {
        logger.error('Failed to update machine on Fly', { id, error });
        throw new AppError(
          'Compute service operation failed',
          502,
          ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
        );
      }
    }

    // Fly accepted the update (or no Fly update was needed) — now commit to DB
    values.push(id);
    const result = await this.getPool().query(
      `UPDATE compute.services SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values
    );

    if (!result.rows.length) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    return mapRowToSchema(result.rows[0]);
  }

  async deleteService(id: string): Promise<void> {
    const svc = await this.getService(id);

    // Mark as destroying first so it's visible in the UI
    await this.getPool().query(`UPDATE compute.services SET status = 'destroying' WHERE id = $1`, [
      id,
    ]);

    // Fly cleanup — abort delete if cleanup fails to preserve the reference
    // Treat 404 as success (resource already destroyed)
    if (svc.flyMachineId && svc.flyAppId) {
      try {
        await this.getCompute().destroyMachine(svc.flyAppId, svc.flyMachineId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (!msg.includes('404')) {
          logger.error('Failed to destroy Fly machine during delete', { id, error });
          await this.getPool().query(
            `UPDATE compute.services SET status = 'failed' WHERE id = $1`,
            [id]
          );
          throw new AppError(
            'Failed to delete compute service',
            502,
            ERROR_CODES.COMPUTE_SERVICE_DELETE_FAILED
          );
        }
        logger.info('Fly machine already destroyed (404), continuing delete', { id });
      }
    }

    if (svc.flyAppId) {
      try {
        await this.getCompute().destroyApp(svc.flyAppId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (!msg.includes('404')) {
          logger.error('Failed to destroy Fly app during delete', { id, error });
          await this.getPool().query(
            `UPDATE compute.services SET status = 'failed' WHERE id = $1`,
            [id]
          );
          throw new AppError(
            'Failed to delete compute service',
            502,
            ERROR_CODES.COMPUTE_SERVICE_DELETE_FAILED
          );
        }
        logger.info('Fly app already destroyed (404), continuing delete', { id });
      }
    }

    await this.getPool().query(`DELETE FROM compute.services WHERE id = $1`, [id]);
    logger.info('Compute service deleted', { id });
  }

  async stopService(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);

    if (!svc.flyAppId || !svc.flyMachineId) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    try {
      await this.getCompute().stopMachine(svc.flyAppId, svc.flyMachineId);
    } catch (error) {
      logger.error('Failed to stop compute service', { id, error });
      throw new AppError(
        'Failed to stop compute service',
        502,
        ERROR_CODES.COMPUTE_SERVICE_STOP_FAILED
      );
    }

    const result = await this.getPool().query(
      `UPDATE compute.services SET status = 'stopped' WHERE id = $1 RETURNING *`,
      [id]
    );

    logger.info('Compute service stopped', { id });
    return mapRowToSchema(result.rows[0]);
  }

  async startService(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);

    if (!svc.flyAppId || !svc.flyMachineId) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    try {
      await this.getCompute().startMachine(svc.flyAppId, svc.flyMachineId);
    } catch (error) {
      logger.error('Failed to start compute service', { id, error });
      throw new AppError(
        'Failed to start compute service',
        502,
        ERROR_CODES.COMPUTE_SERVICE_START_FAILED
      );
    }

    const result = await this.getPool().query(
      `UPDATE compute.services SET status = 'running' WHERE id = $1 RETURNING *`,
      [id]
    );

    logger.info('Compute service started', { id });
    return mapRowToSchema(result.rows[0]);
  }

  async getServiceLogs(
    id: string,
    options?: { limit?: number }
  ): Promise<{ timestamp: number; message: string }[]> {
    const svc = await this.getService(id);

    if (!svc.flyAppId || !svc.flyMachineId) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    return this.getCompute().getLogs(svc.flyAppId, svc.flyMachineId, options);
  }

  private decryptEnvVars(encrypted: string | null): Record<string, string> {
    if (!encrypted) {
      return {};
    }
    try {
      return JSON.parse(EncryptionManager.decrypt(encrypted));
    } catch (error) {
      logger.error('Failed to decrypt env vars — refusing to proceed with empty object', {
        error,
      });
      throw new AppError(
        'Failed to decrypt service environment variables',
        500,
        ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
      );
    }
  }
}
