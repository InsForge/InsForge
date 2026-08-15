import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EncryptionManager } from '@/infra/security/encryption.manager.js';
import { FlyProvider } from '@/providers/compute/fly.provider.js';
import { CloudComputeProvider } from '@/providers/compute/cloud.provider.js';
import { DockerProvider } from '@/providers/compute/docker.provider.js';
import { dockerConfig } from '@/providers/compute/docker.client.js';
import {
  MachineGoneError,
  type ComputeProvider,
  type ComputeLogsResult,
} from '@/providers/compute/compute.provider.js';
import { ComputeConfigService } from '@/services/compute/compute-config.service.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import { AppError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';
import {
  ERROR_CODES,
  errorCodeSchema,
  cpuTierToCores,
  type ErrorCode,
  type ServiceSchema,
  type ComputeProviderName,
  type IngressMode,
  type ComputeMetadataSchema,
} from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from '../../utils/next-actions.js';

export interface CreateServiceInput {
  projectId: string;
  name: string;
  /**
   * Driver to create on. Omitted, the deployment's default applies — the CLI and
   * every pre-multi-driver caller.
   */
  provider?: ComputeProviderName;
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
  /**
   * Requested ingress. Omitted, the active driver's default applies.
   */
  ingress?: IngressMode;
  /**
   * Edge protocol — `'http'` (default) for HTTP/HTTPS edge handlers,
   * `'tcp'` for raw TCP (Redis, Postgres wire protocol, etc.). Optional;
   * the DB column defaults to `'http'`.
   */
  protocol?: 'http' | 'tcp';
  /**
   * Scale-to-zero — `true` (default) lets Fly stop the machine when idle,
   * `false` keeps it running 24/7. Optional; the DB column defaults to true.
   */
  scaleToZero?: boolean;
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
  /** Ingress — same semantics as CreateServiceInput.ingress. */
  ingress?: IngressMode;
  /** Edge protocol — same semantics as CreateServiceInput.protocol. */
  protocol?: 'http' | 'tcp';
  /** Scale-to-zero — same semantics as CreateServiceInput.scaleToZero. */
  scaleToZero?: boolean;
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
  protocol: 'http' | 'tcp';
  scaleToZero: boolean;
  ingress: string;
  provider: string;
  providerAppId: string | null;
  providerInstanceId: string | null;
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
  // Backfilled to 'http' for pre-INS-271 rows by the 047 migration, NOT NULL
  // going forward. Older self-hosters who somehow have a row without the
  // column will see undefined here; mapRowToSchema normalizes to 'http' so the
  // response shape's required `protocol` field never goes out as undefined.
  protocol: 'http' | 'tcp';
  // Backfilled to true for pre-existing rows by the 058 migration, NOT NULL
  // going forward. mapRowToSchema normalizes undefined to true for rows read
  // from a pre-migration DB.
  scale_to_zero: boolean;
  // Added by migration 064, backfilled to 'host' for the Fly rows that predate it.
  ingress: string;
  // Renamed from fly_app_id / fly_machine_id by migration 064. `provider`
  // records which driver created the row and is backfilled to 'fly'.
  provider: string;
  provider_app_id: string | null;
  provider_instance_id: string | null;
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
    // Defense-in-depth: the migration backfills + sets NOT NULL DEFAULT 'http',
    // but if a downstream consumer fetches a row from a pre-migration DB the
    // serviceSchema would reject `undefined`. Fall back to 'http' so a stale
    // schema doesn't break the response.
    protocol: (row.protocol ?? 'http') as ServiceSchema['protocol'],
    scaleToZero: row.scale_to_zero ?? true,
    cpus: cpuTierToCores(row.cpu),
    // 'host' rather than the column default for a row read from a pre-064 DB:
    // every such row is Fly-backed and therefore already on a public hostname.
    ingress: (row.ingress ?? 'host') as ServiceSchema['ingress'],
    // Defense-in-depth for a row read from a pre-064 database, same reasoning as
    // `protocol` above: 'fly' was the only possibility before the column existed.
    provider: (row.provider ?? 'fly') as ServiceSchema['provider'],
    providerAppId: row.provider_app_id,
    providerInstanceId: row.provider_instance_id,
    // Deprecated aliases — see serviceSchema. Dropped after one minor version.
    flyAppId: row.provider_app_id,
    flyMachineId: row.provider_instance_id,
    status: row.status as ServiceSchema['status'],
    endpointUrl: row.endpoint_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Cloud-mode providers wrap the cloud's structured error body verbatim into
// AppError.message (a JSON string like
// `{"code":"COMPUTE_QUOTA_EXCEEDED","error":"…","nextActions":[…]}`).
// Rewrap so callers see the cloud's actual code/message/nextActions instead
// of a generic "Compute service operation failed" 502. Falls back to a 502
// with the provided default message if the input isn't a recognizable
// AppError.
// True when the provider says the resource is already gone. Cloud mode
// surfaces that as AppError(404) whose message is the raw JSON error body —
// which need not contain the literal substring '404' — so a status check is
// required alongside the legacy message sniff (kept for FlyProvider's plain
// "Fly API error (404): ..." errors on paths without typed translation).
function isAlreadyGone(error: unknown): boolean {
  return (
    error instanceof MachineGoneError ||
    (error instanceof AppError && error.statusCode === 404) ||
    (error instanceof Error && error.message.includes('404'))
  );
}

function rewrapCloudError(error: unknown, defaultMessage: string): AppError {
  if (error instanceof AppError) {
    let parsed: { code?: string; error?: string; nextActions?: string[] } | undefined;
    try {
      parsed = JSON.parse(error.message);
    } catch {
      parsed = undefined;
    }
    const parsedCode = errorCodeSchema.safeParse(parsed?.code);
    const fallbackCode = errorCodeSchema.safeParse(error.code);
    const code: ErrorCode =
      (parsedCode.success ? parsedCode.data : undefined) ??
      (fallbackCode.success ? fallbackCode.data : undefined) ??
      ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED;
    return new AppError(
      parsed?.error ?? error.message,
      error.statusCode,
      code,
      parsed?.nextActions?.join('; ')
    );
  }
  return new AppError(
    error instanceof Error ? error.message : defaultMessage,
    502,
    ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
  );
}

/**
 * Driver name for the `provider` column. Read off the provider rather than
 * derived with `instanceof`, which throws when the class has been mocked.
 * Falls back to 'fly' for a provider predating the field — that was the only
 * possibility before a second driver existed.
 */
export function providerName(provider: ComputeProvider): ComputeProviderName {
  return provider.name ?? 'fly';
}

/**
 * Every configured driver, keyed by the name persisted in
 * `compute.services.provider`, plus which one new services go to.
 *
 * Drivers coexist. A service is managed by the driver that created it — read off
 * its `provider` column — regardless of which one is the default. That matters
 * for the obvious migration: an operator with Fly services who enables Docker
 * keeps the Fly ones running and manageable while new work lands locally,
 * instead of having to destroy and redeploy everything.
 */
/**
 * Region recorded for providers that have no notion of geography. One daemon is one
 * place, so anything else would be fiction.
 */
export const LOCAL_REGION = 'local';

export interface ComputeRegistry {
  providers: Map<ComputeProviderName, ComputeProvider>;
  defaultProvider: ComputeProviderName;
}

/**
 * Build the registry from the environment.
 *
 * `COMPUTE_PROVIDER` selects the **default for new services** (and `off` disables
 * compute entirely). It is deliberately not a restriction: naming a default must
 * not strand rows belonging to another driver.
 *
 * Note that `fly` and `cloud` are two credential paths to the *same* driver
 * identity — cloud mode is Fly behind a control plane, managing the same Fly
 * apps and machines. Registering both would put two credential paths on one set
 * of resources, so they are mutually exclusive; the Map key enforces that
 * structurally rather than by convention.
 */
export function buildComputeRegistry(): ComputeRegistry {
  const requested = (process.env.COMPUTE_PROVIDER || '').trim().toLowerCase();

  if (requested === 'off') {
    throw new AppError(
      'Compute services are disabled (COMPUTE_PROVIDER=off).',
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED,
      'Unset COMPUTE_PROVIDER or set it to a provider name, then restart the container.'
    );
  }
  const known = ['', 'auto', 'fly', 'cloud', 'docker'];
  if (!known.includes(requested)) {
    throw new AppError(
      `Unknown COMPUTE_PROVIDER "${requested}". Expected one of: fly, cloud, docker, off.`,
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED
    );
  }

  const providers = new Map<ComputeProviderName, ComputeProvider>();
  const fly = FlyProvider.getInstance();
  const cloud = CloudComputeProvider.getInstance();

  // An explicitly requested driver must actually be usable — failing loudly at
  // startup beats 500-ing on the first deploy.
  if (requested === 'fly' && !fly.isConfigured()) {
    throw new AppError(
      'COMPUTE_PROVIDER=fly but FLY_API_TOKEN and/or FLY_ORG are not set.',
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED,
      'Set both FLY_API_TOKEN and FLY_ORG, then restart the container.'
    );
  }
  if (requested === 'cloud' && !cloud.isConfigured()) {
    throw new AppError(
      'COMPUTE_PROVIDER=cloud is only available on InsForge Cloud projects.',
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED
    );
  }

  // Resolve the single Fly-identity driver. Explicit request wins; otherwise
  // self-host Fly takes precedence over cloud-proxied mode, unchanged from the
  // pre-registry behaviour (the operator has their own account and wants direct
  // control).
  if (requested === 'cloud') {
    providers.set('fly', cloud);
  } else if (fly.isConfigured()) {
    providers.set('fly', fly);
  } else if (cloud.isConfigured()) {
    providers.set('fly', cloud);
  }

  // Docker registers itself when the socket is present — mounting it into the
  // InsForge container *is* the operator's opt-in. Nobody discovers their host is
  // running arbitrary containers because a default flipped.
  //
  // Registration is gated on isConfigured() alone, never on having been
  // requested: registering an unreachable driver because it was named would make
  // every subsequent call fail obscurely, which is the opposite of the
  // fail-loudly-at-startup behaviour the explicit checks exist for.
  const docker = DockerProvider.getInstance();
  if (docker.isConfigured()) {
    providers.set('docker', docker);
  } else if (requested === 'docker') {
    // Two very different reasons the driver is unavailable, and conflating them
    // would send an operator chasing a socket mount that is not the problem.
    // DockerProvider.isConfigured() fails closed on cloud-managed projects
    // regardless of whether a socket exists — see the comment there for why
    // running customer containers on shared infrastructure is a tenant escape.
    if (cloud.isConfigured() || isCloudEnvironment()) {
      throw new AppError(
        'The Docker compute driver is self-host only and cannot run on a cloud-managed project.',
        400,
        ERROR_CODES.COMPUTE_NOT_CONFIGURED,
        'Unset COMPUTE_PROVIDER to use the managed compute provider.'
      );
    }
    throw new AppError(
      `COMPUTE_PROVIDER=docker but no Docker socket at ${dockerConfig().socketPath}.`,
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED,
      'Mount the Docker socket into the InsForge container (or set DOCKER_SOCKET_PATH), then restart.'
    );
  }

  if (providers.size === 0) {
    // Both ways in, Docker first: it needs no third-party account, and a
    // self-hoster reading Fly-only advice has no way to discover the option that
    // is actually easier for them. This text reaches the dashboard verbatim as the
    // not-configured empty state, so it is the whole of what they are told.
    throw new AppError(
      'Compute services not configured.',
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED,
      'Pick a provider and restart the container:\n' +
        `• Your own Docker host — uncomment the Docker socket volume in your compose file and restart. Currently looking for a socket at ${dockerConfig().socketPath}.\n` +
        '• Fly.io — set FLY_API_TOKEN and FLY_ORG in your .env.\n' +
        'See https://docs.insforge.dev/core-concepts/compute/overview for both.'
    );
  }

  // Default: honour an explicit request, else prefer the Fly identity when it is
  // configured so existing installs keep sending new services where they always
  // did. A newly-enabled Docker driver becoming the silent default for every
  // subsequent deploy would be a surprising change of behaviour.
  const requestedKey: ComputeProviderName | null =
    requested === 'docker' ? 'docker' : requested === 'fly' || requested === 'cloud' ? 'fly' : null;
  if (requestedKey && !providers.has(requestedKey)) {
    throw new AppError(
      `COMPUTE_PROVIDER=${requested} is not configured on this deployment.`,
      503,
      ERROR_CODES.COMPUTE_NOT_CONFIGURED
    );
  }
  const defaultProvider: ComputeProviderName =
    requestedKey ?? (providers.has('fly') ? 'fly' : [...providers.keys()][0]);

  if (providers.size > 1) {
    logger.info('Compute providers registered', {
      providers: [...providers.keys()],
      defaultProvider,
    });
  }

  return { providers, defaultProvider };
}

/**
 * Compute slice for admin `/api/metadata`.
 *
 * Returns `undefined` when no provider is configured, which is what makes the
 * slice absent and gives callers the coarse "compute is unavailable here" signal
 * without first issuing a request that would 503.
 *
 * Deliberately a free function rather than a method: `ComputeServicesService`
 * builds the registry in its constructor and therefore throws when nothing is
 * configured, and metadata aggregation must not be able to fail because an
 * optional feature is off. Nothing here touches the database either, so this is
 * the cheapest of the slices the aggregate awaits.
 */
export function getComputeMetadata(): ComputeMetadataSchema | undefined {
  let registry: ComputeRegistry;
  try {
    registry = buildComputeRegistry();
  } catch {
    // Not configured, disabled, or misconfigured. All three mean the same thing
    // to a caller deciding whether to offer compute at all.
    return undefined;
  }

  const providers: NonNullable<ComputeMetadataSchema['providers']> = {};
  for (const [name, provider] of registry.providers) {
    // The caller-omitted default is resolved here rather than left to the client:
    // for a single-host driver it is an operator setting, so a dashboard that
    // guessed the first supported mode would preselect one thing in its create
    // form and get another from the server.
    providers[name] = { ...provider.capabilities, defaultIngress: provider.defaultIngress() };
  }
  return { defaultProvider: registry.defaultProvider, providers };
}

/**
 * The driver new services go to. Kept as a named export because it is the
 * meaningful "which provider is active" question for callers that do not have a
 * specific service in hand.
 */
export function selectComputeProvider(): ComputeProvider {
  const registry = buildComputeRegistry();
  // Non-null is an invariant of buildComputeRegistry: it throws when no driver
  // is configured, and defaultProvider is either a key it verified with
  // `providers.has()` or one taken straight out of `providers.keys()`.
  return registry.providers.get(registry.defaultProvider)!;
}

/**
 * Warn once, at startup, about a Fly token with no org.
 *
 * FLY_ORG used to default to "insforge" — our internal org — so operators who copied
 * .env.example verbatim got opaque "unauthorized" errors from Fly. This says so in
 * terms they can act on.
 *
 * Two things it deliberately does not do. It does not live in buildComputeRegistry:
 * that runs on every /api/metadata request, so the warning would repeat on every
 * dashboard poll. And it reads the *effective* credentials rather than appConfig,
 * because an org set through the dashboard is stored, not in the environment — the
 * old check told those operators to set a value they had already set.
 *
 * A token with no org means Fly does not register at all, so nothing downstream
 * reports it: `isConfigured()` requires both.
 */
export function warnIfFlyCredentialsIncomplete(): void {
  const { apiToken, org } = ComputeConfigService.getInstance().flyCredentials();
  if (apiToken && !org) {
    logger.warn(
      'Compute self-host: a Fly API token is set but the org is empty, so Fly is not ' +
        'registered. Set FLY_ORG (or the org field in compute settings) to your Fly ' +
        'org slug from `fly orgs list`.'
    );
  }
}

export class ComputeServicesService {
  private static instance: ComputeServicesService | undefined;
  private pool: Pool | null = null;
  private readonly registry: ComputeRegistry = buildComputeRegistry();

  private constructor() {}

  static getInstance(): ComputeServicesService {
    if (!ComputeServicesService.instance) {
      ComputeServicesService.instance = new ComputeServicesService();
    }
    return ComputeServicesService.instance;
  }

  /**
   * Drop the singleton so the next call rebuilds the provider registry.
   *
   * Called after Fly credentials are stored through the dashboard. The registry is
   * built in a field initialiser, and construction *throws* when nothing is
   * configured — so a deployment that had no provider has no instance to rebuild, and
   * one that did holds a registry that predates the new credentials. Discarding it
   * covers both, and the pool is re-acquired lazily so nothing leaks.
   */
  static resetForConfigChange(): void {
    ComputeServicesService.instance = undefined;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /** Driver for new services. */
  private getCompute(): ComputeProvider {
    return this.registry.providers.get(this.registry.defaultProvider)!;
  }

  /**
   * Driver a create should land on: the one the caller named, else the default.
   *
   * A named driver that is not configured is rejected rather than silently swapped —
   * the caller asked for a specific place to run, and putting the container somewhere
   * else is the kind of stored lie the capability layer exists to prevent.
   */
  private computeFor(provider: ComputeProviderName | undefined): ComputeProvider {
    if (!provider) {
      return this.getCompute();
    }
    const driver = this.registry.providers.get(provider);
    if (!driver) {
      throw new AppError(
        `Compute provider "${provider}" is not configured on this deployment`,
        400,
        ERROR_CODES.COMPUTE_NOT_CONFIGURED
      );
    }
    return driver;
  }

  /**
   * Coerce inputs a driver cannot honour into what it will actually do.
   *
   * The CLI defaults `--region iad` and the API defaults `scaleToZero: true`,
   * both of which are Fly-shaped. Persisting them against a single-host,
   * always-on driver would have the API and dashboard report a region the
   * container is not in and an idle behaviour it does not have — a stored lie is
   * worse than a rejected request, because nothing later contradicts it.
   *
   * Coerced rather than rejected so an existing CLI keeps working unchanged; the
   * substitution is logged once per call so it is visible rather than silent.
   */
  private normalizeForDriver<
    T extends { region?: string; scaleToZero?: boolean; ingress?: IngressMode },
  >(
    driver: ComputeProvider,
    input: T,
    context: {
      serviceName?: string;
      /**
       * On create, an omitted field means "apply the default", so an unsupported
       * default has to be resolved here. On update it means "leave this alone",
       * and filling it in would turn a metadata-only PATCH into a deploy change.
       */
      resolveDefaults: boolean;
    }
  ): T {
    const out = { ...input };
    const modes = driver.capabilities.ingressModes;
    if (out.ingress !== undefined && !modes.includes(out.ingress)) {
      // Coerced rather than rejected, same reasoning as region below: a driver
      // that only does public hostnames (Fly) should not fail an otherwise valid
      // deploy that asked for `none`, but it must not record a mode it is not
      // delivering either.
      const applied = driver.defaultIngress();
      logger.info('Compute: driver cannot deliver the requested ingress; using its default', {
        driver: driver.name,
        requested: out.ingress,
        applied,
        ...context,
      });
      out.ingress = applied;
    }
    if (!driver.capabilities.regions && out.region !== undefined && out.region !== LOCAL_REGION) {
      logger.info('Compute: driver has no regions; recording region as local', {
        driver: driver.name,
        requested: out.region,
        ...context,
      });
      out.region = LOCAL_REGION;
    }
    // `!== false` rather than `=== true` on purpose. The API default for this
    // field is `true`, so a caller that simply omits it would otherwise have
    // `true` stored against a driver that cannot do it — which is how the first
    // end-to-end run produced a row claiming scale-to-zero on Docker. Coercing
    // only an *explicit* true misses the far more common default path.
    const impliedScaleToZero = out.scaleToZero ?? (context.resolveDefaults ? true : undefined);
    if (!driver.capabilities.scaleToZero && impliedScaleToZero === true) {
      // The API default for this field is `true`, so on create a caller that simply
      // omits it would otherwise have `true` stored against a driver that cannot do
      // it — which is exactly what the first end-to-end run produced. Coercing only
      // an *explicit* true misses the far more common default path.
      logger.info('Compute: driver cannot scale to zero; recording the service as always-on', {
        driver: driver.name,
        explicit: out.scaleToZero === true,
        ...context,
      });
      out.scaleToZero = false;
    }
    return out;
  }

  /**
   * Driver that owns an existing service, from its `provider` column.
   *
   * Routing by row is what lets drivers coexist: a Fly service stays manageable
   * after an operator enables Docker, instead of having to be destroyed and
   * redeployed. Acting on it with the wrong driver would issue container calls
   * against what are actually Fly machine ids — at best a confusing 404, at
   * worst healing a live, billing machine into a `stopped` row nothing will
   * reconcile.
   */
  private providerFor(provider: string): ComputeProvider {
    const driver = this.registry.providers.get(provider as ComputeProviderName);
    if (!driver) {
      throw new AppError(
        `This service is backed by the "${provider}" compute driver, which is not configured on this deployment.`,
        503,
        ERROR_CODES.COMPUTE_NOT_CONFIGURED,
        provider === 'docker'
          ? 'Mount the Docker socket into the InsForge container and restart it.'
          : 'Set FLY_API_TOKEN and FLY_ORG (or the cloud PROJECT_ID/CLOUD_API_HOST pair), then restart.'
      );
    }
    return driver;
  }

  private providerForService(svc: ServiceSchema): ComputeProvider {
    return this.providerFor(svc.provider);
  }

  /**
   * Startup work: prove each driver answers, then heal rows that drifted while
   * the backend was down.
   *
   * Non-fatal by design. Compute is optional, so a Docker daemon that is not
   * running must not stop the rest of the backend from serving — the errors are
   * logged prominently and individual compute calls fail with the real reason.
   */
  async runStartupTasks(): Promise<void> {
    for (const [name, driver] of this.registry.providers) {
      const probe = driver as ComputeProvider & {
        preflight?: () => Promise<{ version: string; os: string; rootless: boolean }>;
      };
      if (typeof probe.preflight !== 'function') {
        continue;
      }
      try {
        const info = await probe.preflight();
        logger.info(`Compute provider "${name}" ready`, info);
        if (info.rootless) {
          // Rootless changes port-binding and networking behaviour enough that a
          // support report should say so up front.
          logger.warn(
            `Compute provider "${name}" is talking to a rootless daemon: published ports below 1024 ` +
              'are unavailable and container networking differs from the rootful default.'
          );
        }
      } catch (error) {
        logger.error(
          `Compute provider "${name}" is registered but did not answer. Compute requests will fail ` +
            'until it does.',
          { error: error instanceof Error ? error.message : String(error) }
        );
      }
    }

    await this.reconcile();
  }

  /**
   * Compare stored instances against reality and fix what drifted.
   *
   * The per-request healing only fires when someone happens to touch a service.
   * Drift that accumulates while the backend is down — a container removed
   * out-of-band, a `docker system prune`, a provider reclaiming an idle machine —
   * otherwise leaves the dashboard showing a ghost `running` service indefinitely.
   *
   * Only steady-state rows are corrected. A row left in `creating`/`deploying`/
   * `destroying` by a crash mid-operation is reported but not touched: deciding
   * what a half-finished create should become means guessing whether
   * provider-side resources exist, and guessing wrong destroys someone's service.
   */
  async reconcile(): Promise<{
    checked: number;
    healed: number;
    corrected: number;
    skipped: number;
  }> {
    const stats = { checked: 0, healed: 0, corrected: 0, skipped: 0 };

    let rows: ServiceRow[];
    try {
      const result = await this.getPool().query<ServiceRow>(
        `SELECT * FROM compute.services WHERE provider_instance_id IS NOT NULL`
      );
      rows = result.rows;
    } catch (error) {
      logger.error('Compute reconcile: could not read services', {
        error: error instanceof Error ? error.message : String(error),
      });
      return stats;
    }

    for (const row of rows) {
      const provider = row.provider ?? 'fly';
      const driver = this.registry.providers.get(provider as ComputeProviderName);
      if (!driver) {
        stats.skipped++;
        continue;
      }
      // Both ids are needed to address an instance. The query filters on the
      // instance id, but a row carrying one without an app id is malformed rather
      // than merely undeployed — report it instead of crashing the sweep.
      const appId = row.provider_app_id;
      const instanceId = row.provider_instance_id;
      if (!appId || !instanceId) {
        logger.warn('Compute reconcile: service has an instance id but no app id', {
          id: row.id,
          name: row.name,
        });
        stats.skipped++;
        continue;
      }
      if (row.status !== 'running' && row.status !== 'stopped') {
        logger.warn('Compute reconcile: leaving a service in a transient state alone', {
          id: row.id,
          name: row.name,
          status: row.status,
        });
        stats.skipped++;
        continue;
      }

      stats.checked++;
      try {
        const { state } = await driver.getMachineStatus(appId, instanceId);
        if (state !== row.status) {
          // Scoped to the instance this observation was made against, the same way
          // healMachineGone is. The sweep runs alongside live requests, so a
          // concurrent deploy can replace the instance between the snapshot and
          // this write; without the guard, a stale `stopped` reading about the old
          // container would overwrite the `running` the deploy just committed.
          const corrected = await this.getPool().query(
            `UPDATE compute.services SET status = $1 WHERE id = $2 AND provider_instance_id = $3`,
            [state, row.id, instanceId]
          );
          // Zero rows means the guard did its job, which is a skip rather than a
          // correction — counting it either way would report work that never
          // happened and hide how often the race actually fires.
          if (corrected.rowCount === 0) {
            stats.skipped++;
            logger.info('Compute reconcile: skipped a stale reading, the row moved on', {
              id: row.id,
              name: row.name,
              observedInstance: instanceId,
            });
          } else {
            stats.corrected++;
            logger.info('Compute reconcile: corrected a stale status', {
              id: row.id,
              name: row.name,
              was: row.status,
              now: state,
            });
          }
        }
      } catch (error) {
        if (error instanceof MachineGoneError) {
          // Guarded: this is the one write inside the catch, and letting it throw
          // would escape the loop and abandon every row still unchecked. A sweep
          // that heals nine of ten rows beats one that stops at the first bad
          // write — the next boot retries this row anyway.
          try {
            await this.healMachineGone(row.id, instanceId);
            stats.healed++;
          } catch (healError) {
            logger.error('Compute reconcile: could not heal a vanished machine', {
              id: row.id,
              name: row.name,
              error: healError instanceof Error ? healError.message : String(healError),
            });
            stats.skipped++;
          }
          continue;
        }
        // Transient (daemon restarting, network blip). Leave the row as-is —
        // the next request or the next boot will try again.
        logger.warn('Compute reconcile: could not check a service, leaving it unchanged', {
          id: row.id,
          name: row.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (rows.length) {
      logger.info('Compute reconcile complete', stats);
    }
    return stats;
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
        NEXT_ACTIONS.CHECK_COMPUTE_SERVICE_EXISTS
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
    // Resolve the service first: the token has to be minted by the driver that
    // owns this service, not by whichever driver happens to be the default.
    const service = await this.getService(serviceId);
    const driver = this.providerForService(service);

    // Capability-gated rather than an instanceof check, so the CLI can ask
    // GET /api/compute/capabilities up front instead of discovering this by
    // calling and getting a 400 (which is the current self-host source-mode bug:
    // it aborts *after* prepareForDeploy has already created the app). The
    // structural check on issueDeployToken is what actually narrows the type —
    // instanceof against a mocked class throws.
    const issuer = driver as ComputeProvider & Partial<CloudComputeProvider>;
    if (
      !driver.capabilities?.deployTokenIssuance ||
      typeof issuer.issueDeployToken !== 'function'
    ) {
      throw new AppError(
        'Deploy-token issuance is only supported in cloud-managed mode. ' +
          'Self-hosters with FLY_API_TOKEN set already have a token and do not need this endpoint — ' +
          'let flyctl use your own credentials instead.',
        400,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED
      );
    }
    if (!service.providerAppId) {
      throw new AppError(
        `Service ${serviceId} has no Fly app yet — call /api/compute/services/deploy first to create the app.`,
        400,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED
      );
    }
    return issuer.issueDeployToken(service.providerAppId);
  }

  /**
   * Build an image from an uploaded context and deploy it to an existing service.
   *
   * The second half of source mode for a driver that builds locally. The first
   * half is prepareForDeploy, which reserves the name and creates the
   * provider-side app — the same two-step shape the Fly path uses, except the
   * build happens here instead of on the caller's machine.
   *
   * Deploying goes through updateService rather than launching directly, so the
   * recreate-vs-in-place decision and the instance-id/endpoint bookkeeping are the
   * ones already tested rather than a second copy.
   */
  async buildAndDeploy(
    serviceId: string,
    context: Buffer,
    options?: { dockerfile?: string; buildArgs?: Record<string, string> }
  ): Promise<{ service: ServiceSchema; imageTag: string; logs: string[] }> {
    const existing = await this.getService(serviceId);
    const driver = this.providerForService(existing);

    if (driver.capabilities.sourceBuild !== 'context-upload') {
      throw new AppError(
        `The "${driver.name}" compute driver does not build uploaded contexts.`,
        400,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED,
        driver.capabilities.sourceBuild === 'flyctl'
          ? 'This driver builds through flyctl on your machine; use the CLI source-deploy flow instead.'
          : 'Deploy a pre-built image with PATCH /api/compute/services/:id and an imageUrl.'
      );
    }

    const builder = driver as ComputeProvider & {
      buildFromContext?: (p: {
        serviceName: string;
        context: Buffer;
        dockerfile?: string;
        buildArgs?: Record<string, string>;
      }) => Promise<{ imageTag: string; logs: string[] }>;
      pruneServiceImages?: (serviceName: string, keep?: number) => Promise<{ removed: number }>;
    };
    if (typeof builder.buildFromContext !== 'function') {
      throw new AppError(
        `The "${driver.name}" driver declares context builds but does not implement them.`,
        500,
        ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
      );
    }

    let built: { imageTag: string; logs: string[] };
    try {
      built = await builder.buildFromContext({
        serviceName: existing.name,
        context,
        dockerfile: options?.dockerfile,
        buildArgs: options?.buildArgs,
      });
    } catch (error) {
      // A build failure leaves the service exactly as it was — the previous image
      // keeps running. Surface the builder's message so the developer can act.
      await this.getPool()
        .query(
          `UPDATE compute.services SET status = 'failed' WHERE id = $1 AND status = 'deploying'`,
          [serviceId]
        )
        .catch(() => undefined);
      throw new AppError(
        error instanceof Error ? error.message : 'Build failed',
        400,
        ERROR_CODES.COMPUTE_SERVICE_DEPLOY_FAILED
      );
    }

    try {
      const service = await this.updateService(serviceId, { imageUrl: built.imageTag });
      return { service, imageTag: built.imageTag, logs: built.logs };
    } finally {
      // Reclaim superseded images rather than deferring to a retention policy
      // nobody configures: every source deploy makes another one, and nothing else
      // removes them.
      //
      // In a `finally` because the build already wrote an image to disk by the time
      // the deploy runs — if the deploy throws, that image is otherwise orphaned
      // until some later deploy happens to succeed, so repeated failures pile up
      // without bound. Docker refuses to delete the image a container is still
      // using (409, logged and skipped), so pruning here cannot pull the running
      // image out from under a failed deploy.
      if (typeof builder.pruneServiceImages === 'function') {
        await builder.pruneServiceImages(existing.name).catch((error: unknown) => {
          logger.warn('Compute: image prune failed after a deploy', {
            serviceId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
  }

  async createService(rawInput: CreateServiceInput): Promise<ServiceSchema> {
    const fly = this.computeFor(rawInput.provider);
    const input = this.normalizeForDriver(fly, rawInput, {
      serviceName: rawInput.name,
      resolveDefaults: true,
    });

    if (!fly.isConfigured()) {
      throw new AppError(
        'Compute services are not enabled on this project.',
        503,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED,
        NEXT_ACTIONS.ENABLE_COMPUTE
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
        `INSERT INTO compute.services (project_id, name, image_url, port, cpu, memory, region, protocol, scale_to_zero, ingress, env_vars_encrypted, provider, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'creating')
         RETURNING *`,
        [
          input.projectId,
          input.name,
          recordedImageUrl,
          input.port,
          input.cpu,
          input.memory,
          input.region,
          input.protocol ?? 'http',
          input.scaleToZero ?? true,
          // Resolved from the driver when the caller did not choose: Fly always
          // its hostname, a single-host driver whatever the operator configured.
          input.ingress ?? fly.defaultIngress(),
          envVarsEncrypted,
          // Migration 064 drops the column default, so every insert states the
          // driver explicitly — a row that lies about its provider is exactly
          // what reconcile must never see.
          providerName(fly),
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
    const appName = fly.resolveAppName({ name: input.name, projectId: input.projectId });

    let launchedInstanceId: string | undefined;
    try {
      await fly.createApp({ name: appName });

      const launched = await fly.launchMachine({
        appId: appName,
        image: input.imageUrl,
        port: input.port,
        cpu: input.cpu,
        memory: input.memory,
        envVars: input.envVars ?? {},
        region: input.region,
        ingress: input.ingress ?? fly.defaultIngress(),
        protocol: input.protocol,
        scaleToZero: input.scaleToZero,
      });
      const machineId = launched.machineId;
      launchedInstanceId = machineId;

      // Prefer the URL the provider resolved after launching: under a driver that
      // publishes on an ephemeral host port, the address does not exist until the
      // instance does. `undefined` means the provider has no post-launch opinion,
      // so fall back to the name-derived one.
      const endpointUrl =
        launched.endpointUrl !== undefined ? launched.endpointUrl : fly.endpointUrl(appName);

      const updateResult = await this.getPool().query(
        `UPDATE compute.services
         SET provider_app_id = $1, provider_instance_id = $2, endpoint_url = $3, status = $4
         WHERE id = $5
         RETURNING *`,
        [appName, machineId, endpointUrl, 'running', serviceId]
      );

      logger.info('Compute service deployed', { serviceId, appName, machineId });
      return mapRowToSchema(updateResult.rows[0]);
    } catch (error) {
      logger.error('Failed to deploy compute service', { serviceId, error });

      // Clean up orphaned Fly resources (machine + app) to avoid leaked infrastructure
      if (launchedInstanceId) {
        try {
          await fly.destroyMachine(appName, launchedInstanceId);
        } catch (destroyError) {
          logger.error('Failed to clean up orphaned Fly machine', {
            appName,
            launchedInstanceId,
            error: destroyError,
          });
        }
      }
      try {
        await fly.destroyApp(appName);
      } catch (destroyError) {
        logger.error('Failed to clean up orphaned Fly app', { appName, error: destroyError });
      }

      // Mark as failed
      await this.getPool().query(`UPDATE compute.services SET status = $1 WHERE id = $2`, [
        'failed',
        serviceId,
      ]);

      throw rewrapCloudError(error, 'Compute service operation failed');
    }
  }

  async prepareForDeploy(rawInput: CreateServiceInput): Promise<ServiceSchema> {
    const fly = this.computeFor(rawInput.provider);
    const input = this.normalizeForDriver(fly, rawInput, {
      serviceName: rawInput.name,
      resolveDefaults: true,
    });

    if (!fly.isConfigured()) {
      throw new AppError(
        'Compute services are not enabled on this project.',
        503,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED,
        NEXT_ACTIONS.ENABLE_COMPUTE
      );
    }

    // This is the source-mode entry point: it reserves the name and creates the
    // provider-side app, then waits for the caller to build and push an image
    // before a PATCH launches the instance. On a driver that cannot build from
    // source at all, letting it succeed would leave a row stuck in `deploying`
    // with nothing able to advance it — the same shape as the self-host Fly bug
    // this whole effort exists to avoid repeating.
    if (fly.capabilities.sourceBuild === 'none') {
      throw new AppError(
        `The "${fly.name}" compute driver cannot build from source.`,
        400,
        ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED,
        'Deploy a pre-built image instead: POST /api/compute/services with an imageUrl.'
      );
    }

    const envVarsEncrypted = input.envVars
      ? EncryptionManager.encrypt(JSON.stringify(input.envVars))
      : null;

    const appName = fly.resolveAppName({ name: input.name, projectId: input.projectId });
    const endpointUrl = fly.endpointUrl(appName);

    // Insert row — check for duplicate name before calling Fly APIs
    let insertResult;
    try {
      insertResult = await this.getPool().query(
        `INSERT INTO compute.services (project_id, name, image_url, port, cpu, memory, region, protocol, scale_to_zero, ingress, env_vars_encrypted, provider, provider_app_id, endpoint_url, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'deploying')
         RETURNING *`,
        [
          input.projectId,
          input.name,
          input.imageUrl || 'dockerfile',
          input.port,
          input.cpu,
          input.memory,
          input.region,
          input.protocol ?? 'http',
          input.scaleToZero ?? true,
          input.ingress ?? fly.defaultIngress(),
          envVarsEncrypted,
          providerName(fly),
          appName,
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
      await fly.createApp({ name: appName });
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
          await fly.destroyApp(appName);
        } catch (destroyError) {
          logger.error('Failed to clean up orphaned Fly app after prepareForDeploy failure', {
            appName,
            error: destroyError,
          });
        }
        await this.getPool().query(`DELETE FROM compute.services WHERE id = $1`, [
          insertResult.rows[0].id,
        ]);
        throw error;
      }
    }

    logger.info('Compute service prepared for deploy', { appName });
    return mapRowToSchema(insertResult.rows[0]);
  }

  async updateService(id: string, data: UpdateServiceInput): Promise<ServiceSchema> {
    const existing = await this.getService(id);
    // Every provider call below targets an existing row, so it goes to the
    // driver that created it — not the default.
    const driver = this.providerForService(existing);
    data = this.normalizeForDriver(driver, data, {
      serviceName: existing.name,
      resolveDefaults: false,
    });

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
      // No provider can move a deployed instance between regions in place, so
      // persisting a new value would have the API and dashboard report a region
      // the instance is not running in. Gated on `regions` rather than a separate
      // `regionChangeInPlace` capability: a driver with no regions has already had
      // this field normalized to `local`, so the comparison below never fires for
      // it, and a driver that gains in-place migration can relax this then —
      // inventing the field before any driver answers differently just moved the
      // hardcoded rule somewhere less obvious.
      const deployed = existing.providerAppId && existing.providerInstanceId;
      if (data.region !== existing.region && deployed && driver.capabilities.regions) {
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
    if (data.protocol !== undefined) {
      updates.push(`protocol = $${paramIdx++}`);
      values.push(data.protocol);
    }
    if (data.scaleToZero !== undefined) {
      updates.push(`scale_to_zero = $${paramIdx++}`);
      values.push(data.scaleToZero);
    }
    if (data.ingress !== undefined) {
      updates.push(`ingress = $${paramIdx++}`);
      values.push(data.ingress);
    }

    if (updates.length === 0) {
      return existing;
    }

    // If deployment-affecting fields changed and a machine exists, update Fly FIRST.
    // Only commit to DB after Fly accepts the new config to avoid stale DB state.
    // `protocol` is a deploy field — switching http<->tcp swaps the Fly edge
    // handlers entirely, so it has to propagate to Fly to take effect.
    // `scaleToZero` likewise lives in the Fly service block (autostop config).
    // `ingress` belongs here: changing it changes whether a host port is
    // published at all, which no driver can do to a running instance.
    const deployFields = [
      'imageUrl',
      'port',
      'cpu',
      'memory',
      'envVars',
      'protocol',
      'scaleToZero',
      'ingress',
    ] as const;
    const hasDeployChange = deployFields.some((f) => data[f] !== undefined);

    // env_vars merge is needed by both Fly-touching branches (updateMachine
    // for redeploy, launchMachine for first-deploy). Hoist the SELECT so we
    // only hit the DB once.
    let mergedEnvVars: Record<string, string> | undefined;
    if (hasDeployChange && existing.providerAppId) {
      const existingRow = await this.getPool().query(
        `SELECT env_vars_encrypted FROM compute.services WHERE id = $1`,
        [id]
      );
      const existingEnvVarsEncrypted: string | null =
        existingRow.rows[0]?.env_vars_encrypted ?? null;
      mergedEnvVars = data.envVars ?? this.decryptEnvVars(existingEnvVarsEncrypted);
    }

    // Path A first-launch sets this so the final UPDATE can apply an
    // optimistic lock (`AND provider_instance_id IS NULL`) and self-heal if a
    // concurrent request also launched a machine.
    let justLaunchedMachineId: string | undefined;

    if (hasDeployChange && existing.providerAppId && existing.providerInstanceId) {
      // NOTE: Region changes are persisted in the DB but Fly machine region cannot
      // be changed in-place via updateMachine — a region change requires redeployment
      // (destroy + recreate). The region field is stored for the next deploy.
      try {
        const updated = await driver.updateMachine({
          appId: existing.providerAppId,
          machineId: existing.providerInstanceId,
          image: data.imageUrl ?? existing.imageUrl,
          port: data.port ?? existing.port,
          cpu: data.cpu ?? existing.cpu,
          memory: data.memory ?? existing.memory,
          envVars: mergedEnvVars ?? {},
          ingress: data.ingress ?? existing.ingress,
          protocol: data.protocol ?? existing.protocol,
          scaleToZero: data.scaleToZero ?? existing.scaleToZero,
        });
        // Any URL the driver reports is authoritative, replacement or not. Kept
        // outside the id check below because the contract does not tie the two:
        // a driver that re-publishes a port on the same instance (an `ingress`
        // change from `none` to `port`, say) returns a fresh URL with no new id,
        // and nesting this under the id check would drop it. Omitting the field
        // still means "unchanged" — both current drivers omit it on an in-place
        // update, where the published port cannot have moved.
        if (updated?.endpointUrl !== undefined) {
          updates.push(`endpoint_url = $${paramIdx++}`);
          values.push(updated.endpointUrl);
        }
        // A driver that cannot change image/ports/env in place replaces the
        // instance instead (Docker), so the stored id has to follow — otherwise
        // it points at a container that no longer exists and every later call
        // heals the row and reports "redeploy" forever.
        if (updated?.machineId && updated.machineId !== existing.providerInstanceId) {
          updates.push(`provider_instance_id = $${paramIdx++}`);
          values.push(updated.machineId);
          // The replacement is launched running, so the row has to follow: a
          // service the caller had stopped and then redeployed would otherwise
          // keep reporting 'stopped' while its container runs. Unconditional
          // because Path A owns the only other status write and cannot co-occur
          // with this branch (it requires no instance).
          updates.push(`status = $${paramIdx++}`);
          values.push('running');
          logger.info('Compute service instance replaced to apply the update', {
            id,
            previous: existing.providerInstanceId,
            replacement: updated.machineId,
          });
        } else {
          logger.info('Compute service machine updated', { id });
        }
      } catch (error) {
        // The machine this PATCH targeted no longer exists. Heal the row
        // (provider_instance_id → NULL) so the caller's retry takes the
        // first-launch path above and provisions a fresh machine.
        if (error instanceof MachineGoneError) {
          throw await this.machineGone(id, existing.providerInstanceId);
        }
        logger.error('Failed to update machine on Fly', { id, error });
        throw rewrapCloudError(error, 'Compute service operation failed');
      }
    } else if (
      (data.imageUrl ??
        // Recovery relaunch: a healed row (machine vanished on the provider →
        // status 'stopped', machine id cleared) still holds the last deployed
        // image, so any deploy-field PATCH relaunches it. Without this, a
        // retried env-var/cpu PATCH after a heal would "succeed" DB-only with
        // nothing deployed. Gated on status === 'stopped' so prepare-window
        // rows (status 'created'/'deploying', image_url may be a 'dockerfile'
        // placeholder, launch PATCH always carries an explicit imageUrl)
        // never take this arm with a non-launchable image.
        (hasDeployChange && existing.status === 'stopped' ? existing.imageUrl : null)) &&
      existing.providerAppId &&
      !existing.providerInstanceId
    ) {
      // Path A: no machine exists for the app — first deploy (CLI built+
      // pushed and passes imageUrl explicitly) or recovery relaunch (above).
      try {
        const launched = await driver.launchMachine({
          appId: existing.providerAppId,
          image: (data.imageUrl ?? existing.imageUrl) as string,
          port: data.port ?? existing.port,
          cpu: data.cpu ?? existing.cpu,
          memory: data.memory ?? existing.memory,
          envVars: mergedEnvVars ?? {},
          region: data.region ?? existing.region,
          ingress: data.ingress ?? existing.ingress,
          protocol: data.protocol ?? existing.protocol,
          scaleToZero: data.scaleToZero ?? existing.scaleToZero,
        });
        const machineId = launched.machineId;
        justLaunchedMachineId = machineId;
        // Persist machine id + flip status alongside the field updates below.
        updates.push(`provider_instance_id = $${paramIdx++}`);
        values.push(machineId);
        updates.push(`status = $${paramIdx++}`);
        values.push('running');
        updates.push(`endpoint_url = $${paramIdx++}`);
        // Same precedence as createService: a post-launch URL from the provider
        // wins, since an ephemeral published port is only knowable now.
        values.push(
          launched.endpointUrl !== undefined
            ? launched.endpointUrl
            : driver.endpointUrl(existing.providerAppId)
        );
        logger.info('Compute service machine launched (Path A)', { id, machineId });
      } catch (error) {
        logger.error('Failed to launch machine on Fly (Path A)', { id, error });
        throw rewrapCloudError(error, 'Compute service operation failed');
      }
    }

    // Fly accepted the update (or no Fly update was needed) — now commit to DB.
    // For a first-launch, append `AND provider_instance_id IS NULL` so a concurrent
    // PATCH (CLI retry, double-click) that also raced to launchMachine loses
    // the DB write. The loser then destroys the orphan machine it just made.
    values.push(id);
    const whereClause =
      justLaunchedMachineId !== undefined
        ? `WHERE id = $${paramIdx} AND provider_instance_id IS NULL`
        : `WHERE id = $${paramIdx}`;
    const result = await this.getPool().query(
      `UPDATE compute.services SET ${updates.join(', ')} ${whereClause} RETURNING *`,
      values
    );

    if (!result.rows.length) {
      if (justLaunchedMachineId !== undefined && existing.providerAppId) {
        // Lost a launch race: another request already wrote provider_instance_id.
        // Destroy the machine we just created so it doesn't keep billing.
        // Best-effort — even if the destroy itself fails, returning the
        // current row is still correct (the winning machine is healthy).
        try {
          await driver.destroyMachine(existing.providerAppId, justLaunchedMachineId);
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
        NEXT_ACTIONS.CHECK_COMPUTE_SERVICE_EXISTS
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
        NEXT_ACTIONS.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }
    const row = result.rows[0];

    // Delete tolerates an unavailable driver where the other operations refuse.
    // Blocking it would trap the operator with a row they can never remove — for
    // instance after decommissioning the Fly account behind existing services.
    // We skip the remote cleanup we cannot perform and say loudly what was left
    // behind; the audit snapshot records providerAppId/providerInstanceId, so the
    // orphaned resources are recoverable by hand.
    const rowProvider = row.provider ?? 'fly';
    const driver = this.registry.providers.get(rowProvider as ComputeProviderName);
    if (!driver) {
      logger.warn('Deleting a compute service whose driver is not configured; skipping cleanup', {
        id,
        rowProvider,
        configuredDrivers: [...this.registry.providers.keys()],
        orphanedAppId: row.provider_app_id,
        orphanedInstanceId: row.provider_instance_id,
      });
    }

    // Mark as destroying first so it's visible in the UI
    await this.getPool().query(`UPDATE compute.services SET status = 'destroying' WHERE id = $1`, [
      id,
    ]);

    // Fly cleanup — abort delete if cleanup fails to preserve the reference
    // Treat 404 as success (resource already destroyed)
    if (driver && row.provider_instance_id && row.provider_app_id) {
      try {
        await driver.destroyMachine(row.provider_app_id, row.provider_instance_id);
      } catch (error) {
        if (!isAlreadyGone(error)) {
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

    if (driver && row.provider_app_id) {
      try {
        await driver.destroyApp(row.provider_app_id);
      } catch (error) {
        if (!isAlreadyGone(error)) {
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
      protocol: (row.protocol ?? 'http') as 'http' | 'tcp',
      scaleToZero: row.scale_to_zero ?? true,
      ingress: row.ingress ?? 'host',
      provider: rowProvider,
      providerAppId: row.provider_app_id,
      providerInstanceId: row.provider_instance_id,
      endpointUrl: row.endpoint_url,
      envVarsEncrypted: row.env_vars_encrypted,
      createdAt: row.created_at,
    };
  }

  // The provider reported the machine gone (definitive 404) while our row
  // still points at it — the machine was reclaimed or deleted out-of-band.
  // Heal the row: clear the dead machine pointer and mark the service
  // stopped, so the dashboard stops showing a ghost "running" service and
  // the next deploy takes the first-launch path (provider_instance_id IS NULL →
  // launchMachine provisions a fresh machine). Guarded by provider_instance_id so
  // a concurrent redeploy's fresh machine id is never clobbered.
  private async healMachineGone(id: string, machineId: string): Promise<void> {
    await this.getPool().query(
      `UPDATE compute.services
          SET status = 'stopped', provider_instance_id = NULL
        WHERE id = $1 AND provider_instance_id = $2`,
      [id, machineId]
    );
    logger.warn('Compute machine gone on provider; healed stale service row', {
      id,
      machineId,
    });
  }

  // Standard translation for reads/ops that hit a gone machine: heal the row,
  // then surface a typed 404 the dashboard/CLI can act on (redeploy).
  private async machineGone(id: string, machineId: string): Promise<AppError> {
    await this.healMachineGone(id, machineId);
    return new AppError(
      'The machine backing this service no longer exists on the compute provider',
      404,
      ERROR_CODES.COMPUTE_MACHINE_NOT_FOUND,
      NEXT_ACTIONS.REDEPLOY_COMPUTE_SERVICE
    );
  }

  // Guard for machine-scoped operations. A row with an app but no machine is
  // either not deployed yet or was healed after its machine vanished on the
  // provider — either way the accurate signal is "no machine; deploy one",
  // NOT "service not found": the service exists and shows up in `compute
  // list`, so COMPUTE_SERVICE_NOT_FOUND here sends callers chasing the wrong
  // problem (and every post-heal request would contradict the redeploy
  // guidance the healing request just returned).
  private requireMachine(svc: ServiceSchema): {
    appId: string;
    instanceId: string;
    driver: ComputeProvider;
  } {
    // Chokepoint for stop/start/events/logs — all four route through here, so
    // resolving the owning driver once covers them.
    const driver = this.providerForService(svc);
    if (svc.providerAppId && !svc.providerInstanceId) {
      throw new AppError(
        'No machine exists for this service',
        404,
        ERROR_CODES.COMPUTE_MACHINE_NOT_FOUND,
        NEXT_ACTIONS.REDEPLOY_COMPUTE_SERVICE
      );
    }
    if (!svc.providerAppId || !svc.providerInstanceId) {
      throw new AppError(
        'Service not found',
        404,
        ERROR_CODES.COMPUTE_SERVICE_NOT_FOUND,
        NEXT_ACTIONS.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }
    return { appId: svc.providerAppId, instanceId: svc.providerInstanceId, driver };
  }

  async stopService(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);
    const { appId, instanceId, driver } = this.requireMachine(svc);

    try {
      await driver.stopMachine(appId, instanceId);
    } catch (error) {
      // Stopping a machine that no longer exists: the desired state is
      // already true. Heal the row and fall through to the status update —
      // "Stop" on a ghost service succeeds instead of erroring.
      if (error instanceof MachineGoneError) {
        await this.healMachineGone(id, instanceId);
      } else {
        logger.error('Failed to stop compute service', { id, error });
        throw new AppError(
          'Failed to stop compute service',
          502,
          ERROR_CODES.COMPUTE_SERVICE_STOP_FAILED
        );
      }
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
        NEXT_ACTIONS.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    logger.info('Compute service stopped', { id });
    return mapRowToSchema(result.rows[0]);
  }

  async startService(id: string): Promise<ServiceSchema> {
    const svc = await this.getService(id);
    const { appId, instanceId, driver } = this.requireMachine(svc);

    try {
      await driver.startMachine(appId, instanceId);
    } catch (error) {
      // Can't start a machine that no longer exists — heal the row and tell
      // the caller to redeploy (which provisions a fresh machine).
      if (error instanceof MachineGoneError) {
        throw await this.machineGone(id, instanceId);
      }
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
        NEXT_ACTIONS.CHECK_COMPUTE_SERVICE_EXISTS
      );
    }

    logger.info('Compute service started', { id });
    return mapRowToSchema(result.rows[0]);
  }

  async getServiceEvents(
    id: string,
    options?: { limit?: number }
  ): Promise<{ timestamp: number; message: string }[]> {
    const svc = await this.getService(id);
    const { appId, instanceId, driver } = this.requireMachine(svc);

    try {
      return await driver.getEvents(appId, instanceId, options);
    } catch (error) {
      if (error instanceof MachineGoneError) {
        throw await this.machineGone(id, instanceId);
      }
      throw error;
    }
  }

  /**
   * Fetch container stdout/stderr ("application logs") for a service. Resolves
   * the service's Fly app + machine, then delegates to the active compute
   * provider. Throws 404 if the service has not been launched yet.
   */
  async getServiceLogs(
    id: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<ComputeLogsResult> {
    const svc = await this.getService(id);
    const { appId, instanceId, driver } = this.requireMachine(svc);

    try {
      return await driver.getLogs(appId, instanceId, options);
    } catch (error) {
      if (error instanceof MachineGoneError) {
        throw await this.machineGone(id, instanceId);
      }
      throw error;
    }
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
