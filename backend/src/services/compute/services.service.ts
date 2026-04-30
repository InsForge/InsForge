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
  /**
   * Image URL — image-mode (any registry) or source-mode (digest-pinned
   * registry.fly.io ref produced by the CLI's flyctl remote build + push).
   *
   * Required for createService (immediate launch path). Omit for
   * prepareForDeploy (which creates the Fly app without launching a machine
   * — the CLI then runs flyctl, then PATCH triggers launch with the new image).
   */
  imageUrl?: string;
  port: number;
  cpu: string;
  memory: number;
  region: string;
  envVars?: Record<string, string>;
}

export interface UpdateServiceInput {
  /**
   * New image URL — image-mode (any registry) or source-mode digest-pinned
   * registry.fly.io ref. For non-image updates (port-only, env-only) omit.
   */
  imageUrl?: string;
  port?: number;
  cpu?: string;
  memory?: number;
  region?: string;
  /** Wholesale env replacement. Mutually exclusive with envVarsPatch. */
  envVars?: Record<string, string>;
  /**
   * Partial env edit — apply set/unset against the currently-stored env vars.
   * Lets the CLI rotate one secret without re-stating the other six (the
   * GET path doesn't return env values, so the merge has to happen here).
   */
  envVarsPatch?: { set?: Record<string, string>; unset?: string[] };
}

/**
 * Snapshot returned from deleteService — captures everything needed to
 * reconstruct a service if a delete turns out to have been a mistake. The
 * route writes this into the audit log; nothing else consumes it. Env vars
 * are passed through as the still-encrypted ciphertext so the audit log
 * never contains secret values in plaintext.
 */
export interface DeletedServiceSnapshot {
  id: string;
  projectId: string;
  name: string;
  imageUrl: string;
  port: number;
  cpu: string;
  memory: number;
  region: string;
  flyAppId: string | null;
  flyMachineId: string | null;
  endpointUrl: string | null;
  envVarsEncrypted: string | null;
  createdAt: string;
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

// Default to Fly's own .fly.dev hostname (which Fly routes automatically for
// every app). Operators owning a custom domain can set COMPUTE_DOMAIN; otherwise
// we return a URL that actually resolves instead of a vanity domain the operator
// doesn't control.
function makeEndpointUrl(flyAppName: string): string {
  const domain = config.fly.domain || 'fly.dev';
  return `https://${flyAppName}.${domain}`;
}

// Cloud-mode providers wrap the cloud's structured error body verbatim into
// AppError.message (a JSON string like
// `{"code":"COMPUTE_QUOTA_EXCEEDED","error":"…","nextActions":[…]}`).
// Rewrap so callers see the cloud's actual code/message/nextActions instead
// of a generic "Compute service operation failed" 502. Falls back to a 502
// with the provided default message if the input isn't a recognizable
// AppError.
function rewrapCloudError(error: unknown, defaultMessage: string): AppError {
  if (error instanceof AppError) {
    let parsed: { code?: string; error?: string; nextActions?: string[] } | undefined;
    try {
      parsed = JSON.parse(error.message);
    } catch {
      parsed = undefined;
    }
    return new AppError(
      parsed?.error ?? error.message,
      error.statusCode,
      (parsed?.code as keyof typeof ERROR_CODES & string) ??
        error.code ??
        ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED,
      parsed?.nextActions?.join('; ')
    );
  }
  return new AppError(
    error instanceof Error ? error.message : defaultMessage,
    502,
    ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
  );
}

export function selectComputeProvider(): ComputeProvider {
  // Self-host takes precedence: if FLY_API_TOKEN is set, the user has their own
  // Fly account and wants direct control. Otherwise fall through to cloud-proxy
  // (PROJECT_ID + CLOUD_API_HOST + JWT_SECRET all present).
  const fly = FlyProvider.getInstance();
  if (fly.isConfigured()) {
    if (!config.fly.org) {
      // FLY_ORG used to default to "insforge" — our internal org. Operators
      // who copied .env.example verbatim got opaque "unauthorized" errors
      // from Fly. Warn loudly at provider selection time instead.
      logger.warn(
        'Compute self-host: FLY_ORG is empty. Set FLY_ORG to your Fly org slug ' +
          '(`fly orgs list`); compute requests will otherwise fail with auth errors from Fly.'
      );
    }
    return fly;
  }

  const cloud = CloudComputeProvider.getInstance();
  if (cloud.isConfigured()) {
    return cloud;
  }

  throw new AppError(
    'Compute services not configured.',
    503,
    ERROR_CODES.COMPUTE_NOT_CONFIGURED,
    'Self-hosted: set COMPUTE_SERVICES_ENABLED=true and FLY_API_TOKEN in .env. ' +
      'Cloud: ensure PROJECT_ID, CLOUD_API_HOST, and JWT_SECRET are set (provisioned by insforge-cloud).'
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

  // Fetch a Fly deploy token for an existing service. Used by the CLI so
  // `compute deploy` can run flyctl without the user holding their own
  // FLY_API_TOKEN. Cloud mode only — self-hosted users with their own Fly
  // account already have a token and don't need this path.
  async issueDeployTokenForService(
    serviceId: string
  ): Promise<{ token: string; expirySeconds: number }> {
    const fly = this.getCompute();
    if (!(fly instanceof CloudComputeProvider)) {
      throw new AppError(
        'Deploy-token issuance is only supported in cloud-managed mode. ' +
          'Self-hosters with FLY_API_TOKEN set already have a token and do not need this endpoint.',
        400,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED
      );
    }
    const service = await this.getService(serviceId);
    if (!service.flyAppId) {
      throw new AppError(
        `Service ${serviceId} has no Fly app yet — call /api/compute/services/deploy first to create the app.`,
        400,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED
      );
    }
    return fly.issueDeployToken(service.flyAppId);
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

    // createService is the image-mode immediate-launch path; imageUrl is required.
    // (Source mode goes through prepareForDeploy → CLI flyctl → PATCH-launches-machine.)
    if (!input.imageUrl) {
      throw new AppError('imageUrl is required for createService.', 400, ERROR_CODES.INVALID_INPUT);
    }
    const recordedImageUrl = input.imageUrl;

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
          recordedImageUrl,
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
    const endpointUrl = makeEndpointUrl(flyAppName);

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

      throw rewrapCloudError(error, 'Compute service operation failed');
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
    const endpointUrl = makeEndpointUrl(flyAppName);

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
        // Clean up DB record AND any partially-created Fly app to avoid an
        // orphaned Fly app under our org that we can't see in the dashboard.
        // (e.g. allocatePublicIps fails after createApp succeeds — the catch
        // here used to only delete the row, leaving the Fly app behind to
        // accrue cost and consume the org's app slot.) Mirrors createService
        // and deployService cleanup. Best-effort: log and swallow on Fly
        // errors so the original error still propagates.
        try {
          await fly.destroyApp(flyAppName);
        } catch (destroyError) {
          logger.error('Failed to clean up orphaned Fly app after prepareForDeploy failure', {
            flyAppName,
            error: destroyError,
          });
        }
        await this.getPool().query(`DELETE FROM compute.services WHERE id = $1`, [
          insertResult.rows[0].id,
        ]);
        throw error;
      }
    }

    logger.info('Compute service prepared for deploy', { flyAppName });
    return mapRowToSchema(insertResult.rows[0]);
  }

  async updateService(id: string, data: UpdateServiceInput): Promise<ServiceSchema> {
    const existing = await this.getService(id);

    // Mutual exclusion is also enforced by the zod schema at the route layer,
    // but defensively re-check here so service-level callers (cron, tests) get
    // the same guarantee.
    if (data.envVars !== undefined && data.envVarsPatch !== undefined) {
      throw new AppError(
        'envVars and envVarsPatch are mutually exclusive',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    // Resolve envVarsPatch to a concrete envVars value before the existing
    // pipeline runs. Doing it here means the rest of the function — the
    // SQL update list, the Fly updateMachine/launchMachine merge, the
    // hasDeployChange check — all stay untouched. The CLI sends a sparse
    // patch; the storage layer keeps writing one full encrypted blob.
    if (data.envVarsPatch !== undefined) {
      const existingRow = await this.getPool().query<{ env_vars_encrypted: string | null }>(
        `SELECT env_vars_encrypted FROM compute.services WHERE id = $1`,
        [id]
      );
      const current = this.decryptEnvVars(existingRow.rows[0]?.env_vars_encrypted ?? null);
      const merged = { ...current, ...(data.envVarsPatch.set ?? {}) };
      for (const key of data.envVarsPatch.unset ?? []) {
        delete merged[key];
      }
      // Replace envVarsPatch with the resolved envVars; downstream code
      // doesn't need to know which API surface the caller used.
      data = { ...data, envVars: merged, envVarsPatch: undefined };
    }

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
      // Region change on a deployed machine is meaningless: Fly machines
      // can't be moved between regions in-place. Persisting it would let
      // the API/UI report a region the machine isn't actually running in.
      // Force the user to delete + redeploy.
      if (data.region !== existing.region && existing.flyAppId && existing.flyMachineId) {
        throw new AppError(
          `Cannot change region for a deployed service. Delete and redeploy in region "${data.region}" instead.`,
          400,
          ERROR_CODES.COMPUTE_REGION_CHANGE_NOT_SUPPORTED
        );
      }
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

    // env_vars merge is needed by both Fly-touching branches (updateMachine
    // for redeploy, launchMachine for first-deploy). Hoist the SELECT so we
    // only hit the DB once.
    let mergedEnvVars: Record<string, string> | undefined;
    if (hasDeployChange && existing.flyAppId) {
      const existingRow = await this.getPool().query(
        `SELECT env_vars_encrypted FROM compute.services WHERE id = $1`,
        [id]
      );
      const existingEnvVarsEncrypted: string | null =
        existingRow.rows[0]?.env_vars_encrypted ?? null;
      mergedEnvVars = data.envVars ?? this.decryptEnvVars(existingEnvVarsEncrypted);
    }

    // Path A first-launch sets this so the final UPDATE can apply an
    // optimistic lock (`AND fly_machine_id IS NULL`) and self-heal if a
    // concurrent request also launched a machine.
    let justLaunchedMachineId: string | undefined;

    if (hasDeployChange && existing.flyAppId && existing.flyMachineId) {
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
          envVars: mergedEnvVars ?? {},
        });
        logger.info('Compute service machine updated', { id });
      } catch (error) {
        logger.error('Failed to update machine on Fly', { id, error });
        throw rewrapCloudError(error, 'Compute service operation failed');
      }
    } else if (data.imageUrl && existing.flyAppId && !existing.flyMachineId) {
      // Path A: prepareForDeploy created the app + DB row but no machine.
      // CLI has now built+pushed the image (via flyctl remote builder, or
      // pre-built --image URL) and is telling us to launch the machine.
      try {
        const { machineId } = await this.getCompute().launchMachine({
          appId: existing.flyAppId,
          image: data.imageUrl,
          port: data.port ?? existing.port,
          cpu: data.cpu ?? existing.cpu,
          memory: data.memory ?? existing.memory,
          envVars: mergedEnvVars ?? {},
          region: data.region ?? existing.region,
        });
        justLaunchedMachineId = machineId;
        // Persist machine id + flip status alongside the field updates below.
        updates.push(`fly_machine_id = $${paramIdx++}`);
        values.push(machineId);
        updates.push(`status = $${paramIdx++}`);
        values.push('running');
        updates.push(`endpoint_url = $${paramIdx++}`);
        values.push(makeEndpointUrl(existing.flyAppId));
        logger.info('Compute service machine launched (Path A)', { id, machineId });
      } catch (error) {
        logger.error('Failed to launch machine on Fly (Path A)', { id, error });
        throw rewrapCloudError(error, 'Compute service operation failed');
      }
    }

    // Fly accepted the update (or no Fly update was needed) — now commit to DB.
    // For a first-launch, append `AND fly_machine_id IS NULL` so a concurrent
    // PATCH (CLI retry, double-click) that also raced to launchMachine loses
    // the DB write. The loser then destroys the orphan machine it just made.
    values.push(id);
    const whereClause =
      justLaunchedMachineId !== undefined
        ? `WHERE id = $${paramIdx} AND fly_machine_id IS NULL`
        : `WHERE id = $${paramIdx}`;
    const result = await this.getPool().query(
      `UPDATE compute.services SET ${updates.join(', ')} ${whereClause} RETURNING *`,
      values
    );

    if (!result.rows.length) {
      if (justLaunchedMachineId !== undefined && existing.flyAppId) {
        // Lost a launch race: another request already wrote fly_machine_id.
        // Destroy the machine we just created so it doesn't keep billing.
        // Best-effort — even if the destroy itself fails, returning the
        // current row is still correct (the winning machine is healthy).
        try {
          await this.getCompute().destroyMachine(existing.flyAppId, justLaunchedMachineId);
          logger.info('Cleaned up orphan machine from launch race', {
            id,
            orphanMachineId: justLaunchedMachineId,
          });
        } catch (cleanupErr) {
          logger.error('Failed to destroy orphan machine after launch race', {
            id,
            orphanMachineId: justLaunchedMachineId,
            error: cleanupErr,
          });
        }
        return this.getService(id);
      }
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    return mapRowToSchema(result.rows[0]);
  }

  async deleteService(id: string): Promise<DeletedServiceSnapshot> {
    // Fetch the raw row (not the schema) so we can capture the encrypted env
    // blob in the snapshot. mapRowToSchema strips env_vars_encrypted by design;
    // for the audit-log snapshot we want the ciphertext so a future restore
    // path could re-deploy with the same secrets without exposing them here.
    const result = await this.getPool().query<ServiceRow>(
      `SELECT * FROM compute.services WHERE id = $1`,
      [id]
    );
    if (!result.rows.length) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }
    const row = result.rows[0];

    // Mark as destroying first so it's visible in the UI
    await this.getPool().query(`UPDATE compute.services SET status = 'destroying' WHERE id = $1`, [
      id,
    ]);

    // Fly cleanup — abort delete if cleanup fails to preserve the reference
    // Treat 404 as success (resource already destroyed)
    if (row.fly_machine_id && row.fly_app_id) {
      try {
        await this.getCompute().destroyMachine(row.fly_app_id, row.fly_machine_id);
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

    if (row.fly_app_id) {
      try {
        await this.getCompute().destroyApp(row.fly_app_id);
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

    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      imageUrl: row.image_url,
      port: row.port,
      cpu: row.cpu,
      memory: row.memory,
      region: row.region,
      flyAppId: row.fly_app_id,
      flyMachineId: row.fly_machine_id,
      endpointUrl: row.endpoint_url,
      envVarsEncrypted: row.env_vars_encrypted,
      createdAt: row.created_at,
    };
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

    if (!result.rows.length) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

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

    if (!result.rows.length) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTION.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

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
