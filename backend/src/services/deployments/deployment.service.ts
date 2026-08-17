import { Pool, type PoolClient } from 'pg';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { Transform, type Readable, type TransformCallback } from 'stream';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  buildSitesRegistry,
  isAnySitesProviderConfigured,
  requireDomainStore,
  selectSitesProvider,
  unsupportedFeature,
} from '@/services/deployments/sites-registry.js';
import type {
  DomainConfig,
  EnvVarStore,
  SitesProvider,
  SitesProviderName,
} from '@/providers/deployments/sites.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import { AppError, UpstreamError } from '@/utils/errors.js';
import { TokenManager } from '@/infra/security/token.manager.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import {
  DeploymentStatus,
  type DeploymentRecord,
  type DeploymentStatusType,
} from '@/types/deployments.js';
import logger from '@/utils/logger.js';
import { appConfig } from '@/infra/config/app.config.js';
import {
  ERROR_CODES,
  type CreateDeploymentResponse,
  type CreateDirectDeploymentRequest,
  type CreateDirectDeploymentResponse,
  type DeploymentManifestFile,
  type UploadDeploymentFileResponse,
  type StartDeploymentRequest,
  type UpdateSlugResponse,
  type DeploymentMetadataResponse,
  type CustomDomain,
  type ListCustomDomainsResponse,
  type AddCustomDomainResponse,
  type VerifyCustomDomainResponse,
  type DeploymentsMetadataSchema,
} from '@insforge/shared-schemas';

export type {
  DeploymentRecord,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
  CustomDomain,
  ListCustomDomainsResponse,
  AddCustomDomainResponse,
  VerifyCustomDomainResponse,
};

const DEPLOYMENT_BUCKET = '_deployments';
const getDeploymentKey = (id: string) => `${id}.zip`;

interface DeploymentFileRow {
  fileId: string;
  deploymentId: string;
  path: string;
  sha: string;
  size: number;
  uploadedAt: Date | null;
}

/**
 * Keep the tail of a build log, not all of it.
 *
 * A failing `npm ci` can emit megabytes, and this lands in a jsonb column on every
 * deploy. The tail is also the useful part — the error is at the end. Storing everything
 * would turn a noisy build into a database problem.
 */
const MAX_BUILD_LOG_LINES = 200;
const MAX_BUILD_LOG_BYTES = 64 * 1024;

export function truncateBuildLogs(lines: string[]): string[] {
  const tail = lines.slice(-MAX_BUILD_LOG_LINES);
  let bytes = 0;
  const kept: string[] = [];
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i] ?? '';
    bytes += Buffer.byteLength(line, 'utf8');
    if (bytes > MAX_BUILD_LOG_BYTES) {
      // Keep the last line even when it alone blows the budget, clipped to fit. Builders
      // emit single enormous lines — a minified bundle, a stack trace with no newlines —
      // and that is exactly when the operator needs the text rather than a bare marker.
      if (kept.length === 0) {
        // Clipped on the byte buffer, not by string index: `slice` counts UTF-16 units, so
        // a line of multibyte output would have stored roughly twice the budget.
        const marker = '… (line truncated)';
        const room = MAX_BUILD_LOG_BYTES - Buffer.byteLength(marker, 'utf8');
        const clipped = Buffer.from(line, 'utf8').subarray(0, room).toString('utf8');
        kept.unshift(`${clipped}${marker}`);
      }
      break;
    }
    kept.unshift(line);
  }
  const dropped = lines.length - kept.length;
  return dropped > 0 ? [`… ${dropped} earlier line(s) omitted`, ...kept] : kept;
}

export class DeploymentService {
  private static instance: DeploymentService;
  private pool: Pool | null = null;
  private s3Provider: S3StorageProvider | null = null;

  private constructor() {
    this.initializeS3Provider();
  }

  /**
   * The active driver, resolved per call.
   *
   * Not held on the instance: Vercel credentials can be stored through the dashboard,
   * and a provider captured in the constructor would predate them. Throws
   * DEPLOYMENT_NOT_CONFIGURED when nothing can serve a deployment, which is why callers
   * that only want to *report* availability use `isConfigured()` instead.
   */
  private get provider(): SitesProvider {
    return selectSitesProvider();
  }

  /**
   * The driver that made this row, not whichever one is default now.
   *
   * `deployments.runs.provider` records it precisely so that switching SITES_PROVIDER
   * cannot send a Vercel deployment's id to Docker — the id means nothing to the other
   * driver, and for rollback the other driver may not even offer it. Falls back to the
   * active default only for rows written before this column carried the truth.
   */
  private providerFor(record: { provider?: string | null }): SitesProvider {
    const active = this.provider;
    const name = record.provider;
    // The overwhelmingly common case, and it needs no registry lookup: the row was made
    // by whatever is serving now. A missing name means a row older than this column
    // carrying the truth.
    if (!name || name === active.name) {
      return active;
    }
    const registry = buildSitesRegistry();
    const owner = registry.providers.get(name as SitesProviderName);
    if (!owner) {
      throw new AppError(
        `This deployment was made by the ${name} driver, which is not configured here.`,
        409,
        ERROR_CODES.DEPLOYMENT_NOT_CONFIGURED,
        `Set SITES_PROVIDER=${name} and its credentials to operate on it.`
      );
    }
    return owner;
  }

  private initializeS3Provider(): void {
    const s3Bucket = appConfig.storage.s3Bucket;
    const appKey = appConfig.storage.appKey;

    if (s3Bucket) {
      this.s3Provider = new S3StorageProvider(s3Bucket, appKey, appConfig.storage.s3Region);
      this.s3Provider.initialize();
    }
  }

  public static getInstance(): DeploymentService {
    if (!DeploymentService.instance) {
      DeploymentService.instance = new DeploymentService();
    }
    return DeploymentService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Deployments slice for admin /api/metadata (gated behind verifyAdmin).
   *
   * Cloud-only: returns `undefined` in self-hosted backends so the metadata
   * route omits the slice entirely. The CLI's capability probe uses
   * presence/absence to gate `[deployments]` TOML sections — self-host
   * users naturally skip features they can't use, without ever issuing a
   * PUT to the cloud-only slug endpoint.
   *
   * `customSlug: null` means cloud + slug not set (project uses default URL).
   */
  async getConfigMetadata(): Promise<DeploymentsMetadataSchema | undefined> {
    if (!isCloudEnvironment()) {
      return undefined;
    }
    try {
      const customSlug = this.provider.slug ? await this.provider.slug.get() : null;
      return { customSlug };
    } catch (error) {
      // Cloud slug lookup hits CLOUD_API_HOST + Vercel; transient failures
      // here must not take down the whole /api/metadata response. Surface
      // the slice with a null slug so the CLI still sees the cloud signal
      // (it'll just skip the [deployments] section as if no slug is set).
      logger.warn('deployments.customSlug lookup failed; reporting null slug', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { customSlug: null };
    }
  }

  private isReservedHostedDomain(domain: string): boolean {
    return domain.endsWith('.vercel.app') || domain.endsWith('.insforge.site');
  }

  private pickPreferredARecord(config: DomainConfig): string | null {
    const rankOneValues = (config.recommendedIPv4 ?? [])
      .filter((record) => record.rank === 1)
      .flatMap((record) => record.value ?? []);

    if (rankOneValues.length === 0) {
      return null;
    }

    return rankOneValues.find((value) => value === '216.150.16.1') ?? rankOneValues[0];
  }

  private toCustomDomainResponse(
    domain: {
      name: string;
      apexName: string;
      verified: boolean;
      verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
    },
    config: DomainConfig
  ): CustomDomain {
    return {
      domain: domain.name,
      apexDomain: domain.apexName,
      verified: domain.verified,
      misconfigured: config.misconfigured ?? false,
      verification: (domain.verification ?? []).map((record) => ({
        type: record.type,
        domain: record.domain,
        value: record.value,
      })),
      cnameTarget: config.recommendedCNAME?.find((record) => record.rank === 1)?.value ?? null,
      aRecordValue: this.pickPreferredARecord(config),
    };
  }

  private async getCustomDomainConfigOrEmpty(
    configDomain: string,
    requestedDomain: string
  ): Promise<DomainConfig> {
    try {
      return await requireDomainStore().config(configDomain);
    } catch (error) {
      logger.warn('Vercel domain config lookup failed; continuing without DNS hints', {
        requestedDomain,
        configDomain,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Check if deployment service is configured
   * Cloud deployments use credentials from the cloud API.
   * Self-hosted deployments use Vercel credentials from environment variables.
   */
  isConfigured(): boolean {
    return isAnySitesProviderConfigured();
  }

  /**
   * Apply env vars the way the active driver can.
   *
   * A driver with a runtime store keeps them and the build reads them from there. A
   * `build-only` driver has nowhere to keep them, so they travel with the deployment and
   * are baked into the artifact — which is why they are returned rather than stored. A
   * driver with neither refuses, because silently dropping values a caller asked for
   * would produce a site built without its configuration.
   */
  private async applyEnvVars(
    envVars: Array<{ key: string; value: string }> | undefined,
    /**
     * The driver that will build this deployment — the row's owner, not the current
     * default. Passing the wrong one sends a Docker deployment's variables to Vercel's
     * project API while the container that runs gets none, which is the exact confusion
     * the seam exists to remove.
     */
    provider: SitesProvider
  ): Promise<Array<{ key: string; value: string }> | undefined> {
    const mode = provider.capabilities().envVars;

    if (mode === 'runtime' && !provider.envVars) {
      // The driver holds nothing itself, so we do — otherwise a deploy that passes no
      // variables would silently start a server without the configuration the last one
      // had, which for an SSR app means a site that boots and then fails on every request.
      if (envVars && envVars.length > 0) {
        // Through the same queue the management API uses: this is a read-modify-write against
        // one secret row, and a dashboard save racing a deploy otherwise loses one of them.
        await this.serializeEnvWrite(() => this.storeSiteEnvVars(envVars));
        return envVars;
      }
      return await this.loadSiteEnvVars();
    }

    if (!envVars || envVars.length === 0) {
      return undefined;
    }
    if (provider.envVars) {
      await provider.envVars.upsert(envVars);
      return undefined;
    }
    if (mode === 'build-only') {
      return envVars;
    }
    throw unsupportedFeature(provider.name, 'environment variables');
  }

  /**
   * The site's environment, encrypted in the secret store under one reserved key.
   *
   * One row rather than one per variable: the set is replaced atomically on each deploy, and
   * a partially-applied environment is worse than an old one. Reserved so it does not show
   * up as a user-managed secret in the dashboard.
   */
  private static readonly SITE_ENV_SECRET_KEY = 'SITES_RUNTIME_ENV';

  /** Serializes writes to the one secret row the site environment lives in. */
  private envWriteQueue: Promise<void> = Promise.resolve();

  /** Run `work` after every write already queued, whatever their outcome. */
  private serializeEnvWrite<T>(work: () => Promise<T>): Promise<T> {
    const next = this.envWriteQueue.then(work, work);
    this.envWriteQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async storeSiteEnvVars(envVars: Array<{ key: string; value: string }>): Promise<void> {
    const secrets = SecretService.getInstance();
    const serialized = JSON.stringify(envVars);
    const existing = await secrets.getSecretByKey(DeploymentService.SITE_ENV_SECRET_KEY);
    if (existing === null) {
      try {
        await secrets.createSecret({
          key: DeploymentService.SITE_ENV_SECRET_KEY,
          value: serialized,
          isReserved: true,
        });
        return;
      } catch (error) {
        // Two deploys racing the first write both saw no secret, and the loser used to fail
        // the whole deployment over a row that now exists. Falling through to the update is
        // the same end state either way.
        if (!(error instanceof AppError) || error.code !== ERROR_CODES.SECRET_ALREADY_EXISTS) {
          throw error;
        }
      }
    }
    await secrets.updateSecretByKey(DeploymentService.SITE_ENV_SECRET_KEY, { value: serialized });
  }

  private async loadSiteEnvVars(): Promise<Array<{ key: string; value: string }> | undefined> {
    try {
      const stored = await SecretService.getInstance().getSecretByKey(
        DeploymentService.SITE_ENV_SECRET_KEY
      );
      if (!stored) {
        return undefined;
      }
      const parsed: unknown = JSON.parse(stored);
      return Array.isArray(parsed) ? (parsed as Array<{ key: string; value: string }>) : undefined;
    } catch (error) {
      // Deliberately fatal. Deploying without the stored environment starts a server whose
      // every request fails on missing configuration, and start-new-then-stop-old means the
      // previous deployment keeps serving while this one fails — a failed deploy is strictly
      // better than a live site that 500s.
      logger.error('Could not read the stored site environment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError(
        'The stored site environment could not be read, so this deployment would start without it.',
        500,
        ERROR_CODES.INTERNAL_ERROR,
        'Re-save the environment variables, or delete the SITES_RUNTIME_ENV secret to start clean.'
      );
    }
  }

  /**
   * The store the environment-variable API works against.
   *
   * A driver that keeps variables itself hands over its own. A driver that reports
   * `runtime` but keeps nothing — the Docker one — gets the store this service already uses
   * on the deploy path, because otherwise `runtime` would be a capability whose management
   * API refuses every call: a button that does nothing, which is what capability flags
   * exist to prevent.
   */
  envVarStore(): EnvVarStore {
    const provider = this.provider;
    if (provider.envVars) {
      return provider.envVars;
    }
    if (provider.capabilities().envVars === 'runtime') {
      return this.secretEnvVarStore();
    }
    throw unsupportedFeature(provider.name, 'environment variables');
  }

  /**
   * `EnvVarStore` over the one reserved secret.
   *
   * The key is the id. There is no separate identifier to hand out — the set is a JSON
   * array in one secret, keys are unique within it, and inventing surrogate ids would make
   * them change under the caller on every write.
   */
  private secretEnvVarStore(): EnvVarStore {
    const load = async () => (await this.loadSiteEnvVars()) ?? [];
    // The merge below is read-modify-write against one secret row, so two concurrent
    // requests would each write their own view and the later one would drop the other's
    // variable. Serialized the same way the driver serializes container switches.
    const serialize = <T>(work: () => Promise<T>): Promise<T> => this.serializeEnvWrite(work);
    return {
      keys: async () => (await load()).map((envVar) => envVar.key),
      // `encrypted` is the truth here: they live in the secret store, encrypted at rest.
      list: async () =>
        (await load()).map((envVar) => ({
          id: envVar.key,
          key: envVar.key,
          type: 'encrypted',
        })),
      get: async (envId: string) => {
        const found = (await load()).find((envVar) => envVar.key === envId);
        if (!found) {
          throw new AppError(
            `No environment variable named ${envId}.`,
            404,
            ERROR_CODES.SECRET_NOT_FOUND
          );
        }
        return { id: found.key, key: found.key, value: found.value, type: 'encrypted' };
      },
      // Merged, not replaced: this is the management API, where a caller sending one
      // variable means "set this one". The deploy path replaces the whole set on purpose,
      // since a half-applied environment is worse than the previous one.
      upsert: (envVars) =>
        serialize(async () => {
          const merged = new Map((await load()).map((envVar) => [envVar.key, envVar.value]));
          for (const envVar of envVars) {
            merged.set(envVar.key, envVar.value);
          }
          await this.storeSiteEnvVars([...merged].map(([key, value]) => ({ key, value })));
        }),
      remove: (envId: string) =>
        serialize(async () => {
          const existing = await load();
          const remaining = existing.filter((envVar) => envVar.key !== envId);
          if (remaining.length === existing.length) {
            throw new AppError(
              `No environment variable named ${envId}.`,
              404,
              ERROR_CODES.SECRET_NOT_FOUND
            );
          }
          await this.storeSiteEnvVars(remaining);
        }),
    };
  }

  private assertDeploymentServiceConfigured(): void {
    // Resolving the driver is the check: buildSitesRegistry() throws with the reason —
    // nothing configured, SITES_PROVIDER=off, or a named driver that is unusable — and
    // each of those is more actionable than one generic "not configured" message.
    selectSitesProvider();
  }

  /**
   * Create a new deployment record with WAITING status
   * Returns presigned S3 upload info for the legacy zip upload flow
   */
  async createDeployment(): Promise<CreateDeploymentResponse> {
    this.assertDeploymentServiceConfigured();

    if (!this.s3Provider) {
      throw new AppError(
        'S3 storage is required for legacy deployments. Please configure S3_BUCKET.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      // Create deployment record in database with WAITING status
      const result = await this.getPool().query(
        `INSERT INTO deployments.runs (provider, status, metadata)
         VALUES ($1, $2, $3)
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [this.provider.name, DeploymentStatus.WAITING, JSON.stringify({ uploadMode: 'legacy' })]
      );

      const deployment = result.rows[0] as DeploymentRecord;

      const deploymentMaxBytes = this.getMaxDeploymentTotalBytes();
      const uploadInfo = await this.s3Provider.getUploadStrategy(
        DEPLOYMENT_BUCKET,
        getDeploymentKey(deployment.id),
        { size: deploymentMaxBytes },
        deploymentMaxBytes
      );

      logger.info('Deployment record created', {
        id: deployment.id,
        status: deployment.status,
        uploadMode: 'legacy',
      });

      return {
        id: deployment.id,
        uploadUrl: uploadInfo.uploadUrl,
        uploadFields: uploadInfo.fields || {},
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to create deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to create deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Create a new direct-upload deployment record with WAITING status and file manifest
   */
  async createDirectDeployment(
    input: CreateDirectDeploymentRequest
  ): Promise<CreateDirectDeploymentResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const files = this.validateDeploymentManifest(input.files);
      const totalSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
      const client = await this.getPool().connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `INSERT INTO deployments.runs (provider, status, metadata)
           VALUES ($1, $2, $3)
           RETURNING
             id,
             provider_deployment_id as "providerDeploymentId",
             provider,
             status,
             url,
             metadata,
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [
            this.provider.name,
            DeploymentStatus.WAITING,
            JSON.stringify({
              uploadMode: 'direct',
              fileCount: files.length,
              totalSizeBytes,
              manifestCreatedAt: new Date().toISOString(),
            }),
          ]
        );

        const deployment = result.rows[0] as DeploymentRecord;
        const insertedFiles = await this.insertDeploymentFiles(client, deployment.id, files);

        await client.query('COMMIT');

        logger.info('Direct deployment record created', {
          id: deployment.id,
          status: deployment.status,
          fileCount: files.length,
          totalSizeBytes,
        });

        return {
          id: deployment.id,
          status: deployment.status,
          files: insertedFiles.map((row) => this.toDeploymentFileResponse(row)),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to create direct deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to create direct deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Stream one registered deployment file through the backend to Vercel.
   */
  async uploadDeploymentFileContent(
    id: string,
    fileId: string,
    content: Readable,
    options: { signal?: AbortSignal } = {}
  ): Promise<UploadDeploymentFileResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
      }

      if (
        deployment.status !== DeploymentStatus.WAITING &&
        deployment.status !== DeploymentStatus.UPLOADING
      ) {
        throw new AppError(
          `Deployment files can only be uploaded while status is WAITING or UPLOADING. Current status: ${deployment.status}`,
          400,
          ERROR_CODES.DEPLOYMENT_INVALID_FILE
        );
      }

      const file = await this.getDeploymentFileById(id, fileId);

      if (!file) {
        throw new AppError(
          `Deployment file not found: ${fileId}`,
          404,
          ERROR_CODES.DEPLOYMENT_NOT_FOUND
        );
      }

      if (this.getUploadMode(deployment, 1) !== 'direct') {
        throw new AppError(
          'Deployment files can only be uploaded for direct deployments.',
          400,
          ERROR_CODES.DEPLOYMENT_INVALID_FILE
        );
      }

      await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING, {
        lastFileUploadStartedAt: new Date().toISOString(),
      });

      // The row's own driver: if the default changed between creating this deployment and
      // uploading to it, the bytes would land in a driver that will never build them while
      // the database recorded the file as uploaded.
      await this.providerFor(deployment).uploadFileStream({
        content: this.createValidatedFileStream(content, file.sha, file.size),
        sha: file.sha,
        size: file.size,
        signal: options.signal,
      });

      const updateResult = await this.getPool().query<DeploymentFileRow>(
        `UPDATE deployments.files
         SET uploaded_at = NOW()
         WHERE deployment_id = $1 AND id = $2
         RETURNING
           id as "fileId",
           deployment_id as "deploymentId",
           file_path as "path",
           sha,
           size_bytes as "size",
           uploaded_at as "uploadedAt"`,
        [id, fileId]
      );

      const uploadedFile = updateResult.rows[0];
      if (!uploadedFile?.uploadedAt) {
        throw new AppError(
          'Failed to mark deployment file as uploaded',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING, {
        lastFileUploadedAt: new Date().toISOString(),
      });

      logger.info('Deployment file uploaded', {
        deploymentId: id,
        fileId,
        path: uploadedFile.path,
        size: uploadedFile.size,
      });

      const response = this.toDeploymentFileResponse(uploadedFile);
      return {
        ...response,
        uploadedAt: response.uploadedAt ?? uploadedFile.uploadedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to upload deployment file', {
        error: error instanceof Error ? error.message : String(error),
        id,
        fileId,
      });
      throw new AppError('Failed to upload deployment file', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Start a deployment - create deployment on Vercel from uploaded file SHAs
   */
  async startDeployment(id: string, input: StartDeploymentRequest = {}): Promise<DeploymentRecord> {
    this.assertDeploymentServiceConfigured();

    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
      }

      if (
        deployment.status !== DeploymentStatus.WAITING &&
        deployment.status !== DeploymentStatus.UPLOADING
      ) {
        throw new AppError(
          `Deployment is not ready to start. Current status: ${deployment.status}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const files = await this.getDeploymentFiles(id);
      const uploadMode = this.getUploadMode(deployment, files.length);

      // Resolved once, from the row: every step of a start — uploads, the build, the URL
      // it records — has to go to the driver that created it, not to whichever one is
      // default by the time someone presses deploy.
      const provider = this.providerFor(deployment);

      if (uploadMode === 'direct') {
        return await this.startDirectDeployment(id, input, files, provider);
      }

      return await this.startLegacyDeployment(id, input, provider);
    } catch (error) {
      if (error instanceof AppError) {
        // A 5xx means the deploy itself failed — a build that did not compile, a container
        // that would not start, an upstream refusal. The row was set to UPLOADING on the way
        // in, so returning without touching it left the run mid-flight forever and threw
        // away the message, which for the Docker driver carries the build output.
        //
        // A 4xx is the caller's own request (files not uploaded yet, no build command
        // declared, wrong status). Those stay retryable: marking the row ERROR would make
        // `startDeployment` refuse the corrected retry.
        if (error.statusCode >= 500) {
          await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
            error: error.message,
          }).catch(() => {});
        }
        throw error;
      }
      logger.error('Failed to start deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      // Update status to ERROR
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {});
      throw new AppError('Failed to start deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  private getUploadMode(
    deployment: DeploymentRecord,
    registeredFileCount: number = 0
  ): 'direct' | 'legacy' {
    const uploadMode = deployment.metadata?.uploadMode;
    if (uploadMode === 'direct' || uploadMode === 'legacy') {
      return uploadMode;
    }

    return registeredFileCount > 0 ? 'direct' : 'legacy';
  }

  private async startDirectDeployment(
    id: string,
    input: StartDeploymentRequest,
    files: DeploymentFileRow[],
    provider: SitesProvider
  ): Promise<DeploymentRecord> {
    if (files.length === 0) {
      throw new AppError(
        'Deployment files have not been registered.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const missingFiles = files.filter((file) => !file.uploadedAt);
    if (missingFiles.length > 0) {
      throw new AppError(
        `Deployment has ${missingFiles.length} file(s) that have not been uploaded yet.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING);

    const buildEnvVars = await this.applyEnvVars(input.envVars, provider);

    const uploadedFiles = files.map((file) => ({
      file: file.path,
      sha: file.sha,
      size: file.size,
    }));

    return await this.createProviderDeploymentFromUploadedFiles(
      id,
      input,
      uploadedFiles,
      'direct',
      provider,
      buildEnvVars
    );
  }

  private async startLegacyDeployment(
    id: string,
    input: StartDeploymentRequest,
    provider: SitesProvider
  ): Promise<DeploymentRecord> {
    if (!this.s3Provider) {
      throw new AppError(
        'S3 storage is required for legacy deployments. Please configure S3_BUCKET.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING);

    const { exists: zipExists } = await this.s3Provider.verifyObjectExists(
      DEPLOYMENT_BUCKET,
      getDeploymentKey(id)
    );
    if (!zipExists) {
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: 'Source zip file not found. Please upload the source files first.',
      });
      throw new AppError(
        'Source zip file not found. Please upload the source files first.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const zipBuffer = await this.s3Provider.getObject(DEPLOYMENT_BUCKET, getDeploymentKey(id));
    if (!zipBuffer) {
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: 'Failed to download source zip file.',
      });
      throw new AppError('Failed to download source zip file.', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    const files = this.extractFilesFromZip(zipBuffer);
    if (files.length === 0) {
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: 'No files found in source zip.',
      });
      throw new AppError('No files found in source zip.', 400, ERROR_CODES.DEPLOYMENT_INVALID_FILE);
    }

    const buildEnvVars = await this.applyEnvVars(input.envVars, provider);

    const uploadedFiles = await provider.uploadFiles(files);
    const deployment = await this.createProviderDeploymentFromUploadedFiles(
      id,
      input,
      uploadedFiles,
      'legacy',
      provider,
      buildEnvVars
    );

    await this.s3Provider.deleteObject(DEPLOYMENT_BUCKET, getDeploymentKey(id)).catch((error) => {
      logger.warn('Failed to clean up deployment zip', {
        deploymentId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return deployment;
  }

  private extractFilesFromZip(zipBuffer: Buffer): Array<{ path: string; content: Buffer }> {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const files: Array<{ path: string; content: Buffer }> = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }

      let filePath = entry.entryName;
      filePath = filePath.replace(/\\/g, '/');
      while (filePath.startsWith('/')) {
        filePath = filePath.substring(1);
      }
      while (filePath.startsWith('./')) {
        filePath = filePath.substring(2);
      }

      files.push({
        path: this.normalizeDeploymentFilePath(filePath),
        content: entry.getData(),
      });
    }

    return files;
  }

  private async createProviderDeploymentFromUploadedFiles(
    id: string,
    input: StartDeploymentRequest,
    uploadedFiles: Array<{ file: string; sha: string; size: number }>,
    uploadMode: 'direct' | 'legacy',
    /**
     * The driver that owns this row. Passed in rather than re-read: the files were uploaded
     * to it, so building through whichever driver happens to be default now would build
     * from files it never received.
     */
    provider: SitesProvider,
    /** Present only for a build-only driver — see applyEnvVars. */
    buildEnvVars?: Array<{ key: string; value: string }>
  ): Promise<DeploymentRecord> {
    const totalSizeBytes = uploadedFiles.reduce((sum, file) => sum + file.size, 0);

    const deployment = await provider.createDeploymentWithFiles(uploadedFiles, {
      projectSettings: input.projectSettings,
      meta: input.meta,
      ...(buildEnvVars ? { envVars: buildEnvVars } : {}),
    });

    const providerStatus = (deployment.readyState || deployment.state || 'BUILDING').toUpperCase();

    // Tolerant on purpose: this runs on every deploy, and a driver that bakes values into
    // the artifact has no store to read back — the keys it was given are recorded instead.
    const envVarKeys = provider.envVars
      ? await provider.envVars.keys()
      : (buildEnvVars ?? []).map((envVar) => envVar.key);

    const updateResult = await this.getPool().query(
      `UPDATE deployments.runs
       SET provider_deployment_id = $1,
           status = $2,
           url = $3,
           metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
       WHERE id = $5
       RETURNING
         id,
         provider_deployment_id as "providerDeploymentId",
         provider,
         status,
         url,
         metadata,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        deployment.id,
        providerStatus,
        this.getDeploymentUrl(deployment.url, provider),
        JSON.stringify({
          vercelName: deployment.name,
          fileCount: uploadedFiles.length,
          totalSizeBytes,
          envVarKeys,
          uploadMode,
          startedAt: new Date().toISOString(),
          ...(deployment.buildLogs?.length
            ? { buildLogs: truncateBuildLogs(deployment.buildLogs) }
            : {}),
        }),
        id,
      ]
    );

    logger.info('Deployment started', {
      id,
      providerDeploymentId: deployment.id,
      status: providerStatus,
      uploadMode,
    });

    return updateResult.rows[0] as DeploymentRecord;
  }

  /**
   * Get the deployment URL - uses custom domain if APP_KEY is set, otherwise falls back to provider URL
   */
  /**
   * The address to record for a deployment.
   *
   * `<APP_KEY>.insforge.site` is the shared domain our managed deploys live under, so it
   * only applies to a driver that reports the `slug` capability — that capability *is*
   * "this driver names sites under a domain it owns". Returning it unconditionally
   * whenever APP_KEY was set meant a self-hosted Docker deploy recorded a cloud hostname
   * that does not resolve for that instance, hiding the address the driver had just
   * reported. APP_KEY is generated at setup, so that was the normal case, not an edge one.
   */
  private getDeploymentUrl(providerUrl: string | null, provider: SitesProvider): string | null {
    const appKey = process.env.APP_KEY;
    if (appKey && provider.capabilities().slug) {
      return `https://${appKey}.insforge.site`;
    }
    return providerUrl;
  }

  private getMaxDeploymentFiles(): number {
    return appConfig.deployments.maxDeploymentFiles;
  }

  private getMaxDeploymentTotalBytes(): number {
    return appConfig.deployments.maxDeploymentTotalBytes;
  }

  private getMaxDeploymentFileBytes(): number {
    return appConfig.deployments.maxDeploymentFileBytes;
  }

  private normalizeDeploymentFilePath(filePath: string): string {
    if (filePath.includes('\0')) {
      throw new AppError(
        'Deployment file path cannot contain null bytes.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    if (filePath.includes('\\')) {
      throw new AppError(
        'Deployment file path must use forward slashes.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    if (filePath.startsWith('/')) {
      throw new AppError(
        'Deployment file path must be relative.',
        400,
        ERROR_CODES.DEPLOYMENT_INVALID_FILE
      );
    }

    const parts = filePath.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
      throw new AppError(
        'Deployment file path cannot contain empty, current, or parent directory segments.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    return filePath;
  }

  private validateDeploymentManifest(
    files: CreateDirectDeploymentRequest['files']
  ): CreateDirectDeploymentRequest['files'] {
    const maxFiles = this.getMaxDeploymentFiles();
    const maxTotalBytes = this.getMaxDeploymentTotalBytes();
    const maxFileBytes = this.getMaxDeploymentFileBytes();

    if (files.length > maxFiles) {
      throw new AppError(
        `Deployment files exceed the maximum of ${maxFiles} files.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const seenPaths = new Set<string>();
    let totalSizeBytes = 0;

    return files.map((file) => {
      const normalizedPath = this.normalizeDeploymentFilePath(file.path);

      if (seenPaths.has(normalizedPath)) {
        throw new AppError(
          `Duplicate deployment file path: ${normalizedPath}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      seenPaths.add(normalizedPath);

      if (file.size > maxFileBytes) {
        throw new AppError(
          `Deployment file ${normalizedPath} exceeds the maximum size of ${maxFileBytes} bytes.`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      totalSizeBytes += file.size;
      if (totalSizeBytes > maxTotalBytes) {
        throw new AppError(
          `Deployment files exceed the maximum total size of ${maxTotalBytes} bytes.`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      return {
        path: normalizedPath,
        sha: file.sha.toLowerCase(),
        size: file.size,
      };
    });
  }

  private async insertDeploymentFiles(
    client: PoolClient,
    deploymentId: string,
    files: CreateDirectDeploymentRequest['files']
  ): Promise<DeploymentFileRow[]> {
    const insertResult = await client.query<DeploymentFileRow>(
      `INSERT INTO deployments.files (deployment_id, file_path, sha, size_bytes)
       SELECT $1::uuid, file_input.file_path, file_input.sha, file_input.size_bytes
       FROM unnest($2::text[], $3::text[], $4::int[]) AS file_input(file_path, sha, size_bytes)
       RETURNING
         id as "fileId",
         deployment_id as "deploymentId",
         file_path as "path",
         sha,
         size_bytes as "size",
         uploaded_at as "uploadedAt"`,
      [
        deploymentId,
        files.map((file) => file.path),
        files.map((file) => file.sha),
        files.map((file) => file.size),
      ]
    );

    return insertResult.rows;
  }

  private toDeploymentFileResponse(row: DeploymentFileRow): DeploymentManifestFile {
    return {
      fileId: row.fileId,
      path: row.path,
      sha: row.sha,
      size: row.size,
      uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    };
  }

  private createFileValidationTransform(expectedSha: string, expectedSize: number): Transform {
    const hash = crypto.createHash('sha1');
    let receivedBytes = 0;

    return new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        receivedBytes += chunk.length;

        if (receivedBytes > expectedSize) {
          callback(
            new AppError(
              'Uploaded file is larger than the registered deployment file size.',
              400,
              ERROR_CODES.INVALID_INPUT
            )
          );
          return;
        }

        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback: TransformCallback) {
        if (receivedBytes !== expectedSize) {
          callback(
            new AppError(
              'Uploaded file size does not match the registered deployment file.',
              400,
              ERROR_CODES.INVALID_INPUT
            )
          );
          return;
        }

        const actualSha = hash.digest('hex');
        if (actualSha !== expectedSha) {
          callback(
            new AppError(
              'Uploaded file content does not match the registered deployment file.',
              400,
              ERROR_CODES.INVALID_INPUT
            )
          );
          return;
        }

        callback();
      },
    });
  }

  private createValidatedFileStream(
    content: Readable,
    expectedSha: string,
    expectedSize: number
  ): Readable {
    return content.pipe(this.createFileValidationTransform(expectedSha, expectedSize));
  }

  private async getDeploymentFileById(
    deploymentId: string,
    fileId: string
  ): Promise<DeploymentFileRow | null> {
    const result = await this.getPool().query<DeploymentFileRow>(
      `SELECT
         id as "fileId",
         deployment_id as "deploymentId",
         file_path as "path",
         sha,
         size_bytes as "size",
         uploaded_at as "uploadedAt"
       FROM deployments.files
       WHERE deployment_id = $1 AND id = $2`,
      [deploymentId, fileId]
    );

    return result.rows[0] ?? null;
  }

  private async getDeploymentFiles(deploymentId: string): Promise<DeploymentFileRow[]> {
    const result = await this.getPool().query<DeploymentFileRow>(
      `SELECT
         id as "fileId",
         deployment_id as "deploymentId",
         file_path as "path",
         sha,
         size_bytes as "size",
         uploaded_at as "uploadedAt"
       FROM deployments.files
       WHERE deployment_id = $1
       ORDER BY file_path ASC`,
      [deploymentId]
    );

    return result.rows;
  }

  /**
   * Update deployment status
   */
  private async updateDeploymentStatus(
    id: string,
    status: DeploymentStatusType,
    additionalMetadata?: Record<string, unknown>
  ): Promise<void> {
    const metadataUpdate = additionalMetadata
      ? `, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb`
      : '';
    const params = additionalMetadata
      ? [status, id, JSON.stringify(additionalMetadata)]
      : [status, id];

    await this.getPool().query(
      `UPDATE deployments.runs SET status = $1${metadataUpdate} WHERE id = $2`,
      params
    );
  }

  /**
   * Get deployment by database ID
   */
  /**
   * Make a previous deployment live again.
   *
   * The row keeps its own status rather than being copied into a new one: rolling back is
   * a statement about which deployment is serving, not a new deployment. Every other row
   * that claimed to be READY is demoted, so the history cannot show two live deployments.
   */
  async rollbackTo(id: string): Promise<DeploymentRecord> {
    const deployment = await this.getDeploymentById(id);
    if (!deployment) {
      throw new AppError('Deployment not found.', 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
    }

    // The row's own driver: restoring a Vercel deployment through Docker is meaningless,
    // and asking the *default* driver whether it can roll back answers about the wrong
    // one. Read after the row exists so a bad id is still a 404 rather than a capability
    // complaint about a deployment nobody has.
    const provider = this.providerFor(deployment);
    if (!provider.rollbackTo) {
      throw unsupportedFeature(provider.name, 'rollback');
    }
    if (!deployment.providerDeploymentId) {
      throw new AppError(
        'That deployment never reached the provider, so there is nothing to restore.',
        400,
        ERROR_CODES.DEPLOYMENT_INVALID_FILE
      );
    }

    const restored = await provider.rollbackTo(deployment.providerDeploymentId);
    const status = (restored.readyState || restored.state || 'READY').toUpperCase();

    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      // Demote whatever else claimed to be live first, so no window shows two.
      // Scoped to this row's driver: on an instance with both, demoting every READY row would
      // mark a Vercel deployment CANCELED while Vercel keeps serving it — and `getMetadata()`
      // reads the latest READY row to decide what is live.
      await client.query(
        `UPDATE deployments.runs
            SET status = 'CANCELED'
          WHERE status = $1 AND id <> $2 AND provider = $3`,
        [DeploymentStatus.READY, id, deployment.provider ?? provider.name]
      );
      const result = await client.query(
        `UPDATE deployments.runs
         SET status = $1,
             url = $2,
             metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          status,
          this.getDeploymentUrl(restored.url, provider),
          JSON.stringify({ rolledBackAt: new Date().toISOString() }),
          id,
        ]
      );
      await client.query('COMMIT');
      logger.info('Deployment rolled back', { id, status });
      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      // Swallowed like the other transaction in this file: on a broken connection the
      // ROLLBACK itself rejects, and that rejection would replace the original error *and*
      // skip the log line below — the only record that the host and the database disagree.
      await client.query('ROLLBACK').catch(() => {});
      // The driver already switched the host — that happened before this transaction — so
      // the database now disagrees with what is being served. Nothing else records that,
      // and an operator chasing "why does the site show the old build" needs this line.
      logger.error('Deployment rolled back on the host but not in the database', {
        id,
        providerDeploymentId: deployment.providerDeploymentId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * A page of the running deployment's own output.
   *
   * Resolved through the row's driver, like every other row-scoped call, and refused by name
   * when that driver cannot read what it deployed — the flag describes the driver, so a
   * static deployment answers with the file server's own output rather than nothing.
   */
  async getRuntimeLogs(
    id: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<{ lines: Array<{ timestamp: number; message: string }>; nextToken: string | null }> {
    const deployment = await this.getDeploymentById(id);
    if (!deployment) {
      throw new AppError('Deployment not found.', 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
    }
    const provider = this.providerFor(deployment);
    if (!provider.runtimeLogs) {
      throw unsupportedFeature(provider.name, 'runtime logs');
    }
    if (!deployment.providerDeploymentId) {
      throw new AppError(
        'That deployment never reached the provider, so it has no output.',
        400,
        ERROR_CODES.DEPLOYMENT_INVALID_FILE
      );
    }
    return await provider.runtimeLogs(deployment.providerDeploymentId, options);
  }

  async getDeploymentById(id: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          provider_deployment_id as "providerDeploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM deployments.runs
         WHERE id = $1`,
        [id]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment by ID', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment by Vercel deployment ID
   */
  async getDeploymentByVercelId(vercelDeploymentId: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          provider_deployment_id as "providerDeploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM deployments.runs
         WHERE provider_deployment_id = $1`,
        [vercelDeploymentId]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment by Vercel ID', {
        error: error instanceof Error ? error.message : String(error),
        vercelDeploymentId,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Sync deployment status from provider and update database
   */
  async syncDeploymentById(id: string): Promise<DeploymentRecord | null> {
    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        return null;
      }

      if (!deployment.providerDeploymentId) {
        throw new AppError(
          'Cannot sync deployment: no provider deployment ID yet. Deployment may still be in WAITING status.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Fetch the latest status from the driver that made this row
      const providerDeployment = await this.providerFor(deployment).getDeployment(
        deployment.providerDeploymentId
      );

      // The driver's own status, uppercased to match our enum
      const providerStatus = (
        providerDeployment.readyState ||
        providerDeployment.state ||
        'BUILDING'
      ).toUpperCase();

      // Update database with latest status
      const result = await this.getPool().query(
        `UPDATE deployments.runs
         SET status = $1, url = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          providerStatus,
          this.getDeploymentUrl(providerDeployment.url, this.providerFor(deployment)),
          JSON.stringify({
            lastSyncedAt: new Date().toISOString(),
            ...(providerDeployment.error && { error: providerDeployment.error }),
          }),
          id,
        ]
      );

      logger.info('Deployment synced', { id, status: providerStatus });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to sync deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to sync deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * List all deployments with total count for pagination
   */
  async listDeployments(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ deployments: DeploymentRecord[]; total: number }> {
    try {
      const [dataResult, countResult] = await Promise.all([
        this.getPool().query(
          `SELECT
            id,
            provider_deployment_id as "providerDeploymentId",
            provider,
            status,
            url,
            metadata,
            created_at as "createdAt",
            updated_at as "updatedAt"
           FROM deployments.runs
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
        this.getPool().query(`SELECT COUNT(*)::int as count FROM deployments.runs`),
      ]);

      return {
        deployments: dataResult.rows,
        total: countResult.rows[0]?.count ?? 0,
      };
    } catch (error) {
      logger.error('Failed to list deployments', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list deployments', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Cancel a deployment by database ID
   */
  async cancelDeploymentById(id: string): Promise<void> {
    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.DEPLOYMENT_NOT_FOUND);
      }

      // If deployment has a Vercel ID, cancel it on Vercel
      if (deployment.providerDeploymentId) {
        await this.providerFor(deployment).cancelDeployment(deployment.providerDeploymentId);
      }

      if (
        deployment.status === DeploymentStatus.WAITING &&
        this.getUploadMode(deployment) === 'legacy' &&
        this.s3Provider
      ) {
        await this.s3Provider
          .deleteObject(DEPLOYMENT_BUCKET, getDeploymentKey(id))
          .catch((error) => {
            logger.warn('Failed to clean up deployment zip on cancel', {
              id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      await this.getPool().query(
        `UPDATE deployments.runs
         SET status = $1
         WHERE id = $2`,
        [DeploymentStatus.CANCELED, id]
      );

      logger.info('Deployment cancelled', {
        id,
        providerDeploymentId: deployment.providerDeploymentId,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to cancel deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to cancel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Update deployment status from webhook event
   * Uses Vercel deployment ID to find the deployment
   *
   * Note: For ERROR status, we fetch deployment details from Vercel API
   * to get error information since webhooks don't include error reasons.
   */
  async updateDeploymentFromWebhook(
    vercelDeploymentId: string,
    status: string,
    url: string | null,
    webhookMetadata: Record<string, unknown>
  ): Promise<DeploymentRecord | null> {
    try {
      // For ERROR status, fetch deployment details to get error information
      // Vercel webhooks don't include error reasons in the payload
      let errorInfo: { errorCode?: string; errorMessage?: string } | undefined;
      if (status === 'ERROR') {
        try {
          // The row's own driver. A webhook only ever concerns the deployment it names, so
          // asking the current default for its details would hand a Vercel id to Docker and
          // lose the error message this block exists to capture.
          const row = await this.getDeploymentByVercelId(vercelDeploymentId);
          const providerDeployment = await this.providerFor(row ?? {}).getDeployment(
            vercelDeploymentId
          );
          if (providerDeployment.error) {
            errorInfo = {
              errorCode: providerDeployment.error.code,
              errorMessage: providerDeployment.error.message,
            };
            logger.info('Fetched error details from Vercel API', {
              vercelDeploymentId,
              errorCode: errorInfo.errorCode,
            });
          }
        } catch (fetchError) {
          // Log but don't fail the webhook update if we can't fetch error details
          logger.warn('Failed to fetch error details from Vercel API', {
            vercelDeploymentId,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          });
        }
      }

      // Vercel is the only driver that sends webhooks, so the row this matches is a Vercel
      // row — but reading the URL through the *current default* would rewrite it with
      // whatever that driver advertises once an operator switches to Docker.
      //
      // Resolved leniently: an instance that has moved to Docker can still receive a
      // webhook for a deployment made before the switch, and refusing it would leave that
      // row stuck at its old status forever. Without the driver we simply do not touch the
      // URL — the COALESCE below keeps what is already recorded.
      let vercelProvider: SitesProvider | null = null;
      try {
        vercelProvider = this.providerFor({ provider: 'vercel' });
      } catch {
        logger.warn('Vercel webhook arrived but the vercel driver is not configured here', {
          vercelDeploymentId,
        });
      }
      const result = await this.getPool().query(
        `UPDATE deployments.runs
         SET status = $1, url = COALESCE($2, url), metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE provider_deployment_id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          status,
          vercelProvider ? this.getDeploymentUrl(url, vercelProvider) : null,
          JSON.stringify({
            lastWebhookAt: new Date().toISOString(),
            ...webhookMetadata,
            ...(errorInfo && { error: errorInfo }),
          }),
          vercelDeploymentId,
        ]
      );

      if (!result.rows.length) {
        logger.warn('Deployment not found for webhook update', { vercelDeploymentId });
        return null;
      }

      logger.info('Deployment updated from webhook', {
        vercelDeploymentId,
        status,
        ...(errorInfo && { errorCode: errorInfo.errorCode }),
      });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to update deployment from webhook', {
        error: error instanceof Error ? error.message : String(error),
        vercelDeploymentId,
      });
      throw new AppError(
        'Failed to update deployment from webhook',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Update the custom slug for the project
   * Calls cloud API: PUT /sites/v1/:projectId/slug
   */
  async updateSlug(slug: string | null): Promise<UpdateSlugResponse> {
    if (!isCloudEnvironment()) {
      throw new AppError(
        'Custom slugs are only available in cloud environment.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const projectId = appConfig.cloud.projectId;
    if (!projectId) {
      throw new AppError(
        'PROJECT_ID not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      const signature = TokenManager.getInstance().signCloudToken('Custom deployment slugs');
      const cloudApiHost = appConfig.cloud.apiHost;

      const response = await fetch(`${cloudApiHost}/sites/v1/${projectId}/slug`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sign: signature,
          slug: slug,
        }),
      });

      if (response.status === 409) {
        const errorData = (await response.json()) as { error?: string };
        throw new AppError(
          errorData.error || 'Slug is already taken',
          409,
          ERROR_CODES.DEPLOYMENT_ALREADY_EXISTS
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(
          `Failed to update slug: ${response.statusText} - ${errorText}`,
          response.status,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const data = (await response.json()) as UpdateSlugResponse;

      // Update cached slug in VercelProvider so subsequent calls get the correct value
      this.provider.slug?.updateCache(data.slug);

      logger.info('Custom domain slug updated', {
        projectId,
        slug: data.slug,
        domain: data.domain,
      });

      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to update slug', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to update slug', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  // ============================================================================
  // Custom Domain Management (user-owned domains)
  // ============================================================================

  /**
   * Add a user-owned custom domain on Vercel and return DNS instructions
   */
  async addCustomDomain(domain: string): Promise<AddCustomDomainResponse> {
    this.assertDeploymentServiceConfigured();

    const vercelData = await requireDomainStore().add(domain);
    const config = await this.getCustomDomainConfigOrEmpty(vercelData.name, domain);

    logger.info('Custom domain added', { domain, verified: vercelData.verified });
    return this.toCustomDomainResponse(vercelData, config);
  }

  /**
   * List all custom domains
   */
  async listCustomDomains(): Promise<ListCustomDomainsResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const domains = (await requireDomainStore().list()).filter(
        (domain) => !this.isReservedHostedDomain(domain.name)
      );
      const configs = new Map(
        await Promise.all(
          domains.map(
            async (domain) =>
              [
                domain.name,
                await this.getCustomDomainConfigOrEmpty(domain.name, domain.name),
              ] as const
          )
        )
      );

      return {
        domains: domains.map((domain) =>
          this.toCustomDomainResponse(domain, configs.get(domain.name) ?? {})
        ),
      };
    } catch (error) {
      // A driver with no domain store already said so with a 400; wrapping it here turned
      // "this driver cannot do custom domains" into "we broke".
      //
      // Upstream statuses do not pass through, though: `UpstreamError` carries the status
      // Vercel returned, and a 401 for a stale stored token would reach the dashboard as our
      // own 401 — which its client reads as a dead session and logs the admin out. Before
      // this rethrow existed everything here became a 500, so that path is new.
      if (
        error instanceof UpstreamError &&
        (error.statusCode === 401 || error.statusCode === 403)
      ) {
        throw new AppError(
          `The deployment provider rejected the request: ${error.message}`,
          502,
          ERROR_CODES.UPSTREAM_FAILURE,
          'Check the provider credentials configured for this project.'
        );
      }
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to list custom domains', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list custom domains', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Remove a custom domain directly from Vercel
   */
  async removeCustomDomain(domain: string): Promise<void> {
    this.assertDeploymentServiceConfigured();

    await requireDomainStore().remove(domain);

    logger.info('Custom domain removed', { domain });
  }

  /**
   * Re-verify a custom domain's DNS configuration via Vercel
   */
  async verifyCustomDomain(domain: string): Promise<VerifyCustomDomainResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const [vercelResult, projectDomain] = await Promise.all([
        requireDomainStore().verify(domain),
        requireDomainStore().get(domain),
      ]);

      logger.info('Custom domain verification result', { domain, verified: vercelResult.verified });

      const config = await this.getCustomDomainConfigOrEmpty(domain, domain);

      return this.toCustomDomainResponse(
        {
          name: domain,
          apexName: projectDomain.apexName,
          verified: vercelResult.verified,
          verification: vercelResult.verification,
        },
        config
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to verify custom domain', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to verify custom domain', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment metadata including current deployment and domain URLs
   */
  async getMetadata(): Promise<DeploymentMetadataResponse> {
    try {
      // Get the latest READY deployment
      const result = await this.getPool().query(
        `SELECT
          id,
          url
         FROM deployments.runs
         WHERE status = 'READY'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      const latestReadyDeployment = result.rows[0] as
        | { id: string; url: string | null }
        | undefined;

      // Guarded like the slug store in getConfigMetadata: a driver that owns no domains
      // has no custom domain URL, and demanding one made this whole response 400 for the
      // driver this file exists to support — including `currentDeploymentId` and
      // `defaultDomainUrl`, which are meaningful for every driver.
      // `this.provider` throws when no driver is configured, which turned a documented 200
      // into a 503 for an instance that simply has no sites driver — and this endpoint is
      // fetched on the dashboard home. The custom domain is the only part that needs a
      // driver; the deployment id and default URL come from the row.
      const activeProvider = isAnySitesProviderConfigured() ? this.provider : null;
      const customDomainUrl = activeProvider?.domains ? await activeProvider.domains.url() : null;

      return {
        currentDeploymentId: latestReadyDeployment?.id ?? null,
        defaultDomainUrl: latestReadyDeployment?.url ?? null,
        customDomainUrl,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to get deployment metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to get deployment metadata', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
