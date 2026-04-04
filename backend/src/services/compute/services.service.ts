import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { FlyProvider } from '@/providers/compute/fly.provider.js';
import { config } from '@/infra/config/app.config.js';
import { ERROR_CODES } from '@/types/error-constants.js';
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
  return `${name}-${projectId}`.substring(0, 60);
}

function makeNetwork(projectId: string): string {
  return `${projectId}-network`;
}

export class ComputeServicesService {
  private static instance: ComputeServicesService;
  private pool: Pool | null = null;

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

  private getFly(): FlyProvider {
    return FlyProvider.getInstance();
  }

  async listServices(projectId: string): Promise<ServiceSchema[]> {
    const result = await this.getPool().query(
      `SELECT * FROM compute.services WHERE project_id = $1 ORDER BY created_at DESC`,
      [projectId],
    );
    return result.rows.map(mapRowToSchema);
  }

  async getService(id: string): Promise<ServiceSchema> {
    const result = await this.getPool().query(
      `SELECT * FROM compute.services WHERE id = $1`,
      [id],
    );
    if (!result.rows.length) {
      throw new Error(ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }
    return mapRowToSchema(result.rows[0]);
  }

  async createService(input: CreateServiceInput): Promise<ServiceSchema> {
    const fly = this.getFly();

    if (!fly.isConfigured()) {
      throw new Error(ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED);
    }

    const envVarsEncrypted = input.envVars
      ? EncryptionManager.encrypt(JSON.stringify(input.envVars))
      : null;

    // Insert initial row
    const insertResult = await this.getPool().query(
      `INSERT INTO compute.services (project_id, name, image_url, port, cpu, memory, region, env_vars_encrypted, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'creating')
       RETURNING *`,
      [input.projectId, input.name, input.imageUrl, input.port, input.cpu, input.memory, input.region, envVarsEncrypted],
    );

    const row: ServiceRow = insertResult.rows[0];
    const serviceId = row.id;
    const flyAppName = makeFlyAppName(input.name, input.projectId);
    const network = makeNetwork(input.projectId);
    const endpointUrl = `https://${flyAppName}.fly.dev`;

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

      const updateResult = await this.getPool().query(
        `UPDATE compute.services
         SET fly_app_id = $1, fly_machine_id = $2, endpoint_url = $3, status = $4
         WHERE id = $5
         RETURNING *`,
        [flyAppName, machineId, endpointUrl, 'running', serviceId],
      );

      logger.info('Compute service deployed', { serviceId, flyAppName, machineId });
      return mapRowToSchema(updateResult.rows[0]);
    } catch (error) {
      logger.error('Failed to deploy compute service', { serviceId, error });

      // Mark as failed
      await this.getPool().query(
        `UPDATE compute.services SET status = $1 WHERE id = $2`,
        ['failed', serviceId],
      );

      throw new Error(ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED);
    }
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

    values.push(id);
    const result = await this.getPool().query(
      `UPDATE compute.services SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      values,
    );

    const updated = mapRowToSchema(result.rows[0]);

    // If deployment-affecting fields changed and a machine exists, update it on Fly
    const deployFields = ['imageUrl', 'port', 'cpu', 'memory', 'envVars'] as const;
    const hasDeployChange = deployFields.some((f) => data[f] !== undefined);

    if (hasDeployChange && existing.flyAppId && existing.flyMachineId) {
      try {
        const envVars = data.envVars ?? this.decryptEnvVars(result.rows[0].env_vars_encrypted);
        await this.getFly().updateMachine({
          appId: existing.flyAppId,
          machineId: existing.flyMachineId,
          image: updated.imageUrl,
          port: updated.port,
          cpu: updated.cpu,
          memory: updated.memory,
          envVars,
        });
        logger.info('Compute service machine updated', { id });
      } catch (error) {
        logger.error('Failed to update machine on Fly', { id, error });
      }
    }

    return updated;
  }

  async deleteService(id: string): Promise<void> {
    const svc = await this.getService(id);

    // Best-effort Fly cleanup
    if (svc.flyMachineId && svc.flyAppId) {
      try {
        await this.getFly().destroyMachine(svc.flyAppId, svc.flyMachineId);
      } catch (error) {
        logger.error('Failed to destroy Fly machine during delete', { id, error });
      }
    }

    if (svc.flyAppId) {
      try {
        await this.getFly().destroyApp(svc.flyAppId);
      } catch (error) {
        logger.error('Failed to destroy Fly app during delete', { id, error });
      }
    }

    await this.getPool().query(`DELETE FROM compute.services WHERE id = $1`, [id]);
    logger.info('Compute service deleted', { id });
  }

  async stopService(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);

    if (!svc.flyAppId || !svc.flyMachineId) {
      throw new Error(ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    await this.getFly().stopMachine(svc.flyAppId, svc.flyMachineId);

    const result = await this.getPool().query(
      `UPDATE compute.services SET status = 'stopped' WHERE id = $1 RETURNING *`,
      [id],
    );

    logger.info('Compute service stopped', { id });
    return mapRowToSchema(result.rows[0]);
  }

  async startService(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);

    if (!svc.flyAppId || !svc.flyMachineId) {
      throw new Error(ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    await this.getFly().startMachine(svc.flyAppId, svc.flyMachineId);

    const result = await this.getPool().query(
      `UPDATE compute.services SET status = 'running' WHERE id = $1 RETURNING *`,
      [id],
    );

    logger.info('Compute service started', { id });
    return mapRowToSchema(result.rows[0]);
  }

  async getServiceLogs(
    id: string,
    options?: { limit?: number },
  ): Promise<{ timestamp: number; message: string }[]> {
    const svc = await this.getService(id);

    if (!svc.flyAppId) {
      throw new Error(ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND);
    }

    return this.getFly().getLogs(svc.flyAppId, options);
  }

  private decryptEnvVars(encrypted: string | null): Record<string, string> {
    if (!encrypted) return {};
    try {
      return JSON.parse(EncryptionManager.decrypt(encrypted));
    } catch {
      return {};
    }
  }
}
