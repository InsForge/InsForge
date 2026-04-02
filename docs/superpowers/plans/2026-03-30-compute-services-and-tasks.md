# Compute: Services & Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add run-to-completion Task support to the existing Compute feature (which currently only supports always-on Services), including critical bug fixes from the PR #1031 review.

**Architecture:** Both Services and Tasks share the same container table, image build pipeline, and provider abstraction. They diverge at execution: Services create ECS services with ALB routing; Tasks call ECS RunTask with no networking. A new `compute.task_runs` table tracks task execution history. Cron scheduling is handled by the existing Schedules feature, not Compute.

**Tech Stack:** TypeScript, Node.js, PostgreSQL, AWS ECS Fargate, AWS CodeBuild, AWS ECR, AWS CloudWatch, Zod, React, react-query, Vitest

**Spec:** `docs/superpowers/specs/2026-03-30-compute-services-and-tasks-design.md`

---

## File Structure

### Files to modify

| File | Responsibility |
|------|---------------|
| `backend/src/infra/database/migrations/029_create-compute-schema.sql` | Add `run_mode`, `task_definition_arn` columns, `task_runs` table, CHECK constraints, UNIQUE constraint |
| `shared-schemas/src/compute.schema.ts` | Add `ready` status, `runMode` field, `TaskRunSchema` |
| `shared-schemas/src/compute-api.schema.ts` | Add `runMode` to create schema, add task run response schemas |
| `backend/src/providers/compute/base.provider.ts` | Add `RunTaskParams`, `TaskStatus`, `runTask`, `getTaskStatus`, `stopTask` to interface |
| `backend/src/providers/compute/aws-fargate.provider.ts` | Implement `runTask`, `getTaskStatus`, `stopTask`; fix empty-string ARN fallbacks, GITHUB_TOKEN type |
| `backend/src/services/compute/compute.service.ts` | Add `runTask`, `stopTask`, `listTaskRuns`, `getTaskRun` methods; fix rollback race condition, executeDeploy error handling, deleteContainer partial teardown; split deploy flow by run_mode |
| `backend/src/api/routes/compute/index.routes.ts` | Add task routes (run, runs, stop, run logs); add project-scoping to all :id routes; add run_mode guards |
| `backend/src/types/error-constants.ts` | Add `COMPUTE_INVALID_RUN_MODE`, `COMPUTE_NOT_READY`, `COMPUTE_TASK_NOT_FOUND` |
| `frontend/src/features/compute/services/compute.service.ts` | Add `runTask`, `stopTask`, `listTaskRuns`, `getTaskRunLogs` methods |
| `frontend/src/features/compute/hooks/useCompute.ts` | Add task queries/mutations, `taskRuns` state |
| `frontend/src/features/compute/pages/ComputePage.tsx` | Add run mode badge on container cards |
| `frontend/src/features/compute/components/DeployModal.tsx` | Add `runMode` selector |
| `frontend/src/features/compute/components/ContainerDetail.tsx` | Conditional rendering for task vs service mode |

### Files to create

| File | Responsibility |
|------|---------------|
| `frontend/src/features/compute/components/TaskRunsTab.tsx` | Task execution history table with status, exit code, duration, log links |
| `backend/tests/unit/compute/compute-schemas.test.ts` | Unit tests for Zod schemas |

---

## Task 1: Fix Critical Bugs in Migration + Add Task Support Schema

**Files:**
- Modify: `backend/src/infra/database/migrations/029_create-compute-schema.sql`

- [ ] **Step 1: Read the current migration file**

Read `/Users/gary/projects/insforge-repo/worktrees/compute/backend/src/infra/database/migrations/029_create-compute-schema.sql` to confirm exact current state.

- [ ] **Step 2: Rewrite migration with fixes + task support**

Replace the full migration file content with:

```sql
-- Compute schema: containers, deployments, routes, task_runs
CREATE SCHEMA IF NOT EXISTS compute;

-- ── Containers ──
CREATE TABLE compute.containers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          TEXT NOT NULL DEFAULT 'default',
  name                TEXT NOT NULL,
  run_mode            TEXT NOT NULL DEFAULT 'service' CHECK (run_mode IN ('service', 'task')),
  source_type         TEXT NOT NULL CHECK (source_type IN ('github', 'image')),
  github_repo         TEXT,
  github_branch       TEXT DEFAULT 'main',
  dockerfile_path     TEXT DEFAULT './Dockerfile',
  image_url           TEXT,
  cpu                 INT NOT NULL DEFAULT 256 CHECK (cpu IN (256, 512, 1024, 2048, 4096)),
  memory              INT NOT NULL DEFAULT 512,
  port                INT NOT NULL DEFAULT 8080 CHECK (port BETWEEN 1 AND 65535),
  health_check_path   TEXT DEFAULT '/health',
  auto_deploy         BOOLEAN DEFAULT true,
  env_vars_encrypted  TEXT,
  status              TEXT NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'deploying', 'running', 'ready', 'failed', 'stopped', 'teardown_failed')),
  task_definition_arn TEXT,
  endpoint_url        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, name)
);

CREATE INDEX idx_compute_containers_project ON compute.containers(project_id);
CREATE INDEX idx_compute_containers_status ON compute.containers(status);

-- ── Deployments (services only) ──
CREATE TABLE compute.deployments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'building', 'pushing', 'deploying', 'live', 'failed', 'rolled_back')),
  image_uri       TEXT,
  image_tag       TEXT,
  triggered_by    TEXT NOT NULL DEFAULT 'manual',
  is_active       BOOLEAN DEFAULT false,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_compute_deployments_container ON compute.deployments(container_id);
CREATE INDEX idx_compute_deployments_active ON compute.deployments(container_id) WHERE is_active = true;
CREATE UNIQUE INDEX idx_compute_deployments_inflight
  ON compute.deployments (container_id)
  WHERE status IN ('pending', 'building', 'pushing', 'deploying');

-- ── Container Routes (services only) ──
CREATE TABLE compute.container_routes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id      UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  service_arn       TEXT,
  task_def_arn      TEXT,
  target_group_arn  TEXT,
  rule_arn          TEXT,
  endpoint_url      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (container_id)
);

-- ── Task Runs (tasks only) ──
CREATE TABLE compute.task_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  ecs_task_arn    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'stopped')),
  exit_code       INTEGER,
  triggered_by    TEXT NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual', 'api')),
  error_message   TEXT,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_runs_container ON compute.task_runs(container_id);
CREATE INDEX idx_task_runs_container_status ON compute.task_runs(container_id, status);

-- ── Triggers ──
CREATE TRIGGER update_compute_containers_updated_at
  BEFORE UPDATE ON compute.containers
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE TRIGGER update_compute_deployments_updated_at
  BEFORE UPDATE ON compute.deployments
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();

CREATE TRIGGER update_compute_container_routes_updated_at
  BEFORE UPDATE ON compute.container_routes
  FOR EACH ROW EXECUTE FUNCTION system.update_updated_at();
```

- [ ] **Step 3: Commit**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute
git add backend/src/infra/database/migrations/029_create-compute-schema.sql
git commit -m "fix(compute): add task_runs table, run_mode column, CHECK/UNIQUE constraints"
```

---

## Task 2: Update Shared Schemas

**Files:**
- Modify: `shared-schemas/src/compute.schema.ts`
- Modify: `shared-schemas/src/compute-api.schema.ts`
- Create: `backend/tests/unit/compute/compute-schemas.test.ts`

- [ ] **Step 1: Write failing tests for new schemas**

Create `backend/tests/unit/compute/compute-schemas.test.ts`:

```typescript
import { describe, test, expect } from 'vitest';
import {
  containerSchema,
  containerDeploymentSchema,
  taskRunSchema,
  containerStatusEnum,
} from '@insforge/shared-schemas/compute.schema';
import {
  createContainerSchema,
} from '@insforge/shared-schemas/compute-api.schema';

describe('containerSchema', () => {
  test('accepts runMode service', () => {
    const result = containerSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: 'proj-1',
      name: 'my-api',
      runMode: 'service',
      sourceType: 'github',
      githubRepo: 'org/repo',
      cpu: 256,
      memory: 512,
      port: 8080,
      healthCheckPath: '/health',
      status: 'created',
      createdAt: '2026-03-30T00:00:00Z',
      updatedAt: '2026-03-30T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  test('accepts runMode task', () => {
    const result = containerSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: 'proj-1',
      name: 'my-migration',
      runMode: 'task',
      sourceType: 'github',
      githubRepo: 'org/repo',
      cpu: 256,
      memory: 512,
      port: 8080,
      healthCheckPath: '/health',
      status: 'ready',
      createdAt: '2026-03-30T00:00:00Z',
      updatedAt: '2026-03-30T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid runMode', () => {
    const result = containerSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: 'proj-1',
      name: 'bad',
      runMode: 'cron',
      sourceType: 'github',
      cpu: 256,
      memory: 512,
      port: 8080,
      status: 'created',
      createdAt: '2026-03-30T00:00:00Z',
      updatedAt: '2026-03-30T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  test('accepts ready status', () => {
    const parsed = containerStatusEnum.safeParse('ready');
    expect(parsed.success).toBe(true);
  });
});

describe('taskRunSchema', () => {
  test('accepts valid task run', () => {
    const result = taskRunSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      containerId: '660e8400-e29b-41d4-a716-446655440000',
      ecsTaskArn: null,
      status: 'pending',
      exitCode: null,
      triggeredBy: 'manual',
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
      createdAt: '2026-03-30T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  test('accepts succeeded with exit code', () => {
    const result = taskRunSchema.safeParse({
      id: '550e8400-e29b-41d4-a716-446655440000',
      containerId: '660e8400-e29b-41d4-a716-446655440000',
      ecsTaskArn: 'arn:aws:ecs:us-east-1:123:task/cluster/abc',
      status: 'succeeded',
      exitCode: 0,
      triggeredBy: 'api',
      errorMessage: null,
      startedAt: '2026-03-30T00:00:00Z',
      finishedAt: '2026-03-30T00:05:00Z',
      createdAt: '2026-03-30T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('createContainerSchema', () => {
  test('defaults runMode to service', () => {
    const result = createContainerSchema.safeParse({
      name: 'my-api',
      sourceType: 'github',
      githubRepo: 'org/repo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.runMode).toBe('service');
    }
  });

  test('accepts runMode task', () => {
    const result = createContainerSchema.safeParse({
      name: 'my-job',
      sourceType: 'image',
      imageUrl: 'https://docker.io/myimage:latest',
      runMode: 'task',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute
npx vitest run backend/tests/unit/compute/compute-schemas.test.ts
```

Expected: FAIL — `taskRunSchema` not exported, `runMode` not in schemas, `ready` not in status enum.

- [ ] **Step 3: Update `shared-schemas/src/compute.schema.ts`**

Add `ready` to status enum, add `runMode` to container schema, add `TaskRunSchema`:

```typescript
// In containerStatusEnum — add 'ready' to the enum values
export const containerStatusEnum = z.enum([
  'created',
  'deploying',
  'running',
  'ready',
  'failed',
  'stopped',
  'teardown_failed',
]);

// In containerSchema — add runMode and taskDefinitionArn fields after sourceType
runMode: z.enum(['service', 'task']).default('service'),
// ... existing fields ...
taskDefinitionArn: z.string().nullable().optional(),

// New schema — add at the end of the file before exports
export const taskRunStatusEnum = z.enum([
  'pending',
  'running',
  'succeeded',
  'failed',
  'stopped',
]);

export const taskRunSchema = z.object({
  id: z.string().uuid(),
  containerId: z.string().uuid(),
  ecsTaskArn: z.string().nullable(),
  status: taskRunStatusEnum,
  exitCode: z.number().int().nullable(),
  triggeredBy: z.enum(['manual', 'api']),
  errorMessage: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

// Add type exports
export type TaskRunSchema = z.infer<typeof taskRunSchema>;
export type TaskRunStatus = z.infer<typeof taskRunStatusEnum>;
```

- [ ] **Step 4: Update `shared-schemas/src/compute-api.schema.ts`**

Add `runMode` to create schema. Add task run response schemas:

```typescript
// In createContainerSchema — add runMode field
runMode: z.enum(['service', 'task']).default('service'),

// New response schemas — add at the end before exports
export const runTaskResponseSchema = z.object({
  taskRunId: z.string().uuid(),
});

export const listTaskRunsResponseSchema = z.object({
  data: z.array(taskRunSchema),
});

// Add type exports
export type RunTaskResponse = z.infer<typeof runTaskResponseSchema>;
export type ListTaskRunsResponse = z.infer<typeof listTaskRunsResponseSchema>;
```

Import `taskRunSchema` from `./compute.schema.js` at the top of the file.

- [ ] **Step 5: Update `shared-schemas/src/index.ts`**

Ensure new exports are re-exported. Check the existing barrel file and add any missing re-exports for `taskRunSchema`, `TaskRunSchema`, `taskRunStatusEnum`, `TaskRunStatus`, `runTaskResponseSchema`, `listTaskRunsResponseSchema`.

- [ ] **Step 6: Build shared-schemas and run tests**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute/shared-schemas
npm run build
cd /Users/gary/projects/insforge-repo/worktrees/compute
npx vitest run backend/tests/unit/compute/compute-schemas.test.ts
```

Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
git add shared-schemas/src/compute.schema.ts shared-schemas/src/compute-api.schema.ts shared-schemas/src/index.ts backend/tests/unit/compute/compute-schemas.test.ts
git commit -m "feat(compute): add task run schemas, runMode field, ready status"
```

---

## Task 3: Fix Provider Bugs + Add Task Methods to Interface

**Files:**
- Modify: `backend/src/providers/compute/base.provider.ts`
- Modify: `backend/src/providers/compute/aws-fargate.provider.ts`

- [ ] **Step 1: Add task types and methods to the provider interface**

In `base.provider.ts`, add after `TeardownParams` (around line 60):

```typescript
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
```

In the `ComputeProvider` interface, add after `getLogs`:

```typescript
  /** Run a one-shot ECS task (no ALB, no service) */
  runTask(params: RunTaskParams): Promise<{ taskArn: string }>;

  /** Poll task status and exit code */
  getTaskStatus(taskArn: string): Promise<TaskStatus>;

  /** Force-stop a running task */
  stopTask(taskArn: string): Promise<void>;
```

- [ ] **Step 2: Fix GITHUB_TOKEN type mismatch in aws-fargate.provider.ts**

In `aws-fargate.provider.ts`, find the `GITHUB_TOKEN` environment override in `buildImage` (around line 58-64). Change `type: 'SECRETS_MANAGER'` to `type: 'PLAINTEXT'`:

```typescript
environmentVariablesOverride: [
  ...(params.githubToken
    ? [{ name: 'GITHUB_TOKEN', value: params.githubToken, type: 'PLAINTEXT' as const }]
    : []),
],
```

- [ ] **Step 3: Fix empty-string ARN fallbacks**

In `aws-fargate.provider.ts`, replace all `?? ''` ARN fallbacks with explicit throws. Apply to these locations:

1. `registerTaskDefinition` (around line 266) — after `RegisterTaskDefinition`:
```typescript
const taskDefArn = result.taskDefinition?.taskDefinitionArn;
if (!taskDefArn) throw new Error('Failed to register task definition: no ARN returned');
return taskDefArn;
```

2. `createRoute` target group (around line 297) — after `CreateTargetGroup`:
```typescript
const targetGroupArn = tgResult.TargetGroups?.[0]?.TargetGroupArn;
if (!targetGroupArn) throw new Error('Failed to create target group: no ARN returned');
```

3. `createRoute` rule (around line 313) — after `CreateRule`:
```typescript
const ruleArn = ruleResult.Rules?.[0]?.RuleArn;
if (!ruleArn) throw new Error('Failed to create ALB rule: no ARN returned');
```

4. `createEcsService` (around line 386) — after `CreateService`:
```typescript
const serviceArn = result.service?.serviceArn;
if (!serviceArn) throw new Error('Failed to create ECS service: no ARN returned');
return serviceArn;
```

- [ ] **Step 4: Implement `runTask` method**

Add to `AwsFargateProvider` class after `getLogs`:

```typescript
async runTask(params: RunTaskParams): Promise<{ taskArn: string }> {
  const ecsClient = new ECSClient(this.clientConfig());
  const config = computeConfig();

  const envOverrides = Object.entries(params.envVars).map(([name, value]) => ({
    name,
    value,
  }));

  const result = await ecsClient.send(
    new RunTaskCommand({
      cluster: config.ecsClusterArn,
      taskDefinition: params.taskDefinitionArn,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.subnetIds,
          securityGroups: [config.securityGroupId],
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
```

Import `RunTaskCommand` from `@aws-sdk/client-ecs` at the top of the file.

- [ ] **Step 5: Implement `getTaskStatus` method**

```typescript
async getTaskStatus(taskArn: string): Promise<TaskStatus> {
  const ecsClient = new ECSClient(this.clientConfig());
  const config = computeConfig();

  const result = await ecsClient.send(
    new DescribeTasksCommand({
      cluster: config.ecsClusterArn,
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
    status = 'running'; // PENDING, PROVISIONING, etc. are pre-running states
  }

  return {
    status,
    exitCode: container?.exitCode ?? null,
    startedAt: task.startedAt ?? null,
    stoppedAt: task.stoppedAt ?? null,
  };
}
```

Import `DescribeTasksCommand` from `@aws-sdk/client-ecs`.

- [ ] **Step 6: Implement `stopTask` method**

```typescript
async stopTask(taskArn: string): Promise<void> {
  const ecsClient = new ECSClient(this.clientConfig());
  const config = computeConfig();

  await ecsClient.send(
    new StopTaskCommand({
      cluster: config.ecsClusterArn,
      task: taskArn,
      reason: 'Stopped by user via InsForge Compute',
    }),
  );
}
```

Import `StopTaskCommand` from `@aws-sdk/client-ecs`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/providers/compute/base.provider.ts backend/src/providers/compute/aws-fargate.provider.ts
git commit -m "feat(compute): add runTask/getTaskStatus/stopTask to provider, fix ARN fallbacks and GITHUB_TOKEN type"
```

---

## Task 4: Fix Service Layer Bugs

**Files:**
- Modify: `backend/src/services/compute/compute.service.ts`

- [ ] **Step 1: Fix rollback race condition**

In `compute.service.ts`, modify the `rollback` method (around line 348-377). Pass `imageUri` directly into `deploy()` so it is written to the deployment record *before* `executeDeploy` fires:

Change the `deploy()` method signature to accept an optional `imageUri` parameter:

```typescript
async deploy(input: {
  containerId: string;
  triggeredBy?: string;
  githubToken?: string;
  imageUri?: string;  // for rollback — pre-set image
}): Promise<ContainerDeploymentSchema> {
```

In `deploy()`, when creating the deployment record (around line 320), include the imageUri if provided:

```typescript
const [deployment] = await client.query(
  `INSERT INTO compute.deployments (container_id, triggered_by, image_uri)
   VALUES ($1, $2, $3) RETURNING *`,
  [input.containerId, input.triggeredBy ?? 'manual', input.imageUri ?? null],
);
```

Then simplify `rollback()` to just call `deploy()` with the target image:

```typescript
async rollback(input: { containerId: string; deploymentId: string }): Promise<ContainerDeploymentSchema> {
  const targetDeployment = await this.getDeployment(input.deploymentId);
  if (!targetDeployment) {
    throw new AppError('Deployment not found', 404, ErrorCodes.NOT_FOUND);
  }
  if (!targetDeployment.imageUri) {
    throw new AppError('Target deployment has no image to rollback to', 400, ErrorCodes.INVALID_INPUT);
  }

  return this.deploy({
    containerId: input.containerId,
    triggeredBy: 'rollback',
    imageUri: targetDeployment.imageUri,
  });
}
```

In `executeDeploy`, update the image resolution logic (around line 412-415) to use the deployment's `imageUri` if already set (from rollback):

```typescript
let imageUri = deployment.imageUri ?? '';

if (!imageUri) {
  // Build from source
  // ... existing build logic ...
}
```

This already works because `deployment.imageUri` is now set in the DB record before `executeDeploy` fires.

- [ ] **Step 2: Fix executeDeploy catch block — wrap secondary DB calls**

In the `catch` block of `executeDeploy` (around lines 517-531), wrap the status-update calls in an inner try/catch:

```typescript
} catch (err) {
  const errorMessage = (err as Error).message;
  try {
    await this.setDeploymentStatus(deployment.id, 'failed', errorMessage);
    const current = await this.getContainer(container.id);
    if (current && current.status === 'deploying') {
      await this.setContainerStatus(container.id, 'failed');
    }
  } catch (innerErr) {
    console.error(`[ComputeService] Failed to update status after deploy error:`, innerErr);
  }
  console.error(`[ComputeService] Deploy failed for container ${container.id}:`, err);
}
```

- [ ] **Step 3: Fix deleteContainer partial teardown**

In `deleteContainer` (around lines 222-259), restructure to handle the case where teardown succeeds but DB delete fails:

```typescript
async deleteContainer(id: string): Promise<void> {
  const pool = this.getPool();
  const container = await this.getContainer(id);
  if (!container) throw new AppError('Container not found', 404, ErrorCodes.NOT_FOUND);

  // For services: tear down cloud resources first
  if (container.runMode === 'service' || !container.runMode) {
    const [route] = await pool.query(
      'SELECT * FROM compute.container_routes WHERE container_id = $1',
      [id],
    );

    if (route?.service_arn && this.provider.isConfigured()) {
      try {
        await this.provider.teardown({
          serviceArn: route.service_arn,
          targetGroupArn: route.target_group_arn,
          ruleArn: route.rule_arn,
        });
      } catch (err) {
        await this.setContainerStatus(id, 'teardown_failed');
        throw new AppError(
          `Teardown failed: ${(err as Error).message}`,
          500,
          ErrorCodes.COMPUTE_TEARDOWN_FAILED,
        );
      }
    }
  }

  // For tasks: stop any running tasks
  if (container.runMode === 'task') {
    const runningTasks = await pool.query(
      `SELECT ecs_task_arn FROM compute.task_runs
       WHERE container_id = $1 AND status IN ('pending', 'running')`,
      [id],
    );
    for (const row of runningTasks) {
      if (row.ecs_task_arn && this.provider.isConfigured()) {
        try {
          await this.provider.stopTask(row.ecs_task_arn);
        } catch (err) {
          console.warn(`[ComputeService] Failed to stop task ${row.ecs_task_arn}:`, err);
        }
      }
    }
  }

  // Delete DB rows (cascades to deployments, routes, task_runs)
  await pool.query('DELETE FROM compute.containers WHERE id = $1', [id]);
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/compute/compute.service.ts
git commit -m "fix(compute): fix rollback race, executeDeploy error handling, deleteContainer teardown"
```

---

## Task 5: Add Task Support to Service Layer

**Files:**
- Modify: `backend/src/services/compute/compute.service.ts`
- Modify: `backend/src/types/error-constants.ts`

- [ ] **Step 1: Add error constants**

In `error-constants.ts`, add after the existing COMPUTE codes:

```typescript
COMPUTE_INVALID_RUN_MODE = 'COMPUTE_INVALID_RUN_MODE',
COMPUTE_NOT_READY = 'COMPUTE_NOT_READY',
COMPUTE_TASK_NOT_FOUND = 'COMPUTE_TASK_NOT_FOUND',
```

- [ ] **Step 2: Add TaskRunRow interface and mapper**

In `compute.service.ts`, add after the existing `RouteRow` interface:

```typescript
interface TaskRunRow {
  id: string;
  container_id: string;
  ecs_task_arn: string | null;
  status: string;
  exit_code: number | null;
  triggered_by: string;
  error_message: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

function mapTaskRunRow(row: TaskRunRow): TaskRunSchema {
  return {
    id: row.id,
    containerId: row.container_id,
    ecsTaskArn: row.ecs_task_arn,
    status: row.status as TaskRunStatus,
    exitCode: row.exit_code,
    triggeredBy: row.triggered_by as 'manual' | 'api',
    errorMessage: row.error_message,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}
```

Import `TaskRunSchema` and `TaskRunStatus` from the shared schemas package.

- [ ] **Step 3: Update deploy flow to handle task run_mode**

In `executeDeploy`, after the image is built and task definition is registered, add a branch for task containers. After the task definition registration (around line 455), add:

```typescript
// Task containers: just store the task definition ARN and mark ready
if (container.runMode === 'task') {
  const taskDefArn = /* the task definition ARN from registerTaskDefinition */;
  await client.query(
    'UPDATE compute.containers SET task_definition_arn = $1, status = $2 WHERE id = $3',
    [taskDefArn, 'ready', container.id],
  );
  await this.setDeploymentStatus(deployment.id, 'live');
  return;
}

// Service containers: continue with provision/updateService as before
```

This requires refactoring `executeDeploy` so the task definition ARN is available before the service/task branch. The current code calls `provision()` which internally registers the task def. For tasks, we need to register the task def separately, then skip `provision()`.

Extract the task definition registration from the flow:
1. Build image (if needed) → get `imageUri`
2. Register task definition → get `taskDefArn`
3. If task: store `taskDefArn`, mark `ready`, done
4. If service (first deploy): `provision()` with the `taskDefArn`
5. If service (redeploy): `updateService()` with new `taskDefArn`

Note: The current `provision()` method in the provider internally calls `registerTaskDefinition`. For the task flow, we need to call `registerTaskDefinition` directly. Since it's a private method on `AwsFargateProvider`, either make it accessible through the interface or add a `registerTaskDefinition` method to `ComputeProvider`. The simpler approach: add `registerTaskDefinition(params): Promise<string>` to the `ComputeProvider` interface in `base.provider.ts`, and make the existing private method public in `aws-fargate.provider.ts`.

Add to `ComputeProvider` interface in `base.provider.ts`:

```typescript
/** Register a task definition without creating a service */
registerTaskDefinition(params: {
  containerId: string;
  imageUri: string;
  port: number;
  cpu: number;
  memory: number;
  envVars: Record<string, string>;
}): Promise<string>; // returns taskDefArn
```

Make `registerTaskDefinition` public in `aws-fargate.provider.ts` (change `private` to `public` at line 213).

- [ ] **Step 4: Add `runTask` method to ComputeService**

```typescript
async runTask(containerId: string, triggeredBy: 'manual' | 'api' = 'manual'): Promise<TaskRunSchema> {
  const pool = this.getPool();
  const container = await this.getContainer(containerId);
  if (!container) throw new AppError('Container not found', 404, ErrorCodes.NOT_FOUND);
  if (container.runMode !== 'task') {
    throw new AppError('Only task containers can be run', 400, ErrorCodes.COMPUTE_INVALID_RUN_MODE);
  }
  if (container.status !== 'ready') {
    throw new AppError('Container must be deployed before running. Call deploy first.', 400, ErrorCodes.COMPUTE_NOT_READY);
  }
  if (!container.taskDefinitionArn) {
    throw new AppError('No task definition registered. Deploy the container first.', 400, ErrorCodes.COMPUTE_NOT_READY);
  }

  // Create task run record
  const [row] = await pool.query(
    `INSERT INTO compute.task_runs (container_id, triggered_by)
     VALUES ($1, $2) RETURNING *`,
    [containerId, triggeredBy],
  );
  const taskRun = mapTaskRunRow(row as TaskRunRow);

  // Fire and forget: execute the task in background
  void this.executeTaskRun(container, taskRun);

  return taskRun;
}

private async executeTaskRun(container: ContainerSchema, taskRun: TaskRunSchema): Promise<void> {
  const pool = this.getPool();
  try {
    const envVars = await this.getDecryptedEnvVars(container.id);

    const { taskArn } = await this.provider.runTask({
      containerId: container.id,
      taskDefinitionArn: container.taskDefinitionArn!,
      envVars,
      cpu: container.cpu,
      memory: container.memory,
    });

    // Update with task ARN and running status
    await pool.query(
      `UPDATE compute.task_runs SET ecs_task_arn = $1, status = 'running', started_at = NOW()
       WHERE id = $2`,
      [taskArn, taskRun.id],
    );

    // Poll for completion
    await this.pollTaskCompletion(taskRun.id, taskArn);
  } catch (err) {
    try {
      await pool.query(
        `UPDATE compute.task_runs SET status = 'failed', error_message = $1, finished_at = NOW()
         WHERE id = $2`,
        [(err as Error).message, taskRun.id],
      );
    } catch (innerErr) {
      console.error(`[ComputeService] Failed to update task run status:`, innerErr);
    }
    console.error(`[ComputeService] Task run failed for container ${container.id}:`, err);
  }
}

private async pollTaskCompletion(taskRunId: string, taskArn: string): Promise<void> {
  const pool = this.getPool();
  const MAX_POLLS = 360; // 30 minutes at 5s intervals
  const POLL_INTERVAL = 5000;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));

    const taskStatus = await this.provider.getTaskStatus(taskArn);

    if (taskStatus.status === 'running') continue;

    // Task completed
    await pool.query(
      `UPDATE compute.task_runs
       SET status = $1, exit_code = $2, finished_at = NOW()
       WHERE id = $3`,
      [taskStatus.status, taskStatus.exitCode, taskRunId],
    );
    return;
  }

  // Timeout
  await pool.query(
    `UPDATE compute.task_runs SET status = 'failed', error_message = 'Task timed out after 30 minutes', finished_at = NOW()
     WHERE id = $1`,
    [taskRunId],
  );
}
```

- [ ] **Step 5: Add `stopTask`, `listTaskRuns`, `getTaskRun` methods**

```typescript
async stopTask(taskRunId: string): Promise<void> {
  const pool = this.getPool();
  const [row] = await pool.query('SELECT * FROM compute.task_runs WHERE id = $1', [taskRunId]);
  if (!row) throw new AppError('Task run not found', 404, ErrorCodes.COMPUTE_TASK_NOT_FOUND);
  const taskRun = row as TaskRunRow;

  if (!['pending', 'running'].includes(taskRun.status)) {
    throw new AppError('Task is not running', 400, ErrorCodes.INVALID_INPUT);
  }

  if (taskRun.ecs_task_arn && this.provider.isConfigured()) {
    await this.provider.stopTask(taskRun.ecs_task_arn);
  }

  await pool.query(
    `UPDATE compute.task_runs SET status = 'stopped', finished_at = NOW() WHERE id = $1`,
    [taskRunId],
  );
}

async listTaskRuns(containerId: string): Promise<TaskRunSchema[]> {
  const pool = this.getPool();
  const rows = await pool.query(
    'SELECT * FROM compute.task_runs WHERE container_id = $1 ORDER BY created_at DESC LIMIT 100',
    [containerId],
  );
  return rows.map((r: TaskRunRow) => mapTaskRunRow(r));
}

async getTaskRun(taskRunId: string): Promise<TaskRunSchema | null> {
  const pool = this.getPool();
  const [row] = await pool.query('SELECT * FROM compute.task_runs WHERE id = $1', [taskRunId]);
  if (!row) return null;
  return mapTaskRunRow(row as TaskRunRow);
}
```

- [ ] **Step 6: Update `createContainer` to accept `runMode`**

In the `createContainer` method, add `run_mode` to the INSERT:

```typescript
async createContainer(input: {
  projectId: string;
  name: string;
  runMode?: string;  // add this
  sourceType: string;
  // ... existing fields ...
}): Promise<ContainerSchema> {
  const pool = this.getPool();
  // ... existing encryption logic ...

  const [row] = await pool.query(
    `INSERT INTO compute.containers
     (project_id, name, run_mode, source_type, github_repo, github_branch, dockerfile_path, image_url,
      cpu, memory, port, health_check_path, auto_deploy, env_vars_encrypted)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.projectId,
      input.name,
      input.runMode ?? 'service',  // add this
      input.sourceType,
      // ... rest of existing params ...
    ],
  );
  return mapContainerRow(row as ContainerRow);
}
```

Also update `ContainerRow` interface and `mapContainerRow` to include `run_mode` and `task_definition_arn`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/compute/compute.service.ts backend/src/types/error-constants.ts backend/src/providers/compute/base.provider.ts backend/src/providers/compute/aws-fargate.provider.ts
git commit -m "feat(compute): add task execution support to service layer"
```

---

## Task 6: Add Task Routes + Fix Route Security

**Files:**
- Modify: `backend/src/api/routes/compute/index.routes.ts`

- [ ] **Step 1: Add project-scoping helper**

Add a helper function at the top of the file (after imports) that verifies a container belongs to the caller's project:

```typescript
async function getContainerForProject(
  id: string,
  projectId: string,
  service: ComputeService,
): Promise<ContainerSchema> {
  const container = await service.getContainer(id);
  if (!container || container.projectId !== projectId) {
    throw new AppError('Container not found', 404, ErrorCodes.NOT_FOUND);
  }
  return container;
}
```

- [ ] **Step 2: Add project-scoping to all existing `:id` routes**

For every route that uses `req.params.id`, replace the direct `service.getContainer(id)` call with `getContainerForProject(id, projectId, service)`. The `projectId` should come from the authenticated request context (check how other routes in the codebase derive project ID — likely from `req.query.project_id` or auth token).

Apply to: GET /:id, PATCH /:id, DELETE /:id, POST /:id/deploy, POST /:id/rollback, GET /:id/deployments, GET /:id/logs.

- [ ] **Step 3: Add run_mode guards to existing routes**

Add guards to routes that are mode-specific:

For `POST /:id/rollback`:
```typescript
const container = await getContainerForProject(req.params.id, projectId, service);
if (container.runMode === 'task') {
  return res.status(400).json({ error: 'Rollback is not available for task containers' });
}
```

For `GET /:id/deployments`:
```typescript
const container = await getContainerForProject(req.params.id, projectId, service);
if (container.runMode === 'task') {
  return res.status(400).json({ error: 'Use /runs endpoint for task containers' });
}
```

- [ ] **Step 4: Add `POST /:id/run` route**

```typescript
router.post('/containers/:id/run', verifyAdmin, async (req, res) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';
    const container = await getContainerForProject(req.params.id, projectId, service);

    if (container.runMode !== 'task') {
      return res.status(400).json({ error: 'Only task containers can be run. Use /deploy for services.' });
    }

    const triggeredBy = (req.body?.triggeredBy as 'manual' | 'api') || 'manual';
    const taskRun = await service.runTask(container.id, triggeredBy);

    auditService.log('compute.task.run', { containerId: container.id, taskRunId: taskRun.id });
    broadcastUpdate(req);

    return res.status(202).json(successResponse({ taskRun }));
  } catch (err) {
    // ... standard error handling ...
  }
});
```

- [ ] **Step 5: Add `GET /:id/runs` route**

```typescript
router.get('/containers/:id/runs', verifyAdmin, async (req, res) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';
    const container = await getContainerForProject(req.params.id, projectId, service);

    if (container.runMode !== 'task') {
      return res.status(400).json({ error: 'Use /deployments endpoint for service containers' });
    }

    const taskRuns = await service.listTaskRuns(container.id);
    return res.status(200).json(successResponse({ data: taskRuns }));
  } catch (err) {
    // ... standard error handling ...
  }
});
```

- [ ] **Step 6: Add `GET /:id/runs/:runId`, `POST /:id/runs/:runId/stop`, `GET /:id/runs/:runId/logs` routes**

```typescript
router.get('/containers/:id/runs/:runId', verifyAdmin, async (req, res) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';
    await getContainerForProject(req.params.id, projectId, service);

    const taskRun = await service.getTaskRun(req.params.runId);
    if (!taskRun || taskRun.containerId !== req.params.id) {
      return res.status(404).json({ error: 'Task run not found' });
    }

    return res.status(200).json(successResponse(taskRun));
  } catch (err) {
    // ... standard error handling ...
  }
});

router.post('/containers/:id/runs/:runId/stop', verifyAdmin, async (req, res) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';
    await getContainerForProject(req.params.id, projectId, service);

    await service.stopTask(req.params.runId);

    auditService.log('compute.task.stop', { containerId: req.params.id, taskRunId: req.params.runId });
    broadcastUpdate(req);

    return res.status(200).json(successResponse({ stopped: true }));
  } catch (err) {
    // ... standard error handling ...
  }
});

router.get('/containers/:id/runs/:runId/logs', verifyAdmin, async (req, res) => {
  try {
    const projectId = (req.query.project_id as string) || 'default';
    await getContainerForProject(req.params.id, projectId, service);

    const taskRun = await service.getTaskRun(req.params.runId);
    if (!taskRun || taskRun.containerId !== req.params.id) {
      return res.status(404).json({ error: 'Task run not found' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const nextToken = req.query.nextToken as string | undefined;

    // Use the container's log group, filter by task ARN log stream
    const logs = await service.getContainerLogs(req.params.id, {
      limit: limit && !isNaN(limit) ? Math.min(limit, 10000) : undefined,
      nextToken,
      logStreamPrefix: taskRun.ecsTaskArn?.split('/').pop(), // ECS task ID
    });

    return res.status(200).json(successResponse(logs));
  } catch (err) {
    // ... standard error handling ...
  }
});
```

Note: The `logStreamPrefix` parameter needs to be added to the `getLogs` options in the provider. Update `ComputeProvider.getLogs` signature in `base.provider.ts` to accept `logStreamPrefix?: string` in options, and update `AwsFargateProvider.getLogs` to use it as a `logStreamNamePrefix` filter when calling `FilterLogEvents`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/api/routes/compute/index.routes.ts backend/src/providers/compute/base.provider.ts backend/src/providers/compute/aws-fargate.provider.ts
git commit -m "feat(compute): add task routes, project-scoping, run_mode guards"
```

---

## Task 7: Frontend — API Service + Hook Updates

**Files:**
- Modify: `frontend/src/features/compute/services/compute.service.ts`
- Modify: `frontend/src/features/compute/hooks/useCompute.ts`

- [ ] **Step 1: Add task methods to frontend API service**

In `compute.service.ts`, add after existing methods:

```typescript
async runTask(containerId: string, triggeredBy: string = 'manual'): Promise<TaskRunSchema> {
  const response = await fetch(`${this.baseUrl}/compute/containers/${containerId}/run`, {
    method: 'POST',
    headers: this.headers(),
    body: JSON.stringify({ triggeredBy }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Failed to run task');
  return json.data.taskRun;
}

async stopTask(containerId: string, taskRunId: string): Promise<void> {
  const response = await fetch(
    `${this.baseUrl}/compute/containers/${containerId}/runs/${taskRunId}/stop`,
    { method: 'POST', headers: this.headers() },
  );
  if (!response.ok) {
    const json = await response.json();
    throw new Error(json.error || 'Failed to stop task');
  }
}

async listTaskRuns(containerId: string): Promise<TaskRunSchema[]> {
  const response = await fetch(
    `${this.baseUrl}/compute/containers/${containerId}/runs`,
    { headers: this.headers() },
  );
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Failed to list task runs');
  return json.data.data;
}

async getTaskRunLogs(containerId: string, taskRunId: string): Promise<LogStream> {
  const response = await fetch(
    `${this.baseUrl}/compute/containers/${containerId}/runs/${taskRunId}/logs`,
    { headers: this.headers() },
  );
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Failed to get task logs');
  return json.data;
}
```

Import `TaskRunSchema` from the shared schemas package.

- [ ] **Step 2: Add task queries and mutations to useCompute hook**

Add a `taskRuns` query (enabled when `selectedContainer?.runMode === 'task'`):

```typescript
const {
  data: taskRuns = [],
  isLoading: isLoadingTaskRuns,
  error: taskRunsError,
} = useQuery({
  queryKey: ['compute', 'taskRuns', selectedContainer?.id],
  queryFn: () => computeService.listTaskRuns(selectedContainer!.id),
  enabled: !!selectedContainer && selectedContainer.runMode === 'task',
  staleTime: 15_000,
});
```

Add mutations:

```typescript
const runTaskMutation = useMutation({
  mutationFn: (containerId: string) => computeService.runTask(containerId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['compute', 'taskRuns'] });
    toast.success('Task started');
  },
  onError: (err: Error) => toast.error(err.message),
});

const stopTaskMutation = useMutation({
  mutationFn: ({ containerId, taskRunId }: { containerId: string; taskRunId: string }) =>
    computeService.stopTask(containerId, taskRunId),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['compute', 'taskRuns'] });
    toast.success('Task stopped');
  },
  onError: (err: Error) => toast.error(err.message),
});
```

Add to return object:

```typescript
taskRuns,
isLoadingTaskRuns,
taskRunsError,
isRunningTask: runTaskMutation.isPending,
runTask: useCallback((containerId: string) => runTaskMutation.mutateAsync(containerId), [runTaskMutation]),
stopTask: useCallback(
  (containerId: string, taskRunId: string) =>
    stopTaskMutation.mutateAsync({ containerId, taskRunId }),
  [stopTaskMutation],
),
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/compute/services/compute.service.ts frontend/src/features/compute/hooks/useCompute.ts
git commit -m "feat(compute): add task API service methods and hook queries"
```

---

## Task 8: Frontend — UI Components for Tasks

**Files:**
- Modify: `frontend/src/features/compute/components/DeployModal.tsx`
- Create: `frontend/src/features/compute/components/TaskRunsTab.tsx`
- Modify: `frontend/src/features/compute/components/ContainerDetail.tsx`
- Modify: `frontend/src/features/compute/pages/ComputePage.tsx`

- [ ] **Step 1: Add runMode selector to DeployModal**

In `DeployModal.tsx`, add a `runMode` state (default `'service'`) and a toggle/select control above the source type selector:

```tsx
const [runMode, setRunMode] = useState<'service' | 'task'>('service');
```

Add UI control (radio group or select):

```tsx
<div className="space-y-1">
  <label className="text-sm font-medium">Run Mode</label>
  <div className="flex gap-4">
    <label className="flex items-center gap-2">
      <input
        type="radio"
        name="runMode"
        value="service"
        checked={runMode === 'service'}
        onChange={() => setRunMode('service')}
      />
      <span className="text-sm">Service</span>
      <span className="text-xs text-muted-foreground">Always-on with public URL</span>
    </label>
    <label className="flex items-center gap-2">
      <input
        type="radio"
        name="runMode"
        value="task"
        checked={runMode === 'task'}
        onChange={() => setRunMode('task')}
      />
      <span className="text-sm">Task</span>
      <span className="text-xs text-muted-foreground">Run-to-completion</span>
    </label>
  </div>
</div>
```

Include `runMode` in the submit payload:

```typescript
const payload = {
  ...existingFields,
  runMode,
};
```

When `runMode === 'task'`, hide the `healthCheckPath` field (tasks don't need health checks).

- [ ] **Step 2: Create TaskRunsTab component**

Create `frontend/src/features/compute/components/TaskRunsTab.tsx`:

```tsx
import type { TaskRunSchema } from '@insforge/shared-schemas';

interface TaskRunsTabProps {
  taskRuns: TaskRunSchema[];
  isLoading: boolean;
  onStop: (taskRunId: string) => void;
}

export function TaskRunsTab({ taskRuns, isLoading, onStop }: TaskRunsTabProps) {
  if (isLoading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading runs...</div>;
  }

  if (taskRuns.length === 0) {
    return <div className="p-4 text-sm text-muted-foreground">No runs yet. Click "Run" to start a task.</div>;
  }

  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="p-2">Status</th>
            <th className="p-2">Exit Code</th>
            <th className="p-2">Triggered By</th>
            <th className="p-2">Started</th>
            <th className="p-2">Duration</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {taskRuns.map((run) => {
            const duration =
              run.startedAt && run.finishedAt
                ? `${Math.round((new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s`
                : run.startedAt
                  ? 'Running...'
                  : '-';

            return (
              <tr key={run.id} className="border-b">
                <td className="p-2">
                  <StatusBadge status={run.status} />
                </td>
                <td className="p-2 font-mono">
                  {run.exitCode !== null ? run.exitCode : '-'}
                </td>
                <td className="p-2">{run.triggeredBy}</td>
                <td className="p-2">
                  {run.startedAt ? new Date(run.startedAt).toLocaleString() : '-'}
                </td>
                <td className="p-2">{duration}</td>
                <td className="p-2">
                  {['pending', 'running'].includes(run.status) && (
                    <button
                      className="text-xs text-red-500 hover:underline"
                      onClick={() => onStop(run.id)}
                    >
                      Stop
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    succeeded: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    stopped: 'bg-gray-100 text-gray-800',
  };

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-gray-100'}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 3: Update ContainerDetail for task mode**

In `ContainerDetail.tsx`, update the props to include task-related callbacks and data:

```typescript
interface ContainerDetailProps {
  // ... existing props ...
  taskRuns: TaskRunSchema[];
  isLoadingTaskRuns: boolean;
  onRunTask: (containerId: string) => void;
  onStopTask: (containerId: string, taskRunId: string) => void;
}
```

Conditionally render based on `container.runMode`:

1. Hide "Open" button (endpoint URL link) when `runMode === 'task'`
2. Replace "Deploy" button with "Run" button when `runMode === 'task'`
3. Hide "Rollback" in deployments tab for tasks
4. Replace the "deployments" tab with "runs" tab when `runMode === 'task'`:

```tsx
{container.runMode === 'task' ? (
  <TaskRunsTab
    taskRuns={taskRuns}
    isLoading={isLoadingTaskRuns}
    onStop={(taskRunId) => onStopTask(container.id, taskRunId)}
  />
) : (
  <DeploymentsTab
    deployments={deployments}
    onRollback={(deploymentId) => onRollback(container.id, deploymentId)}
  />
)}
```

Import `TaskRunsTab` from `./TaskRunsTab`.

- [ ] **Step 4: Update ComputePage to show run mode badge and pass task props**

In `ComputePage.tsx`:

1. Add a run mode badge on `ContainerCard`:
```tsx
<span className="text-xs text-muted-foreground">
  {container.runMode === 'task' ? 'Task' : 'Service'}
</span>
```

2. Pass task-related props to `ContainerDetail`:
```tsx
<ContainerDetail
  // ... existing props ...
  taskRuns={taskRuns}
  isLoadingTaskRuns={isLoadingTaskRuns}
  onRunTask={runTask}
  onStopTask={stopTask}
/>
```

Destructure `taskRuns`, `isLoadingTaskRuns`, `runTask`, `stopTask` from `useCompute()`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/compute/
git commit -m "feat(compute): add task UI — run mode selector, task runs tab, conditional detail view"
```

---

## Task 9: Fix Frontend XSS + Error Display

**Files:**
- Modify: `frontend/src/features/compute/components/ContainerDetail.tsx`
- Modify: `frontend/src/features/compute/pages/ComputePage.tsx`

- [ ] **Step 1: Fix endpointUrl XSS**

In `ContainerDetail.tsx`, where `container.endpointUrl` is used as `href`, validate the URL scheme:

```tsx
{container.endpointUrl && container.runMode === 'service' && (
  <a
    href={container.endpointUrl.startsWith('https://') ? container.endpointUrl : '#'}
    target="_blank"
    rel="noopener noreferrer"
    className="text-sm text-blue-500 hover:underline"
  >
    Open
  </a>
)}
```

- [ ] **Step 2: Display containersError in ComputePage**

In `ComputePage.tsx`, show an error state when the containers query fails:

```tsx
if (containersError) {
  return (
    <div className="p-4 text-sm text-red-500">
      Failed to load containers: {containersError.message}
    </div>
  );
}
```

Add this before the loading/empty state checks.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/compute/components/ContainerDetail.tsx frontend/src/features/compute/pages/ComputePage.tsx
git commit -m "fix(compute): fix endpointUrl XSS, display container loading errors"
```

---

## Task 10: Build + Type Check

**Files:** None (verification only)

- [ ] **Step 1: Build shared-schemas**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute/shared-schemas
npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 2: Type-check backend**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute/backend
npx tsc --noEmit
```

Expected: No type errors. If there are errors, fix them and commit.

- [ ] **Step 3: Type-check frontend**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute/frontend
npx tsc --noEmit
```

Expected: No type errors. If there are errors, fix them and commit.

- [ ] **Step 4: Run existing tests**

```bash
cd /Users/gary/projects/insforge-repo/worktrees/compute/backend
npx vitest run
```

Expected: All existing tests pass + new schema tests pass.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore(compute): fix type errors and build issues"
```
