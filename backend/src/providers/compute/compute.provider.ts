import { createHash } from 'crypto';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

export interface LaunchMachineParams {
  appId: string;
  /**
   * Image URL — image-mode (any registry) or source-mode (digest-pinned
   * registry.fly.io ref produced by the CLI's `flyctl deploy --build-only --push`).
   */
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  region: string;
  /**
   * Requested ingress. Omitted, the provider applies its own default (the first
   * entry of `capabilities.ingressModes`). A provider that cannot deliver the
   * requested mode applies the closest one it can.
   */
  ingress?: 'none' | 'port' | 'host';
  /**
   * Edge protocol. `'http'` (default) terminates TLS at the Fly anycast edge
   * and proxies HTTP/1.1+HTTP/2 to the container. `'tcp'` exposes the container's
   * port directly with empty handlers — for Redis, Postgres-protocol, and other
   * raw TCP services. Omitting the field is identical to `'http'`.
   */
  protocol?: 'http' | 'tcp';
  /**
   * Scale-to-zero. `true`/omitted (default) lets Fly stop the machine when
   * idle and cold-start it on the next request. `false` keeps one machine
   * running 24/7 (autostop off) for latency-sensitive services.
   */
  scaleToZero?: boolean;
}

export interface UpdateMachineParams {
  appId: string;
  machineId: string;
  /**
   * Image URL — same shape as LaunchMachineParams.image. For non-image
   * updates (port-only, env-only) pass the existing image URL.
   */
  image: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  /**
   * Requested ingress. Omitted, the provider applies its own default (the first
   * entry of `capabilities.ingressModes`). A provider that cannot deliver the
   * requested mode applies the closest one it can.
   */
  ingress?: 'none' | 'port' | 'host';
  /**
   * Edge protocol — same semantics as LaunchMachineParams.protocol. Omit
   * for back-compat HTTP behavior.
   */
  protocol?: 'http' | 'tcp';
  /**
   * Scale-to-zero — same semantics as LaunchMachineParams.scaleToZero. Omit
   * for back-compat scale-to-zero behavior.
   */
  scaleToZero?: boolean;
}

export interface MachineSummary {
  id: string;
  state: string;
  region: string;
}

export interface ComputeEvent {
  timestamp: number;
  message: string;
}

// A single container stdout/stderr line. `timestamp` is epoch milliseconds.
export interface ComputeLogLine {
  timestamp: number;
  message: string;
  instance?: string;
  region?: string;
}

// Result of fetching container logs. `nextToken` is an opaque forward cursor
// (Fly's `next_token`) for live tailing; null when nothing further is available.
export interface ComputeLogsResult {
  lines: ComputeLogLine[];
  nextToken: string | null;
}

// The backing machine no longer exists on the compute provider — reclaimed
// after prolonged idleness, deleted out-of-band via the provider's dashboard,
// or lost to a host migration. Providers throw this on a definitive 404 from
// a machine-scoped call so the service layer can heal DB state that still
// points at the dead machine, instead of surfacing an opaque 5xx forever.
// The message deliberately contains "(404)" — deleteService tolerates
// already-gone resources by substring today, and this keeps that path safe
// even where an instanceof check is missed.
export class MachineGoneError extends Error {
  constructor(
    public readonly appId: string,
    public readonly machineId: string
  ) {
    super(`Machine ${machineId} no longer exists on app ${appId} (404)`);
    this.name = 'MachineGoneError';
  }
}

/**
 * 6PN network name for a project's Fly apps, shared by the Fly and cloud
 * providers so the wire payload stays byte-identical between them.
 *
 * Fly's rule: letters, numbers, and dashes, and it must start with a letter.
 * The old `${projectId}-network` failed for the ~63% of projects whose UUID
 * begins with a hex digit, and a bare APP_KEY still failed for the ~30% of keys
 * that are digit-leading. The static `n-` prefix guarantees a letter-leading
 * name for every project while APP_KEY preserves per-project isolation.
 *
 * Lives here rather than in the service layer because it is a provider-specific
 * naming rule — Docker has no equivalent concept.
 */
export function flyNetworkName(): string {
  if (!process.env.APP_KEY) {
    // Typed, matching what the service layer threw before this moved: a plain
    // Error surfaces as a generic 500 with no next action, which is a worse
    // answer than the one an operator missing APP_KEY used to get.
    throw new AppError(
      'APP_KEY environment variable is required for compute network isolation',
      500,
      ERROR_CODES.COMPUTE_SERVICE_NOT_CONFIGURED
    );
  }
  return `n-${process.env.APP_KEY}`;
}

/**
 * Fly app name for a service. Names are globally unique and capped at 63 chars,
 * so a long service name is truncated with a short hash of the full name
 * appended — otherwise two services sharing a prefix would collide.
 *
 * Lives in the shared module rather than on FlyProvider because the cloud
 * provider needs the identical rule (cloud mode *is* Fly behind a control
 * plane). Having it call into FlyProvider instead would drag that module's
 * transitive imports into every consumer.
 */
export function flyAppNameFor(params: { name: string; projectId: string }): string {
  const suffix = `-${params.projectId}`;
  const maxBase = 60 - suffix.length;
  // Need at least 8 chars for a truncated name: 1 letter + dash + 6-char hash
  if (maxBase < 8) {
    throw new AppError(
      `projectId is too long to produce a valid Fly app name (max ~51 chars, got ${params.projectId.length})`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  if (params.name.length <= maxBase) {
    return params.name + suffix;
  }
  const hash = createHash('sha256').update(params.name).digest('hex').slice(0, 6);
  const truncated = params.name.slice(0, maxBase - 7); // 6 chars hash + 1 dash
  return `${truncated}-${hash}${suffix}`;
}

/**
 * Public URL for a Fly app. Defaults to Fly's own `.fly.dev` hostname, which
 * Fly routes automatically for every app. Operators owning a wildcard domain
 * pointed at Fly can override with COMPUTE_DOMAIN; otherwise we return a URL
 * that actually resolves rather than a vanity domain nobody controls.
 */
export function flyEndpointUrl(appId: string): string {
  const domain = appConfig.fly.domain || 'fly.dev';
  return `https://${appId}.${domain}`;
}

// Shared translation wrapper for machine-scoped provider calls. Each provider
// supplies its own `isGone` predicate (they see different error shapes), but
// the translate-and-rethrow contract lives in one place so fly-mode and
// cloud-mode can't drift apart.
export async function translateMachineGone<T>(
  appId: string,
  machineId: string,
  isGone: (err: unknown) => boolean,
  fn: () => Promise<T>
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isGone(err)) {
      throw new MachineGoneError(appId, machineId);
    }
    throw err;
  }
}

/**
 * What a provider can actually do. The service layer used to hardcode Fly's
 * answers to all of these — region changes being impossible in place, machines
 * being able to scale to zero, source builds going through flyctl — which made
 * a second driver impossible to add without lying somewhere. Providers now
 * declare their own, and the service/route/CLI layers gate on the declaration
 * instead of assuming.
 */
export interface ComputeCapabilities {
  /** Instances can be stopped when idle and cold-started on the next request. */
  scaleToZero: boolean;
  /** Instances are placed in named geographic regions. */
  regions: boolean;
  /**
   * Ingress modes the driver can actually deliver.
   *
   *   'none' — reachable only on the project's internal network.
   *   'port' — published on a host port.
   *   'host' — reachable at a hostname.
   *
   * Fly allocates public IPs and a `.fly.dev` hostname for every app, so it can
   * only offer 'host'; asking it for 'none' is not something it can honour. A
   * single-host driver can offer all three.
   *
   * This is the set the driver *can* deliver, not the one it picks by default —
   * that is `defaultIngress()`, which for Docker is an operator setting and so
   * cannot be read off a static list.
   */
  ingressModes: ('none' | 'port' | 'host')[];
  /**
   * How a caller gets from source to a running image.
   *   'none'           — image-mode only; the caller supplies a built image.
   *   'flyctl'         — the CLI shells out to flyctl for a remote build.
   *   'context-upload' — the caller uploads a build context and we build it.
   */
  sourceBuild: 'none' | 'flyctl' | 'context-upload';
  /**
   * Whether POST /:id/deploy-token can mint a scoped build credential. Only
   * cloud-managed mode can: it holds an org-wide token that must be narrowed
   * before it leaves the backend. A self-hoster already owns their credentials,
   * so there is nothing to narrow — and the CLI must branch on this rather than
   * calling the endpoint unconditionally (which is the current self-host bug).
   */
  deployTokenIssuance: boolean;
}

export interface ComputeProvider {
  isConfigured(): boolean;
  /**
   * Driver name persisted in `compute.services.provider`. Declared rather than
   * inferred with `instanceof` — provider identity has to survive being mocked,
   * and an `instanceof` against a mocked class throws outright.
   *
   * Cloud-managed mode reports 'fly': it *is* Fly behind a control plane and
   * shares Fly's app/machine identifiers, so a row created in one mode stays
   * manageable in the other.
   */
  readonly name: 'fly' | 'docker';
  readonly capabilities: ComputeCapabilities;
  /**
   * Mode applied when the caller does not choose one. Always a member of
   * `capabilities.ingressModes`.
   *
   * A method rather than a field on `capabilities`, because for a single-host
   * driver it is an operator setting that can change while the process runs —
   * reading it off a static list is what made COMPUTE_DEFAULT_INGRESS have no
   * effect on service creation.
   */
  defaultIngress(): 'none' | 'port' | 'host';
  /**
   * Provider-native name for the app/namespace backing a service. Fly needs a
   * globally-unique, length-capped app name; Docker only needs a locally-unique
   * container name. Deriving it is the provider's business, not the service's.
   */
  resolveAppName(params: { name: string; projectId: string }): string;
  /**
   * Public URL for a deployed app, or null when the provider cannot know one
   * (Docker with no ingress configured). Fly always has a `.fly.dev` hostname;
   * Docker may have nothing to advertise, and returning null is more honest
   * than emitting a URL that does not resolve.
   */
  endpointUrl(appId: string): string | null;
  createApp(params: { name: string }): Promise<{ appId: string }>;
  destroyApp(appId: string): Promise<void>;
  /**
   * Create and start an instance.
   *
   * `endpointUrl` is the provider's chance to report a URL it could only know
   * after launching — Docker lets the daemon assign an ephemeral host port, so
   * the address does not exist until the container does. `undefined` means the
   * provider has no post-launch opinion and the caller should use the synchronous
   * `endpointUrl(appId)`; an explicit `null` means "resolved, and there is
   * genuinely nothing to advertise".
   */
  launchMachine(
    params: LaunchMachineParams
  ): Promise<{ machineId: string; endpointUrl?: string | null }>;
  /**
   * Bring the instance to the requested state.
   *
   * Returns a `machineId` when satisfying the request required replacing the
   * instance, so the caller can persist the new identity. Fly updates a machine
   * in place and returns nothing; Docker cannot change a running container's
   * image, ports, or env at all and has to recreate — reporting that here is
   * what keeps the stored instance id from pointing at a container that no
   * longer exists.
   *
   * `endpointUrl` follows the same rules as on launchMachine, and matters for the
   * same reason: a replacement instance gets a *new* ephemeral host port, so the
   * previously stored URL would point at one that has been freed.
   */
  updateMachine(
    params: UpdateMachineParams
  ): Promise<{ machineId?: string; endpointUrl?: string | null }>;
  stopMachine(appId: string, machineId: string): Promise<void>;
  startMachine(appId: string, machineId: string): Promise<void>;
  destroyMachine(appId: string, machineId: string): Promise<void>;
  listMachines(appId: string): Promise<MachineSummary[]>;
  getMachineStatus(appId: string, machineId: string): Promise<{ state: string }>;
  getEvents(
    appId: string,
    machineId: string,
    options?: { limit?: number }
  ): Promise<ComputeEvent[]>;
  getLogs(
    appId: string,
    machineId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<ComputeLogsResult>;
  waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs?: number
  ): Promise<string>;
}
