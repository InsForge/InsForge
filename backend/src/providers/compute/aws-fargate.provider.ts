import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  CreateServiceCommand,
  UpdateServiceCommand,
  DescribeServicesCommand,
  DeleteServiceCommand,
  NetworkMode,
  LaunchType,
  SchedulingStrategy,
  TransportProtocol,
} from '@aws-sdk/client-ecs';
import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  CreateRuleCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  TargetTypeEnum,
  ProtocolEnum,
  ActionTypeEnum,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  CodeBuildClient,
  StartBuildCommand,
  BatchGetBuildsCommand,
} from '@aws-sdk/client-codebuild';
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  FilterLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { config } from '@/infra/config/app.config.js';
import type {
  ComputeProvider,
  BuildParams,
  BuildResult,
  DeployParams,
  DeployResult,
  RouteParams,
  RouteResult,
  ContainerStatus,
  LogOpts,
  LogStream,
} from './base.provider.js';

export class AwsFargateProvider implements ComputeProvider {
  private ecsClient!: ECSClient;
  private elbClient!: ElasticLoadBalancingV2Client;
  private codebuildClient!: CodeBuildClient;
  private logsClient!: CloudWatchLogsClient;

  initialize(): Promise<void> {
    const credentials = {
      accessKeyId: config.compute.awsAccessKeyId,
      secretAccessKey: config.compute.awsSecretAccessKey,
    };
    const region = config.compute.awsRegion;

    this.ecsClient = new ECSClient({ region, credentials });
    this.elbClient = new ElasticLoadBalancingV2Client({ region, credentials });
    this.codebuildClient = new CodeBuildClient({ region, credentials });
    this.logsClient = new CloudWatchLogsClient({ region, credentials });

    return Promise.resolve();
  }

  async buildImage(params: BuildParams): Promise<BuildResult> {
    const { containerId, githubRepo, githubBranch, dockerfilePath, githubToken, imageTag } = params;
    const imageUri = `${config.compute.ecrRegistry}/${containerId}:${imageTag}`;

    // C5: Store GitHub token reference in Secrets Manager; use SECRETS_MANAGER type
    const command = new StartBuildCommand({
      projectName: config.compute.codebuildProject,
      environmentVariablesOverride: [
        { name: 'REPO_URL', value: githubRepo, type: 'PLAINTEXT' },
        { name: 'BRANCH', value: githubBranch, type: 'PLAINTEXT' },
        { name: 'DOCKERFILE_PATH', value: dockerfilePath, type: 'PLAINTEXT' },
        {
          name: 'ECR_REPO',
          value: `${config.compute.ecrRegistry}/${containerId}`,
          type: 'PLAINTEXT',
        },
        { name: 'IMAGE_TAG', value: imageTag, type: 'PLAINTEXT' },
        // githubToken is the Secrets Manager secret ARN or name
        { name: 'GITHUB_TOKEN', value: githubToken, type: 'SECRETS_MANAGER' },
      ],
    });

    const result = await this.codebuildClient.send(command);
    const build = result.build;
    const buildId = build?.id ?? '';
    const logUrl = build?.logs?.deepLink ?? '';

    return { buildId, imageUri, logUrl };
  }

  async getBuildStatus(buildId: string): Promise<{ status: string; logUrl: string }> {
    const command = new BatchGetBuildsCommand({ ids: [buildId] });
    const result = await this.codebuildClient.send(command);
    const build = result.builds?.[0];

    return {
      status: build?.buildStatus ?? 'UNKNOWN',
      logUrl: build?.logs?.deepLink ?? '',
    };
  }

  async deploy(params: DeployParams): Promise<DeployResult> {
    const { containerId, imageUri, cpu, memory, port, healthCheckPath, envVars, projectSlug } =
      params;

    const logGroup = `/insforge/compute/${containerId}`;
    const taskFamily = `insforge-compute-${containerId}`;
    const serviceName = `insforge-compute-${containerId}`;

    // C2: Create CloudWatch log group before registering the task definition
    try {
      const createLogGroupCommand = new CreateLogGroupCommand({ logGroupName: logGroup });
      await this.logsClient.send(createLogGroupCommand);
    } catch (err: unknown) {
      // Ignore ResourceAlreadyExistsException — log group may already exist
      const errName = (err as { name?: string }).name;
      if (errName !== 'ResourceAlreadyExistsException') {
        throw err;
      }
    }

    // Register task definition
    // C10: Use wget-based health check instead of curl (container may not have curl)
    const registerCommand = new RegisterTaskDefinitionCommand({
      family: taskFamily,
      networkMode: NetworkMode.AWSVPC,
      requiresCompatibilities: [LaunchType.FARGATE],
      cpu: String(cpu),
      memory: String(memory),
      executionRoleArn: config.compute.executionRoleArn,
      containerDefinitions: [
        {
          name: containerId,
          image: imageUri,
          portMappings: [
            {
              containerPort: port,
              protocol: TransportProtocol.TCP,
            },
          ],
          environment: Object.entries(envVars).map(([name, value]) => ({ name, value })),
          healthCheck: {
            command: [
              'CMD-SHELL',
              `wget -q --spider http://localhost:${port}${healthCheckPath} || exit 1`,
            ],
            interval: 30,
            timeout: 5,
            retries: 3,
            startPeriod: 60,
          },
          logConfiguration: {
            logDriver: 'awslogs',
            options: {
              'awslogs-group': logGroup,
              'awslogs-region': config.compute.awsRegion,
              'awslogs-stream-prefix': containerId,
            },
          },
        },
      ],
    });

    const taskDefResult = await this.ecsClient.send(registerCommand);
    const taskDefArn = taskDefResult.taskDefinition?.taskDefinitionArn ?? '';

    // Create route first to get target group
    const routeResult = await this.createRoute({
      containerId,
      projectSlug,
      port,
      healthCheckPath,
    });

    // Create ECS service
    const createServiceCommand = new CreateServiceCommand({
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
          targetGroupArn: routeResult.targetGroupArn,
          containerName: containerId,
          containerPort: port,
        },
      ],
      deploymentConfiguration: {
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
      },
    });

    const serviceResult = await this.ecsClient.send(createServiceCommand);
    const serviceArn = serviceResult.service?.serviceArn ?? '';

    // C6: Include targetGroupArn and ruleArn in DeployResult
    return {
      serviceArn,
      taskDefArn,
      endpointUrl: routeResult.endpointUrl,
      targetGroupArn: routeResult.targetGroupArn,
      ruleArn: routeResult.ruleArn,
    };
  }

  async updateService(serviceArn: string, taskDefArn: string): Promise<void> {
    const command = new UpdateServiceCommand({
      cluster: config.compute.ecsClusterArn,
      service: serviceArn,
      taskDefinition: taskDefArn,
      deploymentConfiguration: {
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
      },
    });

    await this.ecsClient.send(command);
  }

  async stop(serviceArn: string): Promise<void> {
    const command = new UpdateServiceCommand({
      cluster: config.compute.ecsClusterArn,
      service: serviceArn,
      desiredCount: 0,
    });

    await this.ecsClient.send(command);
  }

  async destroy(serviceArn: string): Promise<void> {
    await this.stop(serviceArn);

    const command = new DeleteServiceCommand({
      cluster: config.compute.ecsClusterArn,
      service: serviceArn,
      force: true,
    });

    await this.ecsClient.send(command);
  }

  async getStatus(serviceArn: string): Promise<ContainerStatus> {
    const command = new DescribeServicesCommand({
      cluster: config.compute.ecsClusterArn,
      services: [serviceArn],
    });

    const result = await this.ecsClient.send(command);
    const service = result.services?.[0];

    if (!service) {
      return {
        running: false,
        desiredCount: 0,
        runningCount: 0,
        healthStatus: 'UNKNOWN',
        lastEvent: '',
      };
    }

    const lastEvent = service.events?.[0]?.message ?? '';
    const runningCount = service.runningCount ?? 0;
    const desiredCount = service.desiredCount ?? 0;

    return {
      running: runningCount > 0 && runningCount === desiredCount,
      desiredCount,
      runningCount,
      healthStatus: service.status ?? 'UNKNOWN',
      lastEvent,
    };
  }

  async getLogs(serviceArn: string, opts: LogOpts): Promise<LogStream> {
    // Derive containerId from serviceArn: last segment after "service/<cluster>/"
    const arnParts = serviceArn.split('/');
    const containerId = arnParts[arnParts.length - 1].replace(/^insforge-compute-/, '');
    const logGroup = `/insforge/compute/${containerId}`;

    // C9: Use FilterLogEvents instead of GetLogEvents on a specific stream,
    // so we get all log streams (task IDs) without needing to know the exact stream name.
    const command = new FilterLogEventsCommand({
      logGroupName: logGroup,
      startTime: opts.startTime,
      endTime: opts.endTime,
      limit: opts.limit,
      nextToken: opts.nextToken,
    });

    const result = await this.logsClient.send(command);

    return {
      events: (result.events ?? []).map((e) => ({
        timestamp: new Date(e.timestamp ?? 0).toISOString(),
        message: e.message ?? '',
      })),
      nextToken: result.nextToken ?? undefined,
    };
  }

  async createRoute(params: RouteParams): Promise<RouteResult> {
    const { containerId, projectSlug, port, healthCheckPath } = params;
    const hostHeader = `${projectSlug}.${config.compute.domain}`;

    // C3: VpcId is required for IP target groups
    // C4: Use "cmp-" prefix + 28 chars to stay within the 32-char limit
    const createTgCommand = new CreateTargetGroupCommand({
      Name: `cmp-${containerId.substring(0, 28)}`,
      Protocol: ProtocolEnum.HTTP,
      Port: port,
      VpcId: config.compute.vpcId,
      TargetType: TargetTypeEnum.IP,
      HealthCheckPath: healthCheckPath,
      HealthCheckProtocol: ProtocolEnum.HTTP,
      HealthCheckEnabled: true,
    });

    const tgResult = await this.elbClient.send(createTgCommand);
    const targetGroupArn = tgResult.TargetGroups?.[0]?.TargetGroupArn ?? '';

    // Create listener rule (host-based routing)
    const createRuleCommand = new CreateRuleCommand({
      ListenerArn: config.compute.albListenerArn,
      Priority: await this._getNextRulePriority(),
      Conditions: [
        {
          Field: 'host-header',
          HostHeaderConfig: {
            Values: [hostHeader],
          },
        },
      ],
      Actions: [
        {
          Type: ActionTypeEnum.FORWARD,
          TargetGroupArn: targetGroupArn,
        },
      ],
    });

    const ruleResult = await this.elbClient.send(createRuleCommand);
    const ruleArn = ruleResult.Rules?.[0]?.RuleArn ?? '';

    return {
      targetGroupArn,
      ruleArn,
      endpointUrl: `https://${hostHeader}`,
    };
  }

  async deleteRoute(targetGroupArn: string, ruleArn: string): Promise<void> {
    const deleteRuleCommand = new DeleteRuleCommand({ RuleArn: ruleArn });
    await this.elbClient.send(deleteRuleCommand);

    const deleteTgCommand = new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn });
    await this.elbClient.send(deleteTgCommand);
  }

  /**
   * Find the next available rule priority for the ALB listener.
   * ALB rule priorities must be unique integers between 1 and 50000.
   */
  private async _getNextRulePriority(): Promise<number> {
    const { DescribeRulesCommand } = await import('@aws-sdk/client-elastic-load-balancing-v2');
    const command = new DescribeRulesCommand({ ListenerArn: config.compute.albListenerArn });
    const result = await this.elbClient.send(command);
    const priorities = (result.Rules ?? [])
      .map((r) => parseInt(r.Priority ?? '0', 10))
      .filter((p) => !isNaN(p) && p > 0);

    if (priorities.length === 0) {
      return 1;
    }
    return Math.max(...priorities) + 1;
  }
}
