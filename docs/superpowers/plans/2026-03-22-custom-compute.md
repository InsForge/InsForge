# Custom Compute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom Docker container deployment to InsForge via AWS ECS Fargate, allowing users to run their own containers alongside InsForge's managed services.

**Architecture:** New `compute` module following InsForge's layered architecture (routes → service → provider). Provider abstraction (`ComputeProvider` interface) with `AwsFargateProvider` implementation. Database schema under `compute.*`. Frontend feature under `features/compute/`.

**Tech Stack:** Express routes, Zod schemas, PostgreSQL, AWS SDK v3 (`@aws-sdk/client-ecs`, `@aws-sdk/client-elastic-load-balancing-v2`, `@aws-sdk/client-codebuild`, `@aws-sdk/client-ecr`), React + TanStack Query, `@insforge/ui` components.

**Spec:** `docs/superpowers/specs/2026-03-22-custom-compute-design.md`

---

## File Structure

### Backend — New Files

| File | Responsibility |
| ---- | -------------- |
| `backend/src/infra/database/migrations/025_create-compute-schema.sql` | Create `compute` schema, `containers` and `deployments` tables |
| `shared-schemas/src/compute.schema.ts` | Core data schemas (container, deployment) |
| `shared-schemas/src/compute-api.schema.ts` | Request/response validation schemas |
| `backend/src/providers/compute/base.provider.ts` | `ComputeProvider` interface |
| `backend/src/providers/compute/aws-fargate.provider.ts` | AWS Fargate implementation |
| `backend/src/services/compute/compute.service.ts` | Business logic singleton |
| `backend/src/api/routes/compute/index.routes.ts` | Express routes |

### Backend — Modified Files

| File | Change |
| ---- | ------ |
| `backend/src/infra/config/app.config.ts` | Add `compute` config section |
| `backend/src/server.ts` | Import and mount compute router |
| `shared-schemas/src/index.ts` | Re-export compute schemas |
| `backend/package.json` | Add AWS SDK dependencies |

### Frontend — New Files

| File | Responsibility |
| ---- | -------------- |
| `frontend/src/features/compute/services/compute.service.ts` | API client for compute endpoints |
| `frontend/src/features/compute/hooks/useCompute.ts` | React Query hooks |
| `frontend/src/features/compute/pages/ComputePage.tsx` | Main compute page |
| `frontend/src/features/compute/components/ContainerCard.tsx` | Container status card |
| `frontend/src/features/compute/components/DeployModal.tsx` | Deploy new container modal |
| `frontend/src/features/compute/components/ContainerDetail.tsx` | Container detail view with tabs |
| `frontend/src/features/compute/components/EnvVarsTab.tsx` | Environment variables editor |
| `frontend/src/features/compute/components/DeploymentsTab.tsx` | Deployment history list |
| `frontend/src/features/compute/components/BuildLogPanel.tsx` | Build log slide-out panel |

### Frontend — Modified Files

| File | Change |
| ---- | ------ |
| `frontend/src/lib/utils/menuItems.ts` | Add compute menu item |
| `frontend/src/lib/routing/AppRoutes.tsx` | Add compute routes |
| `frontend/src/components/layout/AppSidebar.tsx` | Include compute menu item |

---

## Task 1: Database Migration

**Files:**
- Create: `backend/src/infra/database/migrations/025_create-compute-schema.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 025_create-compute-schema.sql
-- Create compute schema and tables for custom container deployment

CREATE SCHEMA IF NOT EXISTS compute;

-- Container definitions
CREATE TABLE IF NOT EXISTS compute.containers (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            UUID NOT NULL,  -- No FK: single-tenant self-hosted, project_id used for future multi-tenancy
  name                  TEXT NOT NULL DEFAULT 'default',

  -- Source
  source_type           TEXT NOT NULL CHECK (source_type IN ('github', 'image')),
  github_repo           TEXT,
  github_branch         TEXT,
  image_url             TEXT,
  dockerfile_path       TEXT DEFAULT './Dockerfile',

  -- Runtime config
  cpu                   INTEGER NOT NULL DEFAULT 256,
  memory                INTEGER NOT NULL DEFAULT 512,
  port                  INTEGER NOT NULL DEFAULT 8080,
  health_check_path     TEXT DEFAULT '/health',
  env_vars_encrypted    TEXT,

  -- State
  status                TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'building', 'deploying',
                               'running', 'stopped', 'failed')),
  endpoint_url          TEXT,

  -- AWS references
  ecs_service_arn       TEXT,
  ecs_task_def_arn      TEXT,
  target_group_arn      TEXT,
  alb_rule_arn          TEXT,

  -- Scaling (future)
  replicas              INTEGER DEFAULT 1,

  -- Auto-deploy
  auto_deploy           BOOLEAN DEFAULT true,
  github_webhook_id     TEXT,
  github_webhook_secret TEXT,

  -- Custom domains (future)
  custom_domain         TEXT,

  -- Region (future multi-region)
  region                TEXT DEFAULT 'us-east-1',

  -- Metadata
  last_deployed_at      TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),

  -- Phase 1: one container per project
  CONSTRAINT unique_project_container UNIQUE (project_id)
);

-- Deployment history
CREATE TABLE IF NOT EXISTS compute.deployments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id      UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,

  commit_sha        TEXT,
  image_tag         TEXT,
  build_log_url     TEXT,

  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'building', 'pushing',
                           'deploying', 'live', 'failed')),
  error_message     TEXT,

  triggered_by      TEXT DEFAULT 'manual'
                    CHECK (triggered_by IN ('manual', 'git_push',
                           'rollback', 'config_change', 'cron')),

  is_active         BOOLEAN DEFAULT false,

  started_at        TIMESTAMPTZ DEFAULT now(),
  finished_at       TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_compute_containers_project
  ON compute.containers(project_id);

CREATE INDEX IF NOT EXISTS idx_compute_deployments_container
  ON compute.deployments(container_id);

CREATE INDEX IF NOT EXISTS idx_compute_deployments_active
  ON compute.deployments(container_id, is_active) WHERE is_active = true;

-- Updated_at trigger (uses function from 000_create-base-tables.sql)
DROP TRIGGER IF EXISTS set_compute_containers_updated_at ON compute.containers;
CREATE TRIGGER set_compute_containers_updated_at
  BEFORE UPDATE ON compute.containers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
```

- [ ] **Step 2: Run the migration**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm run migrate:up`
Expected: Migration 025 applied successfully.

- [ ] **Step 3: Verify tables exist**

Run: `psql -U postgres -d insforge -c "\dt compute.*"`
Expected: Lists `compute.containers` and `compute.deployments`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/infra/database/migrations/025_create-compute-schema.sql
git commit -m "feat(compute): add database migration for compute schema"
```

---

## Task 2: Shared Schemas

**Files:**
- Create: `shared-schemas/src/compute.schema.ts`
- Create: `shared-schemas/src/compute-api.schema.ts`
- Modify: `shared-schemas/src/index.ts`

- [ ] **Step 1: Write core data schemas**

Create `shared-schemas/src/compute.schema.ts`:

```typescript
import { z } from 'zod';

export const containerSourceType = z.enum(['github', 'image']);

export const containerStatus = z.enum([
  'pending', 'building', 'deploying', 'running', 'stopped', 'failed',
]);

export const deploymentStatus = z.enum([
  'pending', 'building', 'pushing', 'deploying', 'live', 'failed',
]);

export const deploymentTrigger = z.enum([
  'manual', 'git_push', 'rollback', 'config_change', 'cron',
]);

// Valid Fargate CPU/memory combinations
export const FARGATE_CPU_MEMORY_MAP: Record<number, number[]> = {
  256: [512, 1024, 2048],
  512: [1024, 2048, 3072, 4096],
  1024: [2048, 3072, 4096, 5120, 6144, 7168, 8192],
};

export const containerSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  source_type: containerSourceType,
  github_repo: z.string().nullable(),
  github_branch: z.string().nullable(),
  image_url: z.string().nullable(),
  dockerfile_path: z.string().nullable(),
  cpu: z.number(),
  memory: z.number(),
  port: z.number(),
  health_check_path: z.string().nullable(),
  status: containerStatus,
  endpoint_url: z.string().nullable(),
  auto_deploy: z.boolean(),
  replicas: z.number(),
  custom_domain: z.string().nullable(),
  region: z.string(),
  last_deployed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const deploymentSchema = z.object({
  id: z.string().uuid(),
  container_id: z.string().uuid(),
  commit_sha: z.string().nullable(),
  image_tag: z.string().nullable(),
  build_log_url: z.string().nullable(),
  status: deploymentStatus,
  error_message: z.string().nullable(),
  triggered_by: deploymentTrigger,
  is_active: z.boolean(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export type ContainerSchema = z.infer<typeof containerSchema>;
export type DeploymentSchema = z.infer<typeof deploymentSchema>;
```

- [ ] **Step 2: Write API request/response schemas**

Create `shared-schemas/src/compute-api.schema.ts`:

```typescript
import { z } from 'zod';
import { FARGATE_CPU_MEMORY_MAP } from './compute.schema';

export const createContainerSchema = z.object({
  name: z.string().min(1).max(63).regex(/^[a-z0-9-]+$/, 'Must be lowercase alphanumeric with hyphens').default('default'),
  source_type: z.enum(['github', 'image']),
  github_repo: z.string().optional(),
  github_branch: z.string().optional(),
  image_url: z.string().url().optional(),
  dockerfile_path: z.string().default('./Dockerfile'),
  cpu: z.number().default(256),
  memory: z.number().default(512),
  port: z.number().min(1).max(65535).default(8080),
  health_check_path: z.string().default('/health'),
  auto_deploy: z.boolean().default(true),
}).refine((data) => {
  // Validate source fields match source_type
  if (data.source_type === 'github') {
    return !!data.github_repo && !!data.github_branch;
  }
  return !!data.image_url;
}, {
  message: 'GitHub source requires repo and branch; image source requires image_url',
}).refine((data) => {
  // Validate Fargate CPU/memory combo
  const validMemory = FARGATE_CPU_MEMORY_MAP[data.cpu];
  return validMemory && validMemory.includes(data.memory);
}, {
  message: 'Invalid CPU/memory combination for Fargate',
});

export const updateContainerSchema = z.object({
  github_branch: z.string().optional(),
  image_url: z.string().url().optional(),
  dockerfile_path: z.string().optional(),
  cpu: z.number().optional(),
  memory: z.number().optional(),
  port: z.number().min(1).max(65535).optional(),
  health_check_path: z.string().optional(),
  auto_deploy: z.boolean().optional(),
  env_vars: z.record(z.string()).optional(),
});

export const deployContainerSchema = z.object({
  triggered_by: z.enum(['manual', 'config_change']).default('manual'),
});

export type CreateContainerRequest = z.input<typeof createContainerSchema>;
export type UpdateContainerRequest = z.infer<typeof updateContainerSchema>;
export type DeployContainerRequest = z.infer<typeof deployContainerSchema>;
```

- [ ] **Step 3: Add exports to shared-schemas index**

Add to `shared-schemas/src/index.ts`:

```typescript
export * from './compute.schema';
export * from './compute-api.schema';
```

- [ ] **Step 4: Build shared-schemas to verify**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm run build --workspace=shared-schemas`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add shared-schemas/src/compute.schema.ts shared-schemas/src/compute-api.schema.ts shared-schemas/src/index.ts
git commit -m "feat(compute): add shared Zod schemas for compute module"
```

---

## Task 3: App Config

**Files:**
- Modify: `backend/src/infra/config/app.config.ts`

- [ ] **Step 1: Read current config file**

Read `backend/src/infra/config/app.config.ts` to understand the existing structure.

- [ ] **Step 2: Add compute config section**

Add to the `AppConfig` interface and `config` object:

```typescript
// In AppConfig interface:
compute: {
  enabled: boolean;
  provider: string;
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  awsRegion: string;
  ecsClusterArn: string;
  albListenerArn: string;
  ecrRegistry: string;
  codebuildProject: string;
  subnetIds: string[];
  securityGroupId: string;
  domain: string;
  executionRoleArn: string;
};

// In config object:
compute: {
  enabled: process.env.COMPUTE_ENABLED === 'true',
  provider: process.env.COMPUTE_PROVIDER || 'aws_fargate',
  awsAccessKeyId: process.env.COMPUTE_AWS_ACCESS_KEY_ID || '',
  awsSecretAccessKey: process.env.COMPUTE_AWS_SECRET_ACCESS_KEY || '',
  awsRegion: process.env.COMPUTE_AWS_REGION || 'us-east-1',
  ecsClusterArn: process.env.COMPUTE_ECS_CLUSTER_ARN || '',
  albListenerArn: process.env.COMPUTE_ALB_LISTENER_ARN || '',
  ecrRegistry: process.env.COMPUTE_ECR_REGISTRY || '',
  codebuildProject: process.env.COMPUTE_CODEBUILD_PROJECT || '',
  subnetIds: (process.env.COMPUTE_SUBNET_IDS || '').split(',').filter(Boolean),
  securityGroupId: process.env.COMPUTE_SECURITY_GROUP_ID || '',
  domain: process.env.COMPUTE_DOMAIN || 'compute.insforge.app',
  executionRoleArn: process.env.COMPUTE_EXECUTION_ROLE_ARN || '',
},
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/infra/config/app.config.ts
git commit -m "feat(compute): add compute configuration section"
```

---

## Task 4: Provider Interface

**Files:**
- Create: `backend/src/providers/compute/base.provider.ts`

- [ ] **Step 1: Write the ComputeProvider interface**

Create `backend/src/providers/compute/base.provider.ts`:

```typescript
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

  // Build
  buildImage(params: BuildParams): Promise<BuildResult>;
  getBuildStatus(buildId: string): Promise<{ status: string; logUrl: string }>;

  // Container lifecycle
  deploy(params: DeployParams): Promise<DeployResult>;
  updateService(serviceArn: string, taskDefArn: string): Promise<void>;
  stop(serviceArn: string): Promise<void>;
  destroy(serviceArn: string): Promise<void>;

  // Status
  getStatus(serviceArn: string): Promise<ContainerStatus>;
  getLogs(serviceArn: string, opts: LogOpts): Promise<LogStream>;

  // Routing
  createRoute(params: RouteParams): Promise<RouteResult>;
  deleteRoute(targetGroupArn: string, ruleArn: string): Promise<void>;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/providers/compute/base.provider.ts
git commit -m "feat(compute): add ComputeProvider interface"
```

---

## Task 5: AWS Fargate Provider

**Files:**
- Create: `backend/src/providers/compute/aws-fargate.provider.ts`
- Modify: `backend/package.json` (add AWS SDK deps)

- [ ] **Step 1: Install AWS SDK dependencies**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm install @aws-sdk/client-ecs @aws-sdk/client-elastic-load-balancing-v2 @aws-sdk/client-codebuild @aws-sdk/client-ecr @aws-sdk/client-cloudwatch-logs --workspace=backend`
Expected: Packages installed successfully.

- [ ] **Step 2: Write the AWS Fargate provider**

Create `backend/src/providers/compute/aws-fargate.provider.ts`. This is a large file — implement each method group:

**Constructor + initialize:** Create AWS SDK clients using credentials from config.

```typescript
import {
  ECSClient, RegisterTaskDefinitionCommand, CreateServiceCommand,
  UpdateServiceCommand, DeleteServiceCommand, DescribeServicesCommand,
  ListTasksCommand, DescribeTasksCommand, DeregisterTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';
import {
  ElasticLoadBalancingV2Client, CreateTargetGroupCommand,
  DeleteTargetGroupCommand, CreateRuleCommand, DeleteRuleCommand,
  DescribeTargetHealthCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  CodeBuildClient, StartBuildCommand, BatchGetBuildsCommand,
} from '@aws-sdk/client-codebuild';
import {
  CloudWatchLogsClient, GetLogEventsCommand,
} from '@aws-sdk/client-cloudwatch-logs';
import { config } from '@/infra/config/app.config.js';
import type {
  ComputeProvider, BuildParams, BuildResult, DeployParams, DeployResult,
  RouteParams, RouteResult, ContainerStatus, LogOpts, LogStream,
} from './base.provider.js';

export class AwsFargateProvider implements ComputeProvider {
  private ecs!: ECSClient;
  private elb!: ElasticLoadBalancingV2Client;
  private codebuild!: CodeBuildClient;
  private cwLogs!: CloudWatchLogsClient;

  async initialize(): Promise<void> {
    const credentials = {
      accessKeyId: config.compute.awsAccessKeyId,
      secretAccessKey: config.compute.awsSecretAccessKey,
    };
    const region = config.compute.awsRegion;

    this.ecs = new ECSClient({ region, credentials });
    this.elb = new ElasticLoadBalancingV2Client({ region, credentials });
    this.codebuild = new CodeBuildClient({ region, credentials });
    this.cwLogs = new CloudWatchLogsClient({ region, credentials });
  }

  async buildImage(params: BuildParams): Promise<BuildResult> {
    const { buildId } = (await this.codebuild.send(new StartBuildCommand({
      projectName: config.compute.codebuildProject,
      environmentVariablesOverride: [
        { name: 'REPO_URL', value: `https://x-access-token:${params.githubToken}@github.com/${params.githubRepo}.git`, type: 'PLAINTEXT' },
        { name: 'BRANCH', value: params.githubBranch, type: 'PLAINTEXT' },
        { name: 'DOCKERFILE_PATH', value: params.dockerfilePath, type: 'PLAINTEXT' },
        { name: 'ECR_REPO', value: `${config.compute.ecrRegistry}/${params.containerId}`, type: 'PLAINTEXT' },
        { name: 'IMAGE_TAG', value: params.imageTag, type: 'PLAINTEXT' },
      ],
    }))).build!;

    return {
      buildId: buildId!,
      imageUri: `${config.compute.ecrRegistry}/${params.containerId}:${params.imageTag}`,
      logUrl: `https://${config.compute.awsRegion}.console.aws.amazon.com/codesuite/codebuild/projects/${config.compute.codebuildProject}/build/${buildId}`,
    };
  }

  async getBuildStatus(buildId: string): Promise<{ status: string; logUrl: string }> {
    const result = await this.codebuild.send(new BatchGetBuildsCommand({ ids: [buildId] }));
    const build = result.builds![0];
    return {
      status: build.buildStatus || 'IN_PROGRESS',
      logUrl: build.logs?.deepLink || '',
    };
  }

  async deploy(params: DeployParams): Promise<DeployResult> {
    // Register task definition
    const taskDef = await this.ecs.send(new RegisterTaskDefinitionCommand({
      family: `insforge-compute-${params.containerId}`,
      networkMode: 'awsvpc',
      requiresCompatibilities: ['FARGATE'],
      cpu: String(params.cpu),
      memory: String(params.memory),
      executionRoleArn: config.compute.executionRoleArn,
      containerDefinitions: [{
        name: 'app',
        image: params.imageUri,
        portMappings: [{ containerPort: params.port, protocol: 'tcp' }],
        environment: Object.entries(params.envVars).map(([name, value]) => ({ name, value })),
        healthCheck: {
          command: ['CMD-SHELL', `curl -f http://localhost:${params.port}${params.healthCheckPath} || exit 1`],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 60,
        },
        logConfiguration: {
          logDriver: 'awslogs',
          options: {
            'awslogs-group': `/insforge/compute/${params.containerId}`,
            'awslogs-region': config.compute.awsRegion,
            'awslogs-stream-prefix': 'app',
          },
        },
      }],
    }));

    const taskDefArn = taskDef.taskDefinition!.taskDefinitionArn!;

    // Create or update service
    let serviceArn: string;
    try {
      const service = await this.ecs.send(new CreateServiceCommand({
        cluster: config.compute.ecsClusterArn,
        serviceName: `compute-${params.containerId}`,
        taskDefinition: taskDefArn,
        desiredCount: 1,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: config.compute.subnetIds,
            securityGroups: [config.compute.securityGroupId],
            assignPublicIp: 'ENABLED',
          },
        },
        deploymentConfiguration: {
          deploymentCircuitBreaker: { enable: true, rollback: true },
          maximumPercent: 200,
          minimumHealthyPercent: 100,
        },
      }));
      serviceArn = service.service!.serviceArn!;
    } catch (error: unknown) {
      // Service already exists, update it
      if ((error as { name?: string }).name === 'ServiceAlreadyExists' ||
          (error as { name?: string }).name === 'InvalidParameterException') {
        await this.ecs.send(new UpdateServiceCommand({
          cluster: config.compute.ecsClusterArn,
          service: `compute-${params.containerId}`,
          taskDefinition: taskDefArn,
        }));
        serviceArn = `compute-${params.containerId}`;
      } else {
        throw error;
      }
    }

    return {
      serviceArn,
      taskDefArn,
      endpointUrl: `https://compute.${params.projectSlug}.${config.compute.domain}`,
    };
  }

  async updateService(serviceArn: string, taskDefArn: string): Promise<void> {
    await this.ecs.send(new UpdateServiceCommand({
      cluster: config.compute.ecsClusterArn,
      service: serviceArn,
      taskDefinition: taskDefArn,
    }));
  }

  async stop(serviceArn: string): Promise<void> {
    await this.ecs.send(new UpdateServiceCommand({
      cluster: config.compute.ecsClusterArn,
      service: serviceArn,
      desiredCount: 0,
    }));
  }

  async destroy(serviceArn: string): Promise<void> {
    // Stop first, then delete
    await this.stop(serviceArn);
    await this.ecs.send(new DeleteServiceCommand({
      cluster: config.compute.ecsClusterArn,
      service: serviceArn,
      force: true,
    }));
  }

  async getStatus(serviceArn: string): Promise<ContainerStatus> {
    const result = await this.ecs.send(new DescribeServicesCommand({
      cluster: config.compute.ecsClusterArn,
      services: [serviceArn],
    }));
    const service = result.services![0];
    return {
      running: service.runningCount! > 0,
      desiredCount: service.desiredCount!,
      runningCount: service.runningCount!,
      healthStatus: service.runningCount! > 0 ? 'healthy' : 'unhealthy',
      lastEvent: service.events?.[0]?.message || '',
    };
  }

  async getLogs(serviceArn: string, opts: LogOpts): Promise<LogStream> {
    // Derive log group from service name
    const containerId = serviceArn.replace('compute-', '');
    const result = await this.cwLogs.send(new GetLogEventsCommand({
      logGroupName: `/insforge/compute/${containerId}`,
      logStreamName: 'app',
      startTime: opts.startTime,
      endTime: opts.endTime,
      limit: opts.limit || 100,
      nextToken: opts.nextToken,
    }));
    return {
      events: (result.events || []).map((e) => ({
        timestamp: new Date(e.timestamp!).toISOString(),
        message: e.message || '',
      })),
      nextToken: result.nextForwardToken,
    };
  }

  async createRoute(params: RouteParams): Promise<RouteResult> {
    const hostname = `compute.${params.projectSlug}.${config.compute.domain}`;

    // Create target group
    const tg = await this.elb.send(new CreateTargetGroupCommand({
      Name: `compute-${params.containerId.slice(0, 24)}`,
      Protocol: 'HTTP',
      Port: params.port,
      VpcId: undefined, // Will use the VPC from the ALB
      TargetType: 'ip',
      HealthCheckPath: params.healthCheckPath,
      HealthCheckIntervalSeconds: 30,
      HealthyThresholdCount: 2,
      UnhealthyThresholdCount: 3,
    }));

    const targetGroupArn = tg.TargetGroups![0].TargetGroupArn!;

    // Create ALB listener rule
    const rule = await this.elb.send(new CreateRuleCommand({
      ListenerArn: config.compute.albListenerArn,
      Conditions: [{ Field: 'host-header', Values: [hostname] }],
      Actions: [{ Type: 'forward', TargetGroupArn: targetGroupArn }],
      Priority: Math.floor(Math.random() * 49000) + 1000, // Random priority 1000-50000
    }));

    return {
      targetGroupArn,
      ruleArn: rule.Rules![0].RuleArn!,
      endpointUrl: `https://${hostname}`,
    };
  }

  async deleteRoute(targetGroupArn: string, ruleArn: string): Promise<void> {
    await this.elb.send(new DeleteRuleCommand({ RuleArn: ruleArn }));
    await this.elb.send(new DeleteTargetGroupCommand({ TargetGroupArn: targetGroupArn }));
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npx tsc --noEmit --project backend/tsconfig.json`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/providers/compute/ backend/package.json package-lock.json
git commit -m "feat(compute): implement AWS Fargate provider"
```

---

## Task 6: Compute Service

**Files:**
- Create: `backend/src/services/compute/compute.service.ts`

- [ ] **Step 1: Write the compute service**

Create `backend/src/services/compute/compute.service.ts`:

```typescript
import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { config } from '@/infra/config/app.config.js';
import { SecretService } from '@/services/secrets/secret.service.js';
import type { ComputeProvider } from '@/providers/compute/base.provider.js';
import { AwsFargateProvider } from '@/providers/compute/aws-fargate.provider.js';
import type { ContainerSchema, DeploymentSchema } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

export class ComputeService {
  private static instance: ComputeService;
  private pool: Pool | null = null;
  private provider: ComputeProvider | null = null;

  private constructor() {}

  static getInstance(): ComputeService {
    if (!ComputeService.instance) {
      ComputeService.instance = new ComputeService();
    }
    return ComputeService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private getProvider(): ComputeProvider {
    if (!this.provider) {
      throw new Error('Compute provider not initialized. Is COMPUTE_ENABLED=true?');
    }
    return this.provider;
  }

  async initialize(): Promise<void> {
    if (!config.compute.enabled) {
      logger.info('Compute module disabled');
      return;
    }
    // Currently only AWS Fargate is supported
    this.provider = new AwsFargateProvider();
    await this.provider.initialize();
    logger.info('Compute module initialized with provider: aws_fargate');
  }

  // --- Container CRUD ---

  async createContainer(data: {
    projectId: string;
    name: string;
    sourceType: string;
    githubRepo?: string;
    githubBranch?: string;
    imageUrl?: string;
    dockerfilePath?: string;
    cpu: number;
    memory: number;
    port: number;
    healthCheckPath: string;
    autoDeploy: boolean;
  }): Promise<ContainerSchema> {
    const result = await this.getPool().query(
      `INSERT INTO compute.containers
        (project_id, name, source_type, github_repo, github_branch,
         image_url, dockerfile_path, cpu, memory, port,
         health_check_path, auto_deploy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        data.projectId, data.name, data.sourceType, data.githubRepo || null,
        data.githubBranch || null, data.imageUrl || null,
        data.dockerfilePath || './Dockerfile', data.cpu, data.memory,
        data.port, data.healthCheckPath, data.autoDeploy,
      ]
    );
    return result.rows[0] as ContainerSchema;
  }

  async getContainers(projectId: string): Promise<ContainerSchema[]> {
    const result = await this.getPool().query(
      'SELECT * FROM compute.containers WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    return result.rows as ContainerSchema[];
  }

  async getContainer(id: string): Promise<ContainerSchema | null> {
    const result = await this.getPool().query(
      'SELECT * FROM compute.containers WHERE id = $1',
      [id]
    );
    return (result.rows[0] as ContainerSchema) || null;
  }

  private static ALLOWED_UPDATE_COLUMNS = new Set([
    'github_branch', 'image_url', 'dockerfile_path', 'cpu', 'memory',
    'port', 'health_check_path', 'auto_deploy', 'status',
  ]);

  async updateContainer(id: string, data: Record<string, unknown>): Promise<ContainerSchema> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(data)) {
      if (key === 'env_vars') {
        // Encrypt env vars before storing
        const encrypted = SecretService.getInstance().encrypt(JSON.stringify(value));
        fields.push(`env_vars_encrypted = $${idx++}`);
        values.push(encrypted);
      } else if (ComputeService.ALLOWED_UPDATE_COLUMNS.has(key)) {
        fields.push(`${key} = $${idx++}`);
        values.push(value);
      }
      // Silently skip unknown columns
    }

    if (fields.length === 0) {
      return (await this.getContainer(id))!;
    }

    values.push(id);
    const result = await this.getPool().query(
      `UPDATE compute.containers SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0] as ContainerSchema;
  }

  async deleteContainer(id: string): Promise<void> {
    const container = await this.getContainer(id);
    if (!container) return;

    // Clean up AWS resources
    if (container.ecs_service_arn) {
      await this.getProvider().destroy(container.ecs_service_arn);
    }
    if (container.target_group_arn && container.alb_rule_arn) {
      await this.getProvider().deleteRoute(container.target_group_arn, container.alb_rule_arn);
    }

    await this.getPool().query('DELETE FROM compute.containers WHERE id = $1', [id]);
  }

  // --- Deployments ---

  async deploy(containerId: string, triggeredBy: string = 'manual'): Promise<DeploymentSchema> {
    const container = await this.getContainer(containerId);
    if (!container) throw new Error('Container not found');

    // Check for in-progress deployments
    const active = await this.getPool().query(
      `SELECT id FROM compute.deployments
       WHERE container_id = $1 AND status IN ('pending', 'building', 'pushing', 'deploying')`,
      [containerId]
    );
    if (active.rowCount && active.rowCount > 0) {
      throw new Error('A deployment is already in progress');
    }

    // Create deployment record
    const deployment = await this.getPool().query(
      `INSERT INTO compute.deployments (container_id, triggered_by)
       VALUES ($1, $2) RETURNING *`,
      [containerId, triggeredBy]
    );
    const deploymentRow = deployment.rows[0] as DeploymentSchema;

    // Start async deploy process
    this.executeDeploy(container, deploymentRow).catch((err) => {
      logger.error('Deploy failed', { error: err, containerId, deploymentId: deploymentRow.id });
    });

    return deploymentRow;
  }

  private async executeDeploy(
    container: ContainerSchema,
    deployment: DeploymentSchema
  ): Promise<void> {
    const provider = this.getProvider();
    const pool = this.getPool();

    try {
      let imageUri: string;

      if (container.source_type === 'github') {
        // Build from GitHub
        await pool.query(
          "UPDATE compute.deployments SET status = 'building' WHERE id = $1",
          [deployment.id]
        );
        await pool.query(
          "UPDATE compute.containers SET status = 'building' WHERE id = $1",
          [container.id]
        );

        const imageTag = `deploy-${Date.now()}`;
        const buildResult = await provider.buildImage({
          containerId: container.id,
          githubRepo: container.github_repo!,
          githubBranch: container.github_branch!,
          dockerfilePath: container.dockerfile_path || './Dockerfile',
          githubToken: '', // TODO: get from GitHub OAuth token storage
          imageTag,
        });

        // Poll build status
        let buildComplete = false;
        const timeout = Date.now() + 15 * 60 * 1000; // 15 min timeout
        while (!buildComplete && Date.now() < timeout) {
          await new Promise((resolve) => setTimeout(resolve, 10000)); // 10s poll
          const status = await provider.getBuildStatus(buildResult.buildId);
          if (status.status === 'SUCCEEDED') {
            buildComplete = true;
          } else if (status.status === 'FAILED' || status.status === 'STOPPED') {
            throw new Error(`Build failed: ${status.status}`);
          }
        }
        if (!buildComplete) throw new Error('Build timed out');

        await pool.query(
          "UPDATE compute.deployments SET status = 'pushing', image_tag = $1, build_log_url = $2 WHERE id = $3",
          [imageTag, buildResult.logUrl, deployment.id]
        );

        imageUri = buildResult.imageUri;
      } else {
        // Pre-built image
        imageUri = container.image_url!;
        await pool.query(
          "UPDATE compute.deployments SET image_tag = $1 WHERE id = $2",
          [imageUri, deployment.id]
        );
      }

      // Deploy
      await pool.query(
        "UPDATE compute.deployments SET status = 'deploying' WHERE id = $1",
        [deployment.id]
      );
      await pool.query(
        "UPDATE compute.containers SET status = 'deploying' WHERE id = $1",
        [container.id]
      );

      // Decrypt env vars (query raw field not in shared schema)
      let envVars: Record<string, string> = {};
      const rawContainer = await pool.query(
        'SELECT env_vars_encrypted FROM compute.containers WHERE id = $1',
        [container.id]
      );
      if (rawContainer.rows[0]?.env_vars_encrypted) {
        const decrypted = SecretService.getInstance().decrypt(rawContainer.rows[0].env_vars_encrypted);
        envVars = JSON.parse(decrypted);
      }

      // Add auto-injected vars
      envVars.PORT = String(container.port);
      // INSFORGE_DB_URL, INSFORGE_BASE_URL, INSFORGE_ANON_KEY
      // injected from project config - TODO: wire up from project metadata

      // Create route if first deploy
      if (!container.target_group_arn) {
        const route = await provider.createRoute({
          containerId: container.id,
          projectSlug: container.project_id, // TODO: use actual project slug
          port: container.port,
          healthCheckPath: container.health_check_path || '/health',
        });
        await pool.query(
          `UPDATE compute.containers
           SET target_group_arn = $1, alb_rule_arn = $2, endpoint_url = $3
           WHERE id = $4`,
          [route.targetGroupArn, route.ruleArn, route.endpointUrl, container.id]
        );
      }

      const deployResult = await provider.deploy({
        containerId: container.id,
        imageUri,
        cpu: container.cpu,
        memory: container.memory,
        port: container.port,
        healthCheckPath: container.health_check_path || '/health',
        envVars,
        projectSlug: container.project_id,
      });

      // Mark deployment as live
      await pool.query(
        "UPDATE compute.deployments SET is_active = false WHERE container_id = $1 AND is_active = true",
        [container.id]
      );
      await pool.query(
        "UPDATE compute.deployments SET status = 'live', is_active = true, finished_at = now() WHERE id = $1",
        [deployment.id]
      );
      await pool.query(
        `UPDATE compute.containers
         SET status = 'running', ecs_service_arn = $1, ecs_task_def_arn = $2,
             last_deployed_at = now()
         WHERE id = $3`,
        [deployResult.serviceArn, deployResult.taskDefArn, container.id]
      );

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await pool.query(
        "UPDATE compute.deployments SET status = 'failed', error_message = $1, finished_at = now() WHERE id = $2",
        [message, deployment.id]
      );
      await pool.query(
        "UPDATE compute.containers SET status = 'failed' WHERE id = $1",
        [container.id]
      );
    }
  }

  async getDeployments(containerId: string): Promise<DeploymentSchema[]> {
    const result = await this.getPool().query(
      'SELECT * FROM compute.deployments WHERE container_id = $1 ORDER BY started_at DESC',
      [containerId]
    );
    return result.rows as DeploymentSchema[];
  }

  async getDeployment(id: string): Promise<DeploymentSchema | null> {
    const result = await this.getPool().query(
      'SELECT * FROM compute.deployments WHERE id = $1',
      [id]
    );
    return (result.rows[0] as DeploymentSchema) || null;
  }

  async rollback(containerId: string, deploymentId: string): Promise<DeploymentSchema> {
    const target = await this.getDeployment(deploymentId);
    if (!target) throw new Error('Deployment not found');
    if (target.status === 'failed') throw new Error('Cannot rollback to a failed deployment');
    if (!target.image_tag) throw new Error('Deployment has no image tag');

    const container = await this.getContainer(containerId);
    if (!container) throw new Error('Container not found');

    // Check for in-progress deployments
    const active = await this.getPool().query(
      `SELECT id FROM compute.deployments
       WHERE container_id = $1 AND status IN ('pending', 'building', 'pushing', 'deploying')`,
      [containerId]
    );
    if (active.rowCount && active.rowCount > 0) {
      throw new Error('A deployment is already in progress');
    }

    // Create rollback deployment record
    const deployment = await this.getPool().query(
      `INSERT INTO compute.deployments (container_id, triggered_by, image_tag)
       VALUES ($1, 'rollback', $2) RETURNING *`,
      [containerId, target.image_tag]
    );
    const deploymentRow = deployment.rows[0] as DeploymentSchema;

    // Execute rollback — skip build, go straight to deploy with existing image
    this.executeRollbackDeploy(container, deploymentRow, target.image_tag).catch((err) => {
      logger.error('Rollback failed', { error: err, containerId, deploymentId: deploymentRow.id });
    });

    return deploymentRow;
  }

  private async executeRollbackDeploy(
    container: ContainerSchema,
    deployment: DeploymentSchema,
    imageUri: string
  ): Promise<void> {
    const provider = this.getProvider();
    const pool = this.getPool();

    try {
      await pool.query("UPDATE compute.deployments SET status = 'deploying' WHERE id = $1", [deployment.id]);
      await pool.query("UPDATE compute.containers SET status = 'deploying' WHERE id = $1", [container.id]);

      // Decrypt env vars
      let envVars: Record<string, string> = {};
      const raw = await pool.query('SELECT env_vars_encrypted FROM compute.containers WHERE id = $1', [container.id]);
      if (raw.rows[0]?.env_vars_encrypted) {
        envVars = JSON.parse(SecretService.getInstance().decrypt(raw.rows[0].env_vars_encrypted));
      }
      envVars.PORT = String(container.port);

      const deployResult = await provider.deploy({
        containerId: container.id,
        imageUri,
        cpu: container.cpu,
        memory: container.memory,
        port: container.port,
        healthCheckPath: container.health_check_path || '/health',
        envVars,
        projectSlug: container.project_id,
      });

      // Mark as live
      await pool.query("UPDATE compute.deployments SET is_active = false WHERE container_id = $1 AND is_active = true", [container.id]);
      await pool.query("UPDATE compute.deployments SET status = 'live', is_active = true, finished_at = now() WHERE id = $1", [deployment.id]);
      await pool.query(
        `UPDATE compute.containers SET status = 'running', ecs_service_arn = $1, ecs_task_def_arn = $2, last_deployed_at = now() WHERE id = $3`,
        [deployResult.serviceArn, deployResult.taskDefArn, container.id]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await pool.query("UPDATE compute.deployments SET status = 'failed', error_message = $1, finished_at = now() WHERE id = $2", [message, deployment.id]);
      await pool.query("UPDATE compute.containers SET status = 'failed' WHERE id = $1", [container.id]);
    }
  }

  // --- Logs ---

  async getContainerLogs(containerId: string, opts: LogOpts = {}) {
    const container = await this.getContainer(containerId);
    if (!container?.ecs_service_arn) throw new Error('Container not deployed');
    return this.getProvider().getLogs(container.ecs_service_arn, opts);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npx tsc --noEmit --project backend/tsconfig.json`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/compute/
git commit -m "feat(compute): implement ComputeService with deploy pipeline"
```

---

## Task 7: Backend Routes

**Files:**
- Create: `backend/src/api/routes/compute/index.routes.ts`
- Modify: `backend/src/server.ts`

- [ ] **Step 1: Write the compute routes**

Create `backend/src/api/routes/compute/index.routes.ts`:

```typescript
import { Router } from 'express';
import { verifyAdmin } from '@/api/middlewares/auth.js';
import { ComputeService } from '@/services/compute/compute.service.js';
import { successResponse } from '@/utils/response.js';
import { AppError } from '@/api/middlewares/error.js';
import {
  createContainerSchema,
  updateContainerSchema,
  deployContainerSchema,
} from '@insforge/shared-schemas';
import type { AuthRequest } from '@/types/auth.js';

const router = Router();

// Container CRUD
router.post('/', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const validation = createContainerSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        'INVALID_INPUT'
      );
    }
    const service = ComputeService.getInstance();
    const container = await service.createContainer({
      projectId: req.body.project_id || 'default',
      ...validation.data,
      sourceType: validation.data.source_type,
      githubRepo: validation.data.github_repo,
      githubBranch: validation.data.github_branch,
      imageUrl: validation.data.image_url,
      dockerfilePath: validation.data.dockerfile_path,
      healthCheckPath: validation.data.health_check_path,
      autoDeploy: validation.data.auto_deploy,
    });
    successResponse(res, container, 201);
  } catch (error) {
    next(error);
  }
});

router.get('/', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';
    const service = ComputeService.getInstance();
    const containers = await service.getContainers(projectId);
    successResponse(res, containers);
  } catch (error) {
    next(error);
  }
});

router.get('/:id', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const service = ComputeService.getInstance();
    const container = await service.getContainer(req.params.id);
    if (!container) throw new AppError('Container not found', 404, 'NOT_FOUND');
    successResponse(res, container);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const validation = updateContainerSchema.safeParse(req.body);
    if (!validation.success) {
      throw new AppError(
        validation.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        400,
        'INVALID_INPUT'
      );
    }
    const service = ComputeService.getInstance();
    const container = await service.updateContainer(req.params.id, validation.data);
    successResponse(res, container);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const service = ComputeService.getInstance();
    await service.deleteContainer(req.params.id);
    successResponse(res, { deleted: true });
  } catch (error) {
    next(error);
  }
});

// Deployments
router.post('/:id/deploy', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const validation = deployContainerSchema.safeParse(req.body || {});
    const triggeredBy = validation.success ? validation.data.triggered_by : 'manual';
    const service = ComputeService.getInstance();
    const deployment = await service.deploy(req.params.id, triggeredBy);
    successResponse(res, deployment, 202);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/deployments', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const service = ComputeService.getInstance();
    const deployments = await service.getDeployments(req.params.id);
    successResponse(res, deployments);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/deployments/:did', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const service = ComputeService.getInstance();
    const deployment = await service.getDeployment(req.params.did);
    if (!deployment) throw new AppError('Deployment not found', 404, 'NOT_FOUND');
    successResponse(res, deployment);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/rollback/:did', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const service = ComputeService.getInstance();
    const deployment = await service.rollback(req.params.id, req.params.did);
    successResponse(res, deployment, 202);
  } catch (error) {
    next(error);
  }
});

// Logs
router.get('/:id/logs', verifyAdmin, async (req: AuthRequest, res, next) => {
  try {
    const service = ComputeService.getInstance();
    const logs = await service.getContainerLogs(req.params.id, {
      limit: Number(req.query.limit) || 100,
      startTime: req.query.start_time ? Number(req.query.start_time) : undefined,
      nextToken: req.query.next_token as string | undefined,
    });
    successResponse(res, logs);
  } catch (error) {
    next(error);
  }
});

export { router as computeRouter };
```

- [ ] **Step 2: Mount the router in server.ts**

Add to `backend/src/server.ts`:

Import (add after other router imports around line 22):
```typescript
import { computeRouter } from '@/api/routes/compute/index.routes.js';
```

Mount (add after `apiRouter.use('/schedules', schedulesRouter);` at line 192):
```typescript
apiRouter.use('/compute/containers', computeRouter);
```

- [ ] **Step 3: Initialize ComputeService in server startup**

Add to `backend/src/server.ts` in the `createApp()` function, after log service initialization (around line 62):
```typescript
// Initialize compute service
const computeService = ComputeService.getInstance();
await computeService.initialize();
```

And add the import:
```typescript
import { ComputeService } from '@/services/compute/compute.service.js';
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npx tsc --noEmit --project backend/tsconfig.json`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/api/routes/compute/ backend/src/server.ts
git commit -m "feat(compute): add backend API routes and mount in server"
```

---

## Task 8: Frontend — API Service & Hooks

**Files:**
- Create: `frontend/src/features/compute/services/compute.service.ts`
- Create: `frontend/src/features/compute/hooks/useCompute.ts`

- [ ] **Step 1: Write the frontend API service**

Create `frontend/src/features/compute/services/compute.service.ts`:

```typescript
import { apiClient } from '@/lib/api/client';
import type { ContainerSchema, DeploymentSchema } from '@insforge/shared-schemas';

export const computeService = {
  async listContainers(projectId: string = 'default'): Promise<ContainerSchema[]> {
    return apiClient.request(`/compute/containers?project_id=${projectId}`, {
      headers: apiClient.withAccessToken(),
    });
  },

  async getContainer(id: string): Promise<ContainerSchema> {
    return apiClient.request(`/compute/containers/${id}`, {
      headers: apiClient.withAccessToken(),
    });
  },

  async createContainer(data: Record<string, unknown>): Promise<ContainerSchema> {
    return apiClient.request('/compute/containers', {
      method: 'POST',
      headers: { ...apiClient.withAccessToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async updateContainer(id: string, data: Record<string, unknown>): Promise<ContainerSchema> {
    return apiClient.request(`/compute/containers/${id}`, {
      method: 'PATCH',
      headers: { ...apiClient.withAccessToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  },

  async deleteContainer(id: string): Promise<void> {
    return apiClient.request(`/compute/containers/${id}`, {
      method: 'DELETE',
      headers: apiClient.withAccessToken(),
    });
  },

  async deploy(containerId: string): Promise<DeploymentSchema> {
    return apiClient.request(`/compute/containers/${containerId}/deploy`, {
      method: 'POST',
      headers: { ...apiClient.withAccessToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ triggered_by: 'manual' }),
    });
  },

  async listDeployments(containerId: string): Promise<DeploymentSchema[]> {
    return apiClient.request(`/compute/containers/${containerId}/deployments`, {
      headers: apiClient.withAccessToken(),
    });
  },

  async rollback(containerId: string, deploymentId: string): Promise<DeploymentSchema> {
    return apiClient.request(`/compute/containers/${containerId}/rollback/${deploymentId}`, {
      method: 'POST',
      headers: apiClient.withAccessToken(),
    });
  },

  async getLogs(containerId: string, limit = 100): Promise<{ events: Array<{ timestamp: string; message: string }> }> {
    return apiClient.request(`/compute/containers/${containerId}/logs?limit=${limit}`, {
      headers: apiClient.withAccessToken(),
    });
  },
};
```

- [ ] **Step 2: Write the React Query hook**

Create `frontend/src/features/compute/hooks/useCompute.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { computeService } from '../services/compute.service';
import { useToast } from '@/lib/hooks/useToast';
import type { ContainerSchema } from '@insforge/shared-schemas';
import { useState } from 'react';

export function useCompute() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [selectedContainer, setSelectedContainer] = useState<ContainerSchema | null>(null);

  // Queries
  const {
    data: containers = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['compute', 'containers'],
    queryFn: () => computeService.listContainers(),
  });

  const {
    data: deployments = [],
    isLoading: isLoadingDeployments,
  } = useQuery({
    queryKey: ['compute', 'deployments', selectedContainer?.id],
    queryFn: () => computeService.listDeployments(selectedContainer!.id),
    enabled: !!selectedContainer,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => computeService.createContainer(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Container created', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) =>
      computeService.updateContainer(id, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Container updated', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => computeService.deleteContainer(id),
    onSuccess: () => {
      setSelectedContainer(null);
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Container deleted', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const deployMutation = useMutation({
    mutationFn: (containerId: string) => computeService.deploy(containerId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Deployment started', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ containerId, deploymentId }: { containerId: string; deploymentId: string }) =>
      computeService.rollback(containerId, deploymentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compute'] });
      showToast('Rollback started', 'success');
    },
    onError: (error: Error) => showToast(error.message, 'error'),
  });

  return {
    containers,
    isLoading,
    refetch,
    selectedContainer,
    setSelectedContainer,
    deployments,
    isLoadingDeployments,
    createContainer: createMutation.mutate,
    updateContainer: updateMutation.mutate,
    deleteContainer: deleteMutation.mutate,
    deploy: deployMutation.mutate,
    rollback: rollbackMutation.mutate,
    isCreating: createMutation.isPending,
    isDeploying: deployMutation.isPending,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/compute/services/ frontend/src/features/compute/hooks/
git commit -m "feat(compute): add frontend API service and React Query hooks"
```

---

## Task 9: Frontend — Compute Page & Components

**Files:**
- Create: `frontend/src/features/compute/pages/ComputePage.tsx`
- Create: `frontend/src/features/compute/components/ContainerCard.tsx`
- Create: `frontend/src/features/compute/components/DeployModal.tsx`
- Create: `frontend/src/features/compute/components/ContainerDetail.tsx`
- Create: `frontend/src/features/compute/components/EnvVarsTab.tsx`
- Create: `frontend/src/features/compute/components/DeploymentsTab.tsx`

- [ ] **Step 1: Create ComputePage**

Create `frontend/src/features/compute/pages/ComputePage.tsx`:

```typescript
import { useState } from 'react';
import { useCompute } from '../hooks/useCompute';
import { ContainerCard } from '../components/ContainerCard';
import { ContainerDetail } from '../components/ContainerDetail';
import { DeployModal } from '../components/DeployModal';
import { Button, Skeleton } from '@insforge/ui';
import { Plus } from 'lucide-react';

export default function ComputePage() {
  const [showDeployModal, setShowDeployModal] = useState(false);
  const {
    containers,
    isLoading,
    selectedContainer,
    setSelectedContainer,
    deployments,
    isLoadingDeployments,
    createContainer,
    updateContainer,
    deleteContainer,
    deploy,
    rollback,
    isCreating,
    isDeploying,
  } = useCompute();

  if (selectedContainer) {
    return (
      <ContainerDetail
        container={selectedContainer}
        deployments={deployments}
        isLoadingDeployments={isLoadingDeployments}
        onBack={() => setSelectedContainer(null)}
        onDeploy={() => deploy(selectedContainer.id)}
        onDelete={() => deleteContainer(selectedContainer.id)}
        onUpdate={(data) => updateContainer({ id: selectedContainer.id, data })}
        onRollback={(deploymentId) => rollback({ containerId: selectedContainer.id, deploymentId })}
        isDeploying={isDeploying}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold">Compute</h1>
        <Button onClick={() => setShowDeployModal(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" />
          Deploy
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : containers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-muted-foreground mb-4">
              No containers deployed yet. Deploy your first container to get started.
            </p>
            <Button onClick={() => setShowDeployModal(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Deploy Container
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {containers.map((container) => (
              <ContainerCard
                key={container.id}
                container={container}
                onClick={() => setSelectedContainer(container)}
              />
            ))}
          </div>
        )}
      </div>

      {showDeployModal && (
        <DeployModal
          onClose={() => setShowDeployModal(false)}
          onCreate={createContainer}
          isCreating={isCreating}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ContainerCard**

Create `frontend/src/features/compute/components/ContainerCard.tsx`:

```typescript
import type { ContainerSchema } from '@insforge/shared-schemas';
import { ExternalLink } from 'lucide-react';

const statusColors: Record<string, string> = {
  running: 'bg-green-500',
  building: 'bg-yellow-500',
  deploying: 'bg-blue-500',
  pending: 'bg-gray-400',
  stopped: 'bg-gray-500',
  failed: 'bg-red-500',
};

interface ContainerCardProps {
  container: ContainerSchema;
  onClick: () => void;
}

export function ContainerCard({ container, onClick }: ContainerCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 border border-border rounded-lg hover:bg-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColors[container.status] || 'bg-gray-400'}`} />
          <div>
            <p className="font-medium">{container.name}</p>
            <p className="text-sm text-muted-foreground">
              {container.source_type === 'github'
                ? `${container.github_repo} (${container.github_branch})`
                : container.image_url}
            </p>
          </div>
        </div>
        {container.endpoint_url && (
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate max-w-[250px]">{container.endpoint_url}</span>
            <ExternalLink className="w-3 h-3" />
          </div>
        )}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span>{container.cpu / 1024} vCPU</span>
        <span>{container.memory} MB</span>
        {container.last_deployed_at && (
          <span>Deployed {new Date(container.last_deployed_at).toLocaleDateString()}</span>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Create DeployModal**

Create `frontend/src/features/compute/components/DeployModal.tsx`:

```typescript
import { useState } from 'react';
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@insforge/ui';
import { X } from 'lucide-react';

interface DeployModalProps {
  onClose: () => void;
  onCreate: (data: Record<string, unknown>) => void;
  isCreating: boolean;
}

export function DeployModal({ onClose, onCreate, isCreating }: DeployModalProps) {
  const [sourceType, setSourceType] = useState<'github' | 'image'>('github');
  const [form, setForm] = useState({
    name: 'default',
    github_repo: '',
    github_branch: 'main',
    image_url: '',
    dockerfile_path: './Dockerfile',
    port: 8080,
    health_check_path: '/health',
    cpu: 256,
    memory: 512,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      ...form,
      source_type: sourceType,
      auto_deploy: true,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border border-border rounded-lg w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Deploy a Container</h2>
          <button onClick={onClose}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Source</Label>
            <div className="flex gap-2 mt-1">
              <Button
                type="button"
                variant={sourceType === 'github' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSourceType('github')}
              >
                GitHub Repo
              </Button>
              <Button
                type="button"
                variant={sourceType === 'image' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSourceType('image')}
              >
                Image URL
              </Button>
            </div>
          </div>

          {sourceType === 'github' ? (
            <>
              <div>
                <Label htmlFor="repo">Repository</Label>
                <Input
                  id="repo"
                  placeholder="user/repo"
                  value={form.github_repo}
                  onChange={(e) => setForm({ ...form, github_repo: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="branch">Branch</Label>
                <Input
                  id="branch"
                  value={form.github_branch}
                  onChange={(e) => setForm({ ...form, github_branch: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label htmlFor="dockerfile">Dockerfile path</Label>
                <Input
                  id="dockerfile"
                  value={form.dockerfile_path}
                  onChange={(e) => setForm({ ...form, dockerfile_path: e.target.value })}
                  placeholder="./Dockerfile (leave empty for auto-detect)"
                />
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="image">Image URL</Label>
              <Input
                id="image"
                placeholder="docker.io/user/app:latest"
                value={form.image_url}
                onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                required
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label htmlFor="health">Health check path</Label>
              <Input
                id="health"
                value={form.health_check_path}
                onChange={(e) => setForm({ ...form, health_check_path: e.target.value })}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating ? 'Deploying...' : 'Deploy'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create ContainerDetail with tabs**

Create `frontend/src/features/compute/components/ContainerDetail.tsx`:

```typescript
import { useState } from 'react';
import { Button } from '@insforge/ui';
import { ArrowLeft, ExternalLink, RotateCcw, Square, Trash2 } from 'lucide-react';
import { EnvVarsTab } from './EnvVarsTab';
import { DeploymentsTab } from './DeploymentsTab';
import type { ContainerSchema, DeploymentSchema } from '@insforge/shared-schemas';

type Tab = 'overview' | 'env-vars' | 'deployments';

const statusColors: Record<string, string> = {
  running: 'text-green-500',
  building: 'text-yellow-500',
  deploying: 'text-blue-500',
  pending: 'text-gray-400',
  stopped: 'text-gray-500',
  failed: 'text-red-500',
};

interface Props {
  container: ContainerSchema;
  deployments: DeploymentSchema[];
  isLoadingDeployments: boolean;
  onBack: () => void;
  onDeploy: () => void;
  onDelete: () => void;
  onUpdate: (data: Record<string, unknown>) => void;
  onRollback: (deploymentId: string) => void;
  isDeploying: boolean;
}

export function ContainerDetail({
  container, deployments, isLoadingDeployments,
  onBack, onDeploy, onDelete, onUpdate, onRollback, isDeploying,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'env-vars', label: 'Env Vars' },
    { id: 'deployments', label: 'Deployments' },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground mb-2 hover:text-foreground">
          <ArrowLeft className="w-4 h-4" /> Compute
        </button>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">{container.name}</h1>
            <span className={`text-sm capitalize ${statusColors[container.status]}`}>{container.status}</span>
          </div>
          {container.endpoint_url && (
            <a href={container.endpoint_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              {container.endpoint_url} <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 px-6 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`py-2 text-sm border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Source</h3>
              <p className="text-sm">
                {container.source_type === 'github'
                  ? `${container.github_repo} (${container.github_branch})`
                  : container.image_url}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Auto-deploy: {container.auto_deploy ? 'On' : 'Off'}
              </p>
            </section>
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Resources</h3>
              <p className="text-sm">{container.cpu / 1024} vCPU &middot; {container.memory} MB &middot; Port {container.port}</p>
              <p className="text-xs text-muted-foreground mt-1">Health: {container.health_check_path}</p>
            </section>
            <section>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Actions</h3>
              <div className="flex gap-2">
                <Button size="sm" onClick={onDeploy} disabled={isDeploying}>
                  <RotateCcw className="w-3 h-3 mr-1" />
                  {isDeploying ? 'Deploying...' : 'Redeploy'}
                </Button>
                <Button size="sm" variant="destructive" onClick={onDelete}>
                  <Trash2 className="w-3 h-3 mr-1" /> Delete
                </Button>
              </div>
            </section>
          </div>
        )}
        {activeTab === 'env-vars' && (
          <EnvVarsTab container={container} onUpdate={onUpdate} />
        )}
        {activeTab === 'deployments' && (
          <DeploymentsTab
            deployments={deployments}
            isLoading={isLoadingDeployments}
            onRollback={onRollback}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Create EnvVarsTab**

Create `frontend/src/features/compute/components/EnvVarsTab.tsx`:

```typescript
import { useState } from 'react';
import { Button, Input, Label } from '@insforge/ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ContainerSchema } from '@insforge/shared-schemas';

interface Props {
  container: ContainerSchema;
  onUpdate: (data: Record<string, unknown>) => void;
}

export function EnvVarsTab({ container, onUpdate }: Props) {
  const [vars, setVars] = useState<Array<{ key: string; value: string }>>([]);
  const [hasChanges, setHasChanges] = useState(false);

  const autoInjected = [
    { key: 'INSFORGE_DB_URL', value: '••••••••••' },
    { key: 'INSFORGE_BASE_URL', value: '••••••••••' },
    { key: 'INSFORGE_ANON_KEY', value: '••••••••••' },
    { key: 'PORT', value: String(container.port) },
  ];

  const addVar = () => {
    setVars([...vars, { key: '', value: '' }]);
    setHasChanges(true);
  };

  const removeVar = (index: number) => {
    setVars(vars.filter((_, i) => i !== index));
    setHasChanges(true);
  };

  const updateVar = (index: number, field: 'key' | 'value', val: string) => {
    const updated = [...vars];
    updated[index] = { ...updated[index], [field]: val };
    setVars(updated);
    setHasChanges(true);
  };

  const handleSave = (redeploy: boolean) => {
    const envObj: Record<string, string> = {};
    vars.forEach(({ key, value }) => {
      if (key) envObj[key] = value;
    });
    onUpdate({
      env_vars: envObj,
      ...(redeploy ? { _redeploy: true } : {}),
    });
    setHasChanges(false);
  };

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-medium text-muted-foreground mb-3">Auto-injected (read-only)</h3>
        <div className="space-y-2">
          {autoInjected.map(({ key, value }) => (
            <div key={key} className="flex gap-2">
              <Input value={key} disabled className="font-mono text-xs flex-1" />
              <Input value={value} disabled className="font-mono text-xs flex-1" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-muted-foreground">Custom</h3>
          <Button size="sm" variant="outline" onClick={addVar}>
            <Plus className="w-3 h-3 mr-1" /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {vars.map((v, i) => (
            <div key={i} className="flex gap-2">
              <Input
                placeholder="KEY"
                value={v.key}
                onChange={(e) => updateVar(i, 'key', e.target.value)}
                className="font-mono text-xs flex-1"
              />
              <Input
                placeholder="value"
                value={v.value}
                onChange={(e) => updateVar(i, 'value', e.target.value)}
                className="font-mono text-xs flex-1"
              />
              <button onClick={() => removeVar(i)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {vars.length === 0 && (
            <p className="text-sm text-muted-foreground">No custom environment variables.</p>
          )}
        </div>
      </section>

      {hasChanges && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleSave(false)}>Save</Button>
          <Button onClick={() => handleSave(true)}>Save & Redeploy</Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create DeploymentsTab**

Create `frontend/src/features/compute/components/DeploymentsTab.tsx`:

```typescript
import { Button, Skeleton } from '@insforge/ui';
import { RotateCcw } from 'lucide-react';
import type { DeploymentSchema } from '@insforge/shared-schemas';

const statusColors: Record<string, string> = {
  live: 'bg-green-500',
  building: 'bg-yellow-500',
  deploying: 'bg-blue-500',
  pending: 'bg-gray-400',
  failed: 'bg-red-500',
  pushing: 'bg-yellow-500',
};

interface Props {
  deployments: DeploymentSchema[];
  isLoading: boolean;
  onRollback: (deploymentId: string) => void;
}

export function DeploymentsTab({ deployments, isLoading, onRollback }: Props) {
  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  }

  if (deployments.length === 0) {
    return <p className="text-sm text-muted-foreground">No deployments yet.</p>;
  }

  return (
    <div className="space-y-2">
      {deployments.map((d, i) => (
        <div key={d.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${statusColors[d.status] || 'bg-gray-400'}`} />
            <div>
              <p className="text-sm font-medium">
                #{deployments.length - i}
                {d.commit_sha && <span className="ml-2 font-mono text-xs text-muted-foreground">{d.commit_sha.slice(0, 7)}</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {d.triggered_by} &middot; {new Date(d.started_at).toLocaleString()}
                {d.error_message && <span className="text-red-500 ml-2">{d.error_message}</span>}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {d.build_log_url && (
              <a href={d.build_log_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground">
                View log
              </a>
            )}
            {!d.is_active && d.status !== 'failed' && d.image_tag && (
              <Button size="sm" variant="outline" onClick={() => onRollback(d.id)}>
                <RotateCcw className="w-3 h-3 mr-1" /> Rollback
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/features/compute/
git commit -m "feat(compute): add ComputePage, ContainerCard, DeployModal, detail views"
```

---

## Task 10: Frontend — Routing & Sidebar

**Files:**
- Modify: `frontend/src/lib/utils/menuItems.ts`
- Modify: `frontend/src/lib/routing/AppRoutes.tsx`

- [ ] **Step 1: Add compute menu item to menuItems.ts**

Add `Container` import to lucide-react imports at line 1:
```typescript
import { ..., Container } from 'lucide-react';
```

Add the compute menu item. Insert after the `ai` item (line 209) and before the `logs` item:
```typescript
{
  id: 'compute',
  label: 'Compute',
  href: '/dashboard/compute',
  icon: Container,
  sectionEnd: true,
},
```

Move `sectionEnd: true` from the `ai` item to the new `compute` item (ai should no longer have `sectionEnd`).

- [ ] **Step 2: Add compute routes to AppRoutes.tsx**

Add import at the top:
```typescript
import ComputePage from '@/features/compute/pages/ComputePage';
```

Add route after the AI route (line 100):
```typescript
<Route path="/dashboard/compute" element={<ComputePage />} />
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm run build --workspace=frontend`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/utils/menuItems.ts frontend/src/lib/routing/AppRoutes.tsx
git commit -m "feat(compute): add compute to sidebar navigation and routing"
```

---

## Task 11: Integration Verification

- [ ] **Step 1: Run full TypeScript check**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npx tsc --noEmit`
Expected: No type errors across all packages.

- [ ] **Step 2: Run existing tests**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 3: Build all packages**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm run build`
Expected: All packages build successfully.

- [ ] **Step 4: Verify migration applies cleanly**

Run: `cd /Users/gary/projects/insforge-repo/InsForge && npm run migrate:up`
Expected: Migration 025 applied (or already applied).

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(compute): address integration issues from verification"
```
