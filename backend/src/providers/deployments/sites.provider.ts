import type { Readable } from 'stream';

import type {
  ProjectSettings,
  SitesCapabilitiesSchema,
  SitesProviderName as SitesProviderNameSchema,
} from '@insforge/shared-schemas';

/**
 * Re-exported from the wire schema rather than declared here: capabilities are
 * published through /api/metadata, so a second definition would drift from the one
 * clients validate against.
 */
export type SitesProviderName = SitesProviderNameSchema;
export type SitesCapabilities = SitesCapabilitiesSchema;

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
  /**
   * Builder output, when the driver has any and `capabilities().buildLogs` is true.
   * Returned rather than fetched later because the classic builder streams it once, as
   * the build runs — there is nothing to query afterwards.
   */
  buildLogs?: string[];
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
  /**
   * Values for this deployment. A driver with a runtime store (`capabilities().envVars ===
   * 'runtime'`) has already been given them through that store and ignores these; a
   * `build-only` driver passes them to the build, where they are baked into the artifact.
   */
  envVars?: Array<{ key: string; value: string }>;
  /**
   * Taken from the wire schema rather than restated here: this drifted once already, and a
   * field the API accepts but the driver's type does not know about is invisible until
   * someone traces why a setting had no effect.
   */
  projectSettings?: ProjectSettings;
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
 * A name under a domain the driver owns. Only meaningful when `capabilities().slug` is
 * true. `updateCache` exists because the slug is settable through a path the driver does
 * not see — the service writes it, then tells the driver so the next read is not stale.
 */
export interface SlugStore {
  get(): Promise<string | null>;
  updateCache(slug: string | null): void;
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
  slug?: SlugStore;

  /**
   * A page of the running deployment's output, oldest first. Present when
   * `capabilities().runtimeLogs` is true.
   *
   * `nextToken` is an opaque forward cursor: pass the previous page's token to resume, and a
   * null token means nothing further is available yet.
   */
  runtimeLogs?(
    providerDeploymentId: string,
    options?: { limit?: number; nextToken?: string }
  ): Promise<{ lines: Array<{ timestamp: number; message: string }>; nextToken: string | null }>;

  /**
   * Make a previous deployment live again without rebuilding it. Present when
   * `capabilities().rollback` is true.
   *
   * Takes the provider id of the deployment to restore and returns it in its new state,
   * so the caller can record the same fields a fresh deployment writes.
   */
  rollbackTo?(providerDeploymentId: string): Promise<ProviderDeployment>;
}
