import { config } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';
import type {
  ComputeProvider,
  BuildImageParams,
  BuildImageResult,
  ProvisionParams,
  ProvisionResult,
  UpdateServiceParams,
  UpdateServiceResult,
  TeardownParams,
  LogStream,
  RunTaskParams,
  TaskStatus,
} from './base.provider.js';

const MAX_PRIORITY_RETRIES = 5;

/**
 * AWS ECS Fargate provider.
 *
 * Lifecycle split:
 *   provision()      — first deploy: task def + target group + ALB rule + ECS service
 *   updateService()  — redeploy/rollback: new task def + UpdateService on existing service
 *   teardown()       — delete service + target group + listener rule
 */
export class AwsFargateProvider implements ComputeProvider {
  private static instance: AwsFargateProvider;

  static getInstance(): AwsFargateProvider {
    if (!AwsFargateProvider.instance) {
      AwsFargateProvider.instance = new AwsFargateProvider();
    }
    return AwsFargateProvider.instance;
  }

  isConfigured(): boolean {
    const c = config.compute;
    return c.enabled && !!c.ecsClusterArn && !!c.albListenerArn && !!c.executionRoleArn;
  }

  // ─── Build ────────────────────────────────────────────────────────────────────

  async buildImage(params: BuildImageParams): Promise<BuildImageResult> {
    const { StartBuildCommand, CodeBuildClient } = await import('@aws-sdk/client-codebuild');
    const client = new CodeBuildClient(this.clientConfig());

    const imageTag = `deploy-${Date.now()}`;
    const imageUri = `${config.compute.ecrRegistry}/${params.containerId}:${imageTag}`;

    type EnvVarType = 'PARAMETER_STORE' | 'PLAINTEXT' | 'SECRETS_MANAGER';
    const envOverrides: { name: string; value: string; type: EnvVarType }[] = [
      { name: 'IMAGE_REPO_NAME', value: params.containerId, type: 'PLAINTEXT' },
      { name: 'IMAGE_TAG', value: imageTag, type: 'PLAINTEXT' },
      { name: 'GITHUB_REPO', value: params.githubRepo, type: 'PLAINTEXT' },
      { name: 'GITHUB_BRANCH', value: params.githubBranch, type: 'PLAINTEXT' },
      { name: 'DOCKERFILE_PATH', value: params.dockerfilePath, type: 'PLAINTEXT' },
    ];

    if (params.githubToken) {
      envOverrides.push({
        name: 'GITHUB_TOKEN',
        value: params.githubToken,
        type: 'PLAINTEXT',
      });
    }

    const result = await client.send(
      new StartBuildCommand({
        projectName: config.compute.codebuildProject,
        environmentVariablesOverride: envOverrides,
      })
    );

    const buildId = result.build?.id;
    if (!buildId) {
      throw new Error('CodeBuild failed to start: no build ID returned');
    }

    await this.waitForBuild(client, buildId);
    return { imageUri, imageTag };
  }

  // ─── Provision (first deploy) ─────────────────────────────────────────────────

  async provision(params: ProvisionParams): Promise<ProvisionResult> {
    const taskDefArn = await this.registerTaskDefinition(params);

    const { targetGroupArn, ruleArn, endpointUrl } = await this.createRoute(
      params.containerId,
      params.projectSlug,
      params.port,
      params.healthCheckPath
    );

    let serviceArn: string;
    try {
      serviceArn = await this.createEcsService(
        params.containerId,
        taskDefArn,
        targetGroupArn,
        params.port
      );
    } catch (error) {
      // Compensating transaction: clean up ALB resources if service creation fails
      logger.warn('ECS service creation failed, cleaning up ALB route', {
        containerId: params.containerId,
        error: String(error),
      });
      await this.deleteRoute(targetGroupArn, ruleArn).catch((e) =>
        logger.error('Failed to clean up ALB route after service creation failure', {
          error: String(e),
        })
      );
      throw error;
    }

    return { serviceArn, taskDefArn, targetGroupArn, ruleArn, endpointUrl };
  }

  // ─── Update Service (redeploy / rollback) ─────────────────────────────────────

  async updateService(params: UpdateServiceParams): Promise<UpdateServiceResult> {
    const taskDefArn = await this.registerTaskDefinition({
      containerId: params.containerId,
      imageUri: params.imageUri,
      port: params.port,
      cpu: params.cpu,
      memory: params.memory,
      envVars: params.envVars,
    });

    const { UpdateServiceCommand, ECSClient } = await import('@aws-sdk/client-ecs');
    const ecsClient = new ECSClient(this.clientConfig());

    const result = await ecsClient.send(
      new UpdateServiceCommand({
        cluster: config.compute.ecsClusterArn,
        service: params.serviceArn,
        taskDefinition: taskDefArn,
        forceNewDeployment: true,
      })
    );

    return {
      taskDefArn,
      serviceArn: result.service?.serviceArn ?? params.serviceArn,
    };
  }

  // ─── Teardown ─────────────────────────────────────────────────────────────────

  async teardown(params: TeardownParams): Promise<void> {
    const { UpdateServiceCommand, DeleteServiceCommand, ECSClient } =
      await import('@aws-sdk/client-ecs');
    const ecsClient = new ECSClient(this.clientConfig());

    // Scale service to 0, then delete
    if (params.serviceArn) {
      await ecsClient.send(
        new UpdateServiceCommand({
          cluster: config.compute.ecsClusterArn,
          service: params.serviceArn,
          desiredCount: 0,
        })
      );
      await ecsClient.send(
        new DeleteServiceCommand({
          cluster: config.compute.ecsClusterArn,
          service: params.serviceArn,
          force: true,
        })
      );
    }

    await this.deleteRoute(params.targetGroupArn, params.ruleArn);
  }

  // ─── Logs ─────────────────────────────────────────────────────────────────────

  async getLogs(
    containerId: string,
    options?: { limit?: number; startTime?: number; nextToken?: string }
  ): Promise<LogStream> {
    const { FilterLogEventsCommand, CloudWatchLogsClient } =
      await import('@aws-sdk/client-cloudwatch-logs');
    const cwClient = new CloudWatchLogsClient(this.clientConfig());

    const logGroupName = `/ecs/compute/${containerId}`;
    const result = await cwClient.send(
      new FilterLogEventsCommand({
        logGroupName,
        limit: options?.limit ?? 100,
        startTime: options?.startTime,
        nextToken: options?.nextToken,
      })
    );

    return {
      events: (result.events ?? []).map((e) => ({
        timestamp: e.timestamp ?? 0,
        message: e.message ?? '',
      })),
      nextToken: result.nextToken,
    };
  }

  // ─── Task methods ─────────────────────────────────────────────────────────────

  async runTask(params: RunTaskParams): Promise<{ taskArn: string }> {
    const { RunTaskCommand, ECSClient } = await import('@aws-sdk/client-ecs');

    const ecsClient = new ECSClient(this.clientConfig());

    const envOverrides = Object.entries(params.envVars).map(([name, value]) => ({
      name,
      value,
    }));

    const result = await ecsClient.send(
      new RunTaskCommand({
        cluster: config.compute.ecsClusterArn,
        taskDefinition: params.taskDefinitionArn,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.compute.subnetIds,
            securityGroups: [config.compute.securityGroupId],
            assignPublicIp: 'ENABLED',
          },
        },
        overrides: {
          containerOverrides: [
            {
              name: params.containerId,
              environment: envOverrides,
              cpu: params.cpu,
              memory: params.memory,
            },
          ],
        },
      }),
    );

    const taskArn = result.tasks?.[0]?.taskArn;
    if (!taskArn) throw new Error('Failed to run task: no task ARN returned');
    return { taskArn };
  }

  async getTaskStatus(taskArn: string): Promise<TaskStatus> {
    const { DescribeTasksCommand, ECSClient } = await import('@aws-sdk/client-ecs');

    const ecsClient = new ECSClient(this.clientConfig());

    const result = await ecsClient.send(
      new DescribeTasksCommand({
        cluster: config.compute.ecsClusterArn,
        tasks: [taskArn],
      }),
    );

    const task = result.tasks?.[0];
    if (!task) throw new Error(`Task not found: ${taskArn}`);

    const container = task.containers?.[0];
    const lastStatus = task.lastStatus?.toUpperCase();

    let status: TaskStatus['status'];
    if (lastStatus === 'STOPPED') {
      status = (container?.exitCode === 0) ? 'succeeded' : 'failed';
    } else if (lastStatus === 'RUNNING') {
      status = 'running';
    } else {
      status = 'running';
    }

    return {
      status,
      exitCode: container?.exitCode ?? null,
      startedAt: task.startedAt ?? null,
      stoppedAt: task.stoppedAt ?? null,
    };
  }

  async stopTask(taskArn: string): Promise<void> {
    const { StopTaskCommand, ECSClient } = await import('@aws-sdk/client-ecs');

    const ecsClient = new ECSClient(this.clientConfig());

    await ecsClient.send(
      new StopTaskCommand({
        cluster: config.compute.ecsClusterArn,
        task: taskArn,
        reason: 'Stopped by user via InsForge Compute',
      }),
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private clientConfig() {
    return { region: config.compute.awsRegion };
  }

  async registerTaskDefinition(
    params: Pick<
      ProvisionParams,
      'containerId' | 'imageUri' | 'port' | 'cpu' | 'memory' | 'envVars'
    >
  ): Promise<string> {
    const { RegisterTaskDefinitionCommand, ECSClient } = await import('@aws-sdk/client-ecs');
    const { CreateLogGroupCommand, CloudWatchLogsClient } =
      await import('@aws-sdk/client-cloudwatch-logs');

    const logGroupName = `/ecs/compute/${params.containerId}`;

    // Ensure log group exists (idempotent)
    const cwClient = new CloudWatchLogsClient(this.clientConfig());
    try {
      await cwClient.send(new CreateLogGroupCommand({ logGroupName }));
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'ResourceAlreadyExistsException')) {
        throw err;
      }
    }

    const envPairs = Object.entries(params.envVars).map(([name, value]) => ({ name, value }));

    const ecsClient = new ECSClient(this.clientConfig());
    const result = await ecsClient.send(
      new RegisterTaskDefinitionCommand({
        family: `compute-${params.containerId}`,
        networkMode: 'awsvpc',
        requiresCompatibilities: ['FARGATE'],
        cpu: String(params.cpu),
        memory: String(params.memory),
        executionRoleArn: config.compute.executionRoleArn,
        containerDefinitions: [
          {
            name: params.containerId,
            image: params.imageUri,
            essential: true,
            portMappings: [{ containerPort: params.port, protocol: 'tcp' }],
            environment: envPairs,
            logConfiguration: {
              logDriver: 'awslogs',
              options: {
                'awslogs-group': logGroupName,
                'awslogs-region': config.compute.awsRegion,
                'awslogs-stream-prefix': 'ecs',
              },
            },
          },
        ],
      })
    );

    const taskDefinitionArn = result.taskDefinition?.taskDefinitionArn;
    if (!taskDefinitionArn) throw new Error('Failed to register task definition: no ARN returned');
    return taskDefinitionArn;
  }

  private async createRoute(
    containerId: string,
    projectSlug: string,
    port: number,
    healthCheckPath: string
  ): Promise<{ targetGroupArn: string; ruleArn: string; endpointUrl: string }> {
    const { CreateTargetGroupCommand, CreateRuleCommand, ElasticLoadBalancingV2Client } =
      await import('@aws-sdk/client-elastic-load-balancing-v2');

    const elbClient = new ElasticLoadBalancingV2Client(this.clientConfig());

    // Target group name: max 32 chars
    const tgName = `cmp-${containerId.slice(0, 27)}`;

    const tgResult = await elbClient.send(
      new CreateTargetGroupCommand({
        Name: tgName,
        Protocol: 'HTTP',
        Port: port,
        VpcId: config.compute.vpcId,
        TargetType: 'ip',
        HealthCheckPath: healthCheckPath,
        HealthCheckIntervalSeconds: 30,
        HealthyThresholdCount: 2,
        UnhealthyThresholdCount: 3,
      })
    );

    const targetGroupArn = tgResult.TargetGroups?.[0]?.TargetGroupArn;
    if (!targetGroupArn) throw new Error('Failed to create target group: no ARN returned');
    const hostHeader = `${projectSlug}.${config.compute.domain}`;

    // Retry loop for priority collisions
    let ruleArn: string | undefined;
    for (let attempt = 0; attempt < MAX_PRIORITY_RETRIES; attempt++) {
      try {
        const priority = await this.getNextRulePriority(elbClient);
        const ruleResult = await elbClient.send(
          new CreateRuleCommand({
            ListenerArn: config.compute.albListenerArn,
            Priority: priority,
            Conditions: [{ Field: 'host-header', Values: [hostHeader] }],
            Actions: [{ Type: 'forward', TargetGroupArn: targetGroupArn }],
          })
        );
        ruleArn = ruleResult.Rules?.[0]?.RuleArn;
        if (!ruleArn) throw new Error('Failed to create ALB rule: no ARN returned');
        break;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'PriorityInUseException' &&
          attempt < MAX_PRIORITY_RETRIES - 1
        ) {
          logger.warn('ALB priority collision, retrying', { attempt });
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        // Non-retryable error: clean up target group
        await elbClient
          .send(
            new (
              await import('@aws-sdk/client-elastic-load-balancing-v2')
            ).DeleteTargetGroupCommand({
              TargetGroupArn: targetGroupArn,
            })
          )
          .catch(() => undefined);
        throw err;
      }
    }

    if (!ruleArn) throw new Error('Failed to create ALB rule: no ARN returned after retries');
    return {
      targetGroupArn,
      ruleArn,
      endpointUrl: `https://${hostHeader}`,
    };
  }

  private async createEcsService(
    containerId: string,
    taskDefArn: string,
    targetGroupArn: string,
    port: number
  ): Promise<string> {
    const { CreateServiceCommand, ECSClient, LaunchType, SchedulingStrategy } =
      await import('@aws-sdk/client-ecs');

    const ecsClient = new ECSClient(this.clientConfig());
    const serviceName = `compute-${containerId.slice(0, 200)}`;

    const result = await ecsClient.send(
      new CreateServiceCommand({
        cluster: config.compute.ecsClusterArn,
        serviceName,
        taskDefinition: taskDefArn,
        desiredCount: 1,
        launchType: LaunchType.FARGATE,
        schedulingStrategy: SchedulingStrategy.REPLICA,
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.compute.subnetIds,
            securityGroups: [config.compute.securityGroupId],
            assignPublicIp: 'ENABLED',
          },
        },
        loadBalancers: [
          {
            targetGroupArn,
            containerName: containerId,
            containerPort: port,
          },
        ],
        deploymentConfiguration: {
          deploymentCircuitBreaker: { enable: true, rollback: true },
        },
      })
    );

    const serviceArn = result.service?.serviceArn;
    if (!serviceArn) throw new Error('Failed to create ECS service: no ARN returned');
    return serviceArn;
  }

  private async deleteRoute(targetGroupArn: string, ruleArn: string): Promise<void> {
    const { DeleteRuleCommand, DeleteTargetGroupCommand, ElasticLoadBalancingV2Client } =
      await import('@aws-sdk/client-elastic-load-balancing-v2');

    const elbClient = new ElasticLoadBalancingV2Client(this.clientConfig());

    if (ruleArn) {
      await elbClient
        .send(new DeleteRuleCommand({ RuleArn: ruleArn }))
        .catch((e) => logger.warn('Failed to delete ALB rule', { ruleArn, error: String(e) }));
    }
    if (targetGroupArn) {
      // Target group can only be deleted after it's not associated with any rules
      await new Promise((r) => setTimeout(r, 2000));
      await elbClient
        .send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }))
        .catch((e) =>
          logger.warn('Failed to delete target group', { targetGroupArn, error: String(e) })
        );
    }
  }

  private async getNextRulePriority(
    elbClient: InstanceType<
      typeof import('@aws-sdk/client-elastic-load-balancing-v2').ElasticLoadBalancingV2Client
    >
  ): Promise<number> {
    const { DescribeRulesCommand } = await import('@aws-sdk/client-elastic-load-balancing-v2');
    const result = await elbClient.send(
      new DescribeRulesCommand({ ListenerArn: config.compute.albListenerArn })
    );
    const priorities = (result.Rules ?? [])
      .map((r) => parseInt(r.Priority ?? '0', 10))
      .filter((p) => !isNaN(p) && p > 0);

    if (priorities.length === 0) {
      return 1;
    }
    return Math.max(...priorities) + 1;
  }

  private async waitForBuild(
    client: InstanceType<typeof import('@aws-sdk/client-codebuild').CodeBuildClient>,
    buildId: string
  ): Promise<void> {
    const { BatchGetBuildsCommand } = await import('@aws-sdk/client-codebuild');
    const maxAttempts = 60;
    const intervalMs = 10_000;

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, intervalMs));
      const result = await client.send(new BatchGetBuildsCommand({ ids: [buildId] }));
      const build = result.builds?.[0];
      if (!build) {
        continue;
      }
      if (build.buildStatus === 'SUCCEEDED') {
        return;
      }
      if (build.buildStatus && !['IN_PROGRESS', 'SUCCEEDED'].includes(build.buildStatus)) {
        throw new Error(`CodeBuild failed with status: ${build.buildStatus}`);
      }
    }
    throw new Error('CodeBuild timed out after 10 minutes');
  }
}
