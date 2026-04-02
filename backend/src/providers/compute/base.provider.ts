/**
 * ComputeProvider interface — abstracts cloud-specific container orchestration.
 *
 * Key design: infrastructure provisioning (provision/teardown) is separated from
 * deployment updates (updateService) so redeploys never recreate existing resources.
 */

export interface BuildImageParams {
  containerId: string;
  githubRepo: string;
  githubBranch: string;
  dockerfilePath: string;
  githubToken?: string;
}

export interface BuildImageResult {
  imageUri: string;
  imageTag: string;
}

export interface ProvisionParams {
  containerId: string;
  projectSlug: string;
  imageUri: string;
  port: number;
  cpu: number;
  memory: number;
  healthCheckPath: string;
  envVars: Record<string, string>;
}

export interface ProvisionResult {
  serviceArn: string;
  taskDefArn: string;
  targetGroupArn: string;
  ruleArn: string;
  endpointUrl: string;
}

export interface UpdateServiceParams {
  containerId: string;
  serviceArn: string;
  imageUri: string;
  port: number;
  cpu: number;
  memory: number;
  healthCheckPath: string;
  envVars: Record<string, string>;
}

export interface UpdateServiceResult {
  taskDefArn: string;
  serviceArn: string;
}

export interface TeardownParams {
  serviceArn: string;
  targetGroupArn: string;
  ruleArn: string;
}

export interface RunTaskParams {
  containerId: string;
  taskDefinitionArn: string;
  envVars: Record<string, string>;
  cpu: number;
  memory: number;
}

export interface TaskStatus {
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  exitCode: number | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
}

export interface LogEntry {
  timestamp: number;
  message: string;
}

export interface LogStream {
  events: LogEntry[];
  nextToken?: string;
}

export interface ComputeProvider {
  /** Check whether the provider is configured and ready to use. */
  isConfigured(): boolean;

  /** Build a Docker image from a GitHub repo via CodeBuild and push to ECR. */
  buildImage(params: BuildImageParams): Promise<BuildImageResult>;

  /** One-time infrastructure setup: ECS service + ALB target group + listener rule. */
  provision(params: ProvisionParams): Promise<ProvisionResult>;

  /** Update an existing ECS service with a new task definition (redeploy / rollback). */
  updateService(params: UpdateServiceParams): Promise<UpdateServiceResult>;

  /** Tear down all cloud resources for a container. */
  teardown(params: TeardownParams): Promise<void>;

  /** Retrieve container logs. */
  getLogs(
    containerId: string,
    options?: { limit?: number; startTime?: number; nextToken?: string; logStreamPrefix?: string }
  ): Promise<LogStream>;

  runTask(params: RunTaskParams): Promise<{ taskArn: string }>;
  getTaskStatus(taskArn: string): Promise<TaskStatus>;
  stopTask(taskArn: string): Promise<void>;
  registerTaskDefinition(params: {
    containerId: string;
    imageUri: string;
    port: number;
    cpu: number;
    memory: number;
    envVars: Record<string, string>;
  }): Promise<string>;
}
