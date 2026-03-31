# Compute: Services & Tasks Design

> Date: 2026-03-30
> Status: Draft
> Supersedes: 2026-03-22-custom-compute-design.md (Phase 1 services-only)

## Overview

Compute lets users deploy their own Docker containers on AWS ECS Fargate. Two run modes:

- **Service** — long-running container with a public URL. ALB routing, health checks, auto-restart, rolling deploys. Use case: web servers, APIs, workers.
- **Task** — run-to-completion container. No URL, no ALB. Runs, exits, captures exit code + logs. Use case: migrations, batch processing, integration tests, data pipelines.

Run mode is set at container creation time and is immutable.

## Architecture

Both modes share:
- The same `compute.containers` table (with a `run_mode` column)
- The same image build pipeline (CodeBuild → ECR)
- The same provider abstraction (`ComputeProvider`)
- The same CloudWatch log group per container

They diverge at execution time:
- Services → `provision()` / `updateService()` + ALB routing
- Tasks → `runTask()` — no ALB, no service, just ECS RunTask

### Build Pipeline

Image builds support two source types:
- **GitHub repo** — cloned by CodeBuild. If a Dockerfile exists, uses `docker build`. Otherwise falls back to Nixpacks auto-detection. Multi-stage builds are fully supported.
- **Pre-built image** — pulled directly from a registry (Docker Hub, ECR, etc.). No build step.

The build pipeline is identical for both run modes. The image is built once on deploy, stored in ECR, and reused for all subsequent service updates or task runs.

## Data Model

### Modified: `compute.containers`

New columns:

```sql
run_mode            TEXT NOT NULL DEFAULT 'service' CHECK (run_mode IN ('service', 'task')),
task_definition_arn TEXT  -- stored after first deploy, used by runTask
```

`run_mode` is set at creation, immutable after. `task_definition_arn` is populated during the first deploy (image build + register) and used by subsequent `runTask` calls.

### New table: `compute.task_runs`

```sql
CREATE TABLE compute.task_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id    UUID NOT NULL REFERENCES compute.containers(id) ON DELETE CASCADE,
  ecs_task_arn    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'stopped')),
  exit_code       INTEGER,
  triggered_by    TEXT NOT NULL DEFAULT 'manual'
                  CHECK (triggered_by IN ('manual', 'api')),
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_task_runs_container_id ON compute.task_runs(container_id);
CREATE INDEX idx_task_runs_container_status ON compute.task_runs(container_id, status);
```

### Unchanged

- `compute.deployments` — remains service-only (deploy/rollback history)
- `compute.container_routes` — remains service-only (ALB/ECS ARN references)

## Provider Interface

### Existing methods (unchanged)

```typescript
buildImage(params: BuildImageParams): Promise<BuildImageResult>;
provision(params: ProvisionParams): Promise<ProvisionResult>;         // services only
updateService(params: UpdateServiceParams): Promise<UpdateServiceResult>; // services only
teardown(params: TeardownParams): Promise<void>;                      // services only
getLogs(containerId: string, options?: LogOptions): Promise<LogStream>;
```

### New methods for tasks

```typescript
// Spin up a one-shot ECS task from an existing task definition
runTask(params: {
  containerId: string;
  taskDefinitionArn: string;
  envVars: Record<string, string>;
}): Promise<{ taskArn: string }>;

// Poll task status and exit code
getTaskStatus(taskArn: string): Promise<{
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  exitCode: number | null;
  startedAt: Date | null;
  stoppedAt: Date | null;
}>;

// Force-stop a running task
stopTask(taskArn: string): Promise<void>;
```

### AWS implementation notes

- `runTask` calls ECS `RunTask` API with the container's registered task definition. No ALB, no target group, no route. Just `RunTask` with `launchType: 'FARGATE'`, the configured subnets/security group, and decrypted env var overrides.
- `getTaskStatus` calls ECS `DescribeTasks` to check `lastStatus`, `containers[0].exitCode`, and timestamps.
- `stopTask` calls ECS `StopTask`.
- Task logs land in the same CloudWatch log group (`/ecs/compute/{containerId}`). The log stream name includes the ECS task ID, so `getLogs` works for both modes — just filter by task ID for a specific run.

## Service Layer

### Deploy flow by run mode

**Service (`run_mode = 'service'`)** — unchanged:
1. Build image (if GitHub source) → push to ECR
2. Register task definition
3. First deploy: `provision()` — create ECS service + ALB target group + listener rule + route record
4. Subsequent deploys: `updateService()` — update task definition on existing service
5. Status: `pending → building → pushing → deploying → live`

**Task (`run_mode = 'task'`)** — new:
1. Build image (if GitHub source) → push to ECR
2. Register task definition
3. Store task definition ARN on the container record
4. Done. No ECS service, no ALB, no route.
5. Status: `pending → building → pushing → ready`

Container status `ready` means the image is built and the task definition is registered — the container is prepared for `runTask` calls.

### Run task flow

1. Validate container `run_mode = 'task'` and status is `ready`
2. Create `task_runs` row with status `pending`
3. Decrypt env vars
4. Call `provider.runTask()` → get `taskArn`
5. Update `task_runs` with `taskArn`, status `running`
6. Fire-and-forget: poll `provider.getTaskStatus()` in background
7. On completion: update `task_runs` with `exit_code`, `finished_at`, final status (`succeeded` if exit code 0, `failed` otherwise)

Multiple task runs can execute concurrently from the same container (no in-flight lock like deployments).

### Delete flow by run mode

**Service** — unchanged: stop service → delete ALB resources → delete DB rows

**Task:**
1. Stop any running tasks via `provider.stopTask()`
2. Deregister task definition (optional cleanup)
3. Delete DB rows (cascade deletes `task_runs`)

## API Routes

### Existing routes (unchanged, service-focused)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/containers` | List containers (both modes) |
| GET | `/containers/:id` | Get container details |
| POST | `/containers` | Create container (accepts `runMode`) |
| PATCH | `/containers/:id` | Update container config |
| DELETE | `/containers/:id` | Delete container |
| POST | `/containers/:id/deploy` | Build image + provision (service) or prepare (task) |
| GET | `/containers/:id/deployments` | Deployment history (services only) |
| POST | `/containers/:id/rollback/:deploymentId` | Rollback (services only) |
| GET | `/containers/:id/logs` | Fetch container logs |

### New routes for tasks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/containers/:id/run` | Trigger a task execution. Returns 202 + task run ID. Returns 400 for services. |
| GET | `/containers/:id/runs` | List task execution history (paginated). Returns 400 for services. |
| GET | `/containers/:id/runs/:runId` | Get single run status, exit code, timestamps. |
| POST | `/containers/:id/runs/:runId/stop` | Force-stop a running task. |
| GET | `/containers/:id/runs/:runId/logs` | Fetch logs for a specific task run. |

### Route behavior guards

- `POST /containers/:id/deploy` — works for both modes. Services: full deploy. Tasks: build + register task def only.
- `POST /containers/:id/run` — tasks only. Returns 400 with message for services.
- `POST /containers/:id/rollback` — services only. Returns 400 with message for tasks.

## Schema Changes (shared-schemas)

### `compute.schema.ts`

- Add `runMode` to `ContainerSchema`: `z.enum(['service', 'task']).default('service')`
- Add `TaskRunSchema`:
  ```typescript
  export const TaskRunSchema = z.object({
    id: z.string().uuid(),
    containerId: z.string().uuid(),
    ecsTaskArn: z.string().nullable(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'stopped']),
    exitCode: z.number().int().nullable(),
    triggeredBy: z.enum(['manual', 'api']),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  });
  ```
- Add container status `ready` to the status enum (for task containers after deploy)

### `compute-api.schema.ts`

- `createContainerSchema`: add `runMode: z.enum(['service', 'task']).default('service')`
- New `runTaskResponseSchema`: `{ taskRunId: z.string().uuid() }`
- New `taskRunListResponseSchema`: paginated list of `TaskRunSchema`

## Cron / Scheduled Runs

Compute does NOT implement its own cron. Instead, users create a Schedule (via the existing Schedules feature) that calls `POST /api/compute/containers/:id/run`.

This avoids duplicating pg_cron plumbing and keeps one cron system to maintain. Schedules already handles cron expressions, execution logging, and retries.

## Frontend Changes

### ComputePage

- Container list shows a badge for run mode (Service / Task)
- "Create Container" modal includes a `runMode` selector

### ContainerDetail (task mode)

- No "endpoint URL" section (tasks have no public URL)
- No "Rollback" button
- Shows "Run" button → triggers `POST /containers/:id/run`
- Shows "Runs" tab instead of "Deployments" tab:
  - Table: status, exit code, triggered by, started at, duration
  - Click a run → view logs for that execution
- Shows "Stop" button on any running task

### ContainerDetail (service mode)

- Unchanged from current implementation

## Critical Bug Fixes (from PR #1031 review)

These must be fixed as part of this work:

1. **Rollback race condition** — `executeDeploy` uses in-memory deployment object where `imageUri` is null. Fix: pass target image URI into `deploy()` so it's part of the record before `executeDeploy` fires.
2. **No project-scoping on `:id` routes** — All per-container routes must verify the container belongs to the caller's project.
3. **`GITHUB_TOKEN` type mismatch** — CodeBuild env var type should be `PLAINTEXT`, not `SECRETS_MANAGER`.
4. **Empty-string ARN fallbacks** — Throw on missing ARNs instead of defaulting to `''`.
5. **No `UNIQUE (project_id, name)` constraint** — Add to migration.
6. **Missing CHECK constraints** — Add for `status`, `cpu`, `memory`, `port` columns.
7. **`endpointUrl` XSS** — Validate as URL before rendering as `href`.
8. **`executeDeploy` catch block** — Wrap secondary DB calls in inner try/catch to avoid swallowing errors.
9. **`deleteContainer` partial teardown** — Handle case where provider teardown succeeds but DB delete fails.

## Out of Scope

- Real-time log streaming (WebSocket) — future enhancement
- Webhook triggers — future enhancement
- DB event triggers — future enhancement
- Dual-mode containers (service + task on same container) — by design, excluded
- ECR / CloudWatch log group cleanup on teardown — future enhancement
