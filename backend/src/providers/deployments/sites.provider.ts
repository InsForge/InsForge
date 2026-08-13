import type { Readable } from 'stream';
import type { IngressMode } from '@insforge/shared-schemas';

/**
 * Which driver hosts a site. Recorded per row in `deployments.runs.provider`, which has
 * been provider-neutral since migration 019.
 */
export type SitesProviderName = 'vercel' | 'docker';

/**
 * What a sites driver can do.
 *
 * Reported rather than inferred, for the same reason ComputeCapabilities is: a client
 * that guessed from the provider name would offer buttons the active driver has no
 * implementation for. Every field here is a capability two drivers genuinely differ on
 * — anything both can always do does not belong.
 */
export interface SitesCapabilities {
  /**
   * `runtime` — the platform holds env vars for the deployed app and can list, read and
   * delete them. `build-only` — values reach the build and are baked into the artifact,
   * so there is nothing to read back afterwards. `none` — not supported at all.
   */
  envVars: 'runtime' | 'build-only' | 'none';
  /** The driver attaches and verifies domains itself, rather than the operator routing one. */
  customDomains: boolean;
  /** The site is reachable under a shared domain the driver assigns a name in. */
  slug: boolean;
  /** A previous deployment can be made live again without rebuilding it. */
  rollback: boolean;
  /** Build output is retrievable after the fact. */
  buildLogs: boolean;
  /** The driver infers how to build from the source tree. */
  frameworkDetection: boolean;
  /**
   * How the site is reachable. Same vocabulary as compute, deliberately, so one gateway
   * config covers services and sites. `none` never applies — a site nobody can reach is
   * not a deployment — so this is a subset of the compute modes.
   */
  ingressModes: Exclude<IngressMode, 'none'>[];
  /** Applied when a caller names no mode. Always one of `ingressModes`. */
  defaultIngress?: Exclude<IngressMode, 'none'>;
}

/** A deployment as the driver reports it. `id` is what lands in `provider_deployment_id`. */
export interface ProviderDeployment {
  id: string;
  url: string | null;
  state: string;
  readyState: string;
  name: string;
  createdAt: Date;
  error?: {
    code: string;
    message: string;
  };
}

/** A file the caller has already uploaded, identified the way the driver expects. */
export interface UploadedFileRef {
  file: string;
  sha: string;
  size: number;
}

export interface CreateDeploymentInput {
  name?: string;
  files?: UploadedFileRef[];
  projectSettings?: {
    buildCommand?: string | null;
    outputDirectory?: string | null;
    installCommand?: string | null;
    devCommand?: string | null;
    rootDirectory?: string | null;
  };
  meta?: Record<string, string>;
}

export interface CustomDomain {
  id: string;
  name: string;
  apexName: string;
  projectId: string;
  verified: boolean;
  redirect: string | null;
  redirectStatusCode: number | null;
  gitBranch: string | null;
  customEnvironmentId?: string | null;
  createdAt: number;
  updatedAt: number;
  verification?: DomainVerification;
}

export interface DomainConfig {
  misconfigured?: boolean;
  recommendedCNAME?: Array<{
    rank: number;
    value: string;
  }>;
  recommendedIPv4?: Array<{
    rank: number;
    value: string[];
  }>;
}

/** DNS records the driver wants pointed at it before it will call a domain verified. */
export type DomainVerification = Array<{
  type: string;
  domain: string;
  value: string;
  reason: string;
}>;

export interface ProjectDomain {
  name: string;
  apexName: string;
  verified: boolean;
  verification?: DomainVerification;
}

/**
 * Runtime env vars for a deployed app. Only meaningful when
 * `capabilities().envVars === 'runtime'`; a driver that bakes values into the artifact
 * has nothing to list or delete afterwards and omits this.
 */
export interface EnvVarStore {
  upsert(envVars: Array<{ key: string; value: string }>): Promise<void>;
  keys(): Promise<string[]>;
  list(): Promise<Array<{ id: string; key: string; target?: string[]; createdAt?: number }>>;
  get(envId: string): Promise<{ id: string; key: string; value: string }>;
  remove(envId: string): Promise<void>;
}

/**
 * Domains the driver owns. Only meaningful when `capabilities().customDomains` is true;
 * when it is false the operator points a hostname at the published port themselves,
 * which InsForge has no part in.
 */
export interface DomainStore {
  list(): Promise<CustomDomain[]>;
  /** The add response carries no id — Vercel assigns one only once the domain is listed. */
  add(domain: string): Promise<Omit<CustomDomain, 'id'>>;
  remove(domain: string): Promise<void>;
  verify(domain: string): Promise<{ verified: boolean; verification?: DomainVerification }>;
  get(domain: string): Promise<ProjectDomain>;
  config(domain: string): Promise<DomainConfig>;
  /** The URL a verified custom domain serves on, or null when none is attached. */
  url(): Promise<string | null>;
}

/**
 * What every sites driver must implement: take an uploaded file set and produce
 * something served. Everything a driver can legitimately not do hangs off a capability
 * flag rather than throwing from a method the interface claims to have.
 */
export interface SitesProvider {
  readonly name: SitesProviderName;

  /** Whether this driver has what it needs to run here. Never throws. */
  isConfigured(): boolean;
  capabilities(): SitesCapabilities;

  /** Returns the sha the driver stored the content under. */
  uploadFile(fileContent: Buffer): Promise<string>;
  /** Streaming variant for files too large to buffer. `signal` aborts a stalled upload. */
  uploadFileStream(input: {
    content: Readable;
    sha: string;
    size: number;
    signal?: AbortSignal;
  }): Promise<string>;
  uploadFiles(files: Array<{ path: string; content: Buffer }>): Promise<UploadedFileRef[]>;

  createDeployment(input: CreateDeploymentInput): Promise<ProviderDeployment>;
  /** Deploy a file set already uploaded by `uploadFiles`. */
  createDeploymentWithFiles(
    files: UploadedFileRef[],
    options?: Omit<CreateDeploymentInput, 'files'>
  ): Promise<ProviderDeployment>;
  getDeployment(providerDeploymentId: string): Promise<ProviderDeployment>;
  cancelDeployment(providerDeploymentId: string): Promise<void>;

  /** Present when `capabilities().envVars === 'runtime'`. */
  envVars?: EnvVarStore;
  /** Present when `capabilities().customDomains` is true. */
  domains?: DomainStore;
  /** Present when `capabilities().slug` is true. */
  getSlug?(): Promise<string | null>;
}
