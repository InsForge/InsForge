export interface LaunchMachineParams {
  appId: string;
  /**
   * Pre-built image URL. Either `image` or (`sourceKey` + `imageTag`) must
   * be provided. If both are set, the cloud rejects with 400.
   */
  image?: string;
  /**
   * S3 key (within the configured source-staging bucket) where source.tgz
   * was uploaded via a presigned URL from /build-creds. When set, cloud
   * triggers a CodeBuild run before launching the machine and replaces
   * `image` with the resulting digest-pinned ECR tag.
   */
  sourceKey?: string;
  /** ECR image tag CodeBuild will produce, paired with `sourceKey`. */
  imageTag?: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
  region: string;
}

export interface SourceUploadCreds {
  sourceKey: string;
  uploadUrl: string;
  imageTag: string;
  expiresAt: string;
}

export interface UpdateMachineParams {
  appId: string;
  machineId: string;
  /**
   * Pre-built image URL. Either `image` or (`sourceKey` + `imageTag`) must
   * be provided for a redeploy. (For non-image updates like port-only,
   * pass the existing image URL.)
   */
  image?: string;
  /** S3 key from /build-creds. Triggers cloud-side build before update. */
  sourceKey?: string;
  /** ECR tag the source-mode build will produce, paired with sourceKey. */
  imageTag?: string;
  port: number;
  cpu: string;
  memory: number;
  envVars: Record<string, string>;
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

export interface ComputeProvider {
  isConfigured(): boolean;
  createApp(params: { name: string; network: string; org: string }): Promise<{ appId: string }>;
  destroyApp(appId: string): Promise<void>;
  /**
   * Mints credentials for the CLI to upload source directly to staging.
   * Optional — providers without source-deploy support throw or omit.
   */
  issueBuildCreds?(appId: string): Promise<SourceUploadCreds>;
  launchMachine(params: LaunchMachineParams): Promise<{ machineId: string }>;
  updateMachine(params: UpdateMachineParams): Promise<void>;
  stopMachine(appId: string, machineId: string): Promise<void>;
  startMachine(appId: string, machineId: string): Promise<void>;
  destroyMachine(appId: string, machineId: string): Promise<void>;
  listMachines(appId: string): Promise<MachineSummary[]>;
  getMachineStatus(appId: string, machineId: string): Promise<{ state: string }>;
  getLogs(appId: string, machineId: string, options?: { limit?: number }): Promise<ComputeEvent[]>;
  waitForState(
    appId: string,
    machineId: string,
    targetStates: string[],
    timeoutMs?: number,
  ): Promise<string>;
}
