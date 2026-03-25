export interface BuildParams {
  containerId: string;
  githubRepo: string;
  githubBranch: string;
  dockerfilePath: string;
  githubToken: string;
  imageTag: string;
}

export interface BuildResult {
  buildId: string;
  imageUri: string;
  logUrl: string;
}

export interface DeployParams {
  containerId: string;
  imageUri: string;
  cpu: number;
  memory: number;
  port: number;
  healthCheckPath: string;
  envVars: Record<string, string>;
  projectSlug: string;
}

export interface DeployResult {
  serviceArn: string;
  taskDefArn: string;
  endpointUrl: string;
  targetGroupArn: string;
  ruleArn: string;
}

export interface RouteParams {
  containerId: string;
  projectSlug: string;
  port: number;
  healthCheckPath: string;
}

export interface RouteResult {
  targetGroupArn: string;
  ruleArn: string;
  endpointUrl: string;
}

export interface ContainerStatus {
  running: boolean;
  desiredCount: number;
  runningCount: number;
  healthStatus: string;
  lastEvent: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
}

export interface LogOpts {
  startTime?: number;
  endTime?: number;
  limit?: number;
  nextToken?: string;
}

export interface LogStream {
  events: LogEntry[];
  nextToken?: string;
}

export interface ComputeProvider {
  initialize(): Promise<void>;
  buildImage(params: BuildParams): Promise<BuildResult>;
  getBuildStatus(buildId: string): Promise<{ status: string; logUrl: string }>;
  deploy(params: DeployParams): Promise<DeployResult>;
  registerTaskDefinition(params: DeployParams): Promise<string>;
  updateService(serviceArn: string, taskDefArn: string): Promise<void>;
  stop(serviceArn: string): Promise<void>;
  destroy(serviceArn: string): Promise<void>;
  getStatus(serviceArn: string): Promise<ContainerStatus>;
  getLogs(serviceArn: string, opts: LogOpts): Promise<LogStream>;
  createRoute(params: RouteParams): Promise<RouteResult>;
  deleteRoute(targetGroupArn: string, ruleArn: string): Promise<void>;
}
