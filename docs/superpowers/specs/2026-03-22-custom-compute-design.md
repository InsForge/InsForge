# Custom Compute — Design Spec

**Date:** 2026-03-22
**Status:** Draft

## Overview

Custom Compute lets InsForge users deploy their own Docker containers alongside InsForge's managed services (database, auth, storage, AI). The container gets a URL, auto-injected InsForge credentials, and runs on AWS ECS Fargate.

**Positioning:** "Bring the code you already have. InsForge runs it and gives it superpowers — a database, auth, storage, and AI out of the box."

**Target users:**

- Developers who need logic that doesn't fit edge functions (ML models, complex processing, non-JS languages)
- Developers with existing backends who want to adopt InsForge incrementally (modular on-ramp)

## Phase 1 Scope

- One container per project
- Always-on, HTTP-serving
- GitHub-connected with auto-build (Nixpacks + Dockerfile support)
- Pre-built image support as alternative
- Custom env vars + auto-injected InsForge credentials
- Default subdomain (`compute.{project}.insforge.app`)

## Phase 2 (Future)

- Multiple containers per project (path/subdomain routing)
- Custom domains with auto-SSL
- Resource tiers (CPU/memory selection in dashboard)
- Event triggers (cron, DB changes, webhooks)
- Long-running services
- ECS on EC2 capacity providers (cost optimization at scale)

## Architecture

### Self-Hosted (Phase 1)

The InsForge open-source backend gets a new `compute` module that talks to AWS directly using credentials the self-hosted user provides.

```
┌─────────────────────────────────┐
│  InsForge (self-hosted EC2)     │
│                                 │
│  Backend ──── AWS SDK ──────────────→  AWS (ECS, ALB,
│  (compute module)               │      CodeBuild, ECR,
│                                 │      Route53)
│  Dashboard                      │
│  (compute UI)                   │
└─────────────────────────────────┘
```

### Cloud Version (Future)

Same compute module, different provider. The backend calls the InsForge Cloud Control Plane instead of AWS directly.

```
┌─────────────────────────────────┐
│  InsForge (managed)             │
│                                 │
│  Backend ──── API call ─────────────→  InsForge Cloud
│  (same compute module,          │      Control Plane
│   different provider)           │          │
│                                 │          ↓
│                                 │      AWS (ECS, etc.)
└─────────────────────────────────┘
```

### Shared AWS Infrastructure (provisioned once)

Set up once before any customer deploys. Done via CDK, Terraform, or manually:

- ECS Cluster (empty)
- ALB + HTTPS listener with wildcard cert (`*.compute.insforge.app`)
- ECR registry
- CodeBuild project
- VPC / subnets / security groups
- Route53 wildcard record (`*.compute.insforge.app` → ALB)
- ECS task execution role (pull ECR images, write CloudWatch Logs)
- IAM policy for the InsForge backend (see Required IAM Policy below)

### Required IAM Policy

The self-hosted user's `COMPUTE_AWS_ACCESS_KEY_ID` must have these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECS",
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition",
        "ecs:DeregisterTaskDefinition",
        "ecs:CreateService",
        "ecs:UpdateService",
        "ecs:DeleteService",
        "ecs:DescribeServices",
        "ecs:DescribeTasks",
        "ecs:ListTasks"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ECR",
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeImages",
        "ecr:BatchDeleteImage"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ALB",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:ModifyRule",
        "elasticloadbalancing:DescribeTargetHealth"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CodeBuild",
      "Effect": "Allow",
      "Action": [
        "codebuild:StartBuild",
        "codebuild:BatchGetBuilds",
        "codebuild:StopBuild"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:GetLogEvents",
        "logs:FilterLogEvents"
      ],
      "Resource": "*"
    },
    {
      "Sid": "PassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": [
        "arn:aws:iam::*:role/insforge-compute-task-role",
        "arn:aws:iam::*:role/insforge-compute-execution-role"
      ]
    }
  ]
}
```

### Request Flow

```
User's browser/client
        ↓
compute.myproject.insforge.app
        ↓
ALB (host-based routing rule)
        ↓
Target Group → Fargate Task (customer's container)
        ↓
Container handles request, can connect to:
  - InsForge Postgres (via connection string env var)
  - InsForge API (via base URL + anon key env vars)
  - Any external service
```

## Data Model

### `compute.containers`

```sql
CREATE TABLE compute.containers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID NOT NULL REFERENCES projects(id),
  name              TEXT NOT NULL DEFAULT 'default',

  -- Source (one of these is set)
  source_type       TEXT NOT NULL CHECK (source_type IN ('github', 'image')),
  github_repo       TEXT,
  github_branch     TEXT,
  image_url         TEXT,
  dockerfile_path   TEXT DEFAULT './Dockerfile',

  -- Runtime config
  cpu               INTEGER NOT NULL DEFAULT 256,
  memory            INTEGER NOT NULL DEFAULT 512,
  port              INTEGER NOT NULL DEFAULT 8080,
  health_check_path TEXT DEFAULT '/health',
  env_vars_encrypted TEXT,              -- AES-256 encrypted JSON blob via SecretService

  -- State
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'building', 'deploying',
                           'running', 'stopped', 'failed')),
  endpoint_url      TEXT,

  -- AWS references
  ecs_service_arn   TEXT,
  ecs_task_def_arn  TEXT,
  target_group_arn  TEXT,
  alb_rule_arn      TEXT,

  -- Scaling (future)
  replicas          INTEGER DEFAULT 1,

  -- Auto-deploy
  auto_deploy           BOOLEAN DEFAULT true,
  github_webhook_id     TEXT,
  github_webhook_secret TEXT,          -- HMAC secret for verifying webhook payloads

  -- Custom domains (future)
  custom_domain     TEXT,

  -- Region (future multi-region)
  region            TEXT DEFAULT 'us-east-1',

  -- Metadata
  last_deployed_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),

  -- Phase 1: one container per project
  CONSTRAINT unique_project_container UNIQUE (project_id)
  -- Remove this constraint in Phase 2 for multiple containers
);
```

### `compute.deployments`

```sql
CREATE TABLE compute.deployments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id  UUID NOT NULL REFERENCES compute.containers(id),

  commit_sha    TEXT,
  image_tag     TEXT,
  build_log_url TEXT,

  status        TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'building', 'pushing',
                     'deploying', 'live', 'failed')),
  error_message TEXT,

  -- Trigger tracking
  triggered_by  TEXT DEFAULT 'manual'
                CHECK (triggered_by IN ('manual', 'git_push',
                       'rollback', 'config_change', 'cron')),

  -- Rollback support
  is_active     BOOLEAN DEFAULT false,

  started_at    TIMESTAMPTZ DEFAULT now(),
  finished_at   TIMESTAMPTZ
);
```

### Logs

Runtime logs are retrieved from CloudWatch using the ECS task ARN (deterministic log group/stream naming). Build logs come from CodeBuild's built-in log output. No separate log table needed — the references are derivable from the ECS and CodeBuild ARNs already stored.

## Backend API Routes

### Container Management

| Method   | Route                       | Description                          |
| -------- | --------------------------- | ------------------------------------ |
| `POST`   | `/compute/containers`       | Create a container config            |
| `GET`    | `/compute/containers`       | List containers for project          |
| `GET`    | `/compute/containers/:id`   | Get container details + status       |
| `PATCH`  | `/compute/containers/:id`   | Update config (env vars, resources)  |
| `DELETE` | `/compute/containers/:id`   | Stop and remove container            |

### Deployment

| Method   | Route                                       | Description                   |
| -------- | ------------------------------------------- | ----------------------------- |
| `POST`   | `/compute/containers/:id/deploy`            | Trigger a deployment          |
| `GET`    | `/compute/containers/:id/deployments`       | List deployment history       |
| `GET`    | `/compute/containers/:id/deployments/:did`  | Get deployment details        |
| `POST`   | `/compute/containers/:id/rollback/:did`     | Rollback to previous deploy   |

### Logs

| Method | Route                                              | Description     |
| ------ | -------------------------------------------------- | --------------- |
| `GET`  | `/compute/containers/:id/logs`                     | Get runtime logs |
| `GET`  | `/compute/containers/:id/deployments/:did/build-log` | Get build log  |

### GitHub Integration

| Method | Route                        | Description                       |
| ------ | ---------------------------- | --------------------------------- |
| `POST` | `/compute/github/connect`    | OAuth flow to connect GitHub      |
| `GET`  | `/compute/github/repos`      | List user's repos                 |
| `POST` | `/compute/github/webhook`    | Incoming webhook for auto-deploy  |

### Provider Abstraction

```typescript
interface ComputeProvider {
  // Build
  buildImage(params: BuildParams): Promise<BuildResult>

  // Container lifecycle
  deploy(params: DeployParams): Promise<DeployResult>
  stop(containerId: string): Promise<void>
  destroy(containerId: string): Promise<void>

  // Status
  getStatus(containerId: string): Promise<ContainerStatus>
  getLogs(containerId: string, opts: LogOpts): Promise<LogStream>

  // Routing
  createRoute(params: RouteParams): Promise<RouteResult>
  deleteRoute(containerId: string): Promise<void>
}
```

Two implementations:

- `AwsFargateProvider` — Phase 1, self-hosted users with AWS credentials
- `InsForgeCloudProvider` — Future, calls InsForge Cloud Control Plane API

Swapping is a config change:

```typescript
const provider = config.computeProvider === 'insforge_cloud'
  ? new InsForgeCloudProvider(config)
  : new AwsFargateProvider(config)
```

## Deploy Pipeline

### GitHub Source Flow

```
1. CLONE
   CodeBuild clones repo from GitHub (branch specified)
   GitHub access: OAuth token stored per-project, passed to CodeBuild
   as GITHUB_TOKEN env var override on startBuild()

2. DETECT
   Dockerfile exists?
   ├── Yes → use it directly
   └── No  → Nixpacks detects runtime, generates Dockerfile

3. BUILD
   CodeBuild runs docker build
   Status: building

4. PUSH
   Push image to ECR
   Tag: {project-id}/{container-name}:{commit-sha}
   Status: pushing

5. REGISTER
   Create ECS Task Definition:
   - Image: ECR image URI
   - CPU/Memory from container config
   - Port mapping
   - Env vars (auto-injected + user-defined)

6. ROUTE (first deploy only)
   - Create Target Group (port, health check path)
   - Create ALB Listener Rule (host header match)
   - (No Route53 step — wildcard DNS already covers it)

7. DEPLOY
   Create or Update ECS Service:
   - Cluster: insforge-compute
   - Task definition: from step 5
   - Desired count: 1
   - Deployment circuit breaker: enabled
   Status: deploying

8. HEALTHY
   ECS health checks against health_check_path
   ├── Pass → Status: running, mark deployment as live
   └── Fail → Status: failed, circuit breaker rolls back
```

### Pre-built Image Flow

Skips steps 1-4. Starts at step 5 with the user-provided image URL.

### Auto-Deploy on Git Push

```
GitHub webhook fires (push to tracked branch)
        ↓
POST /compute/github/webhook
        ↓
Backend verifies webhook signature
        ↓
Finds container with matching repo + branch
        ↓
auto_deploy === true?
├── Yes → triggers full deploy flow
└── No  → ignore
```

### Rollback

Fetches previous deployment's image tag, skips build, goes straight to step 5. Fast redeploy (~30 seconds).

**Constraints:**
- Cannot rollback to a deployment with status `failed`
- Exactly one deployment per container has `is_active = true` at any time
- On successful deploy: set new deployment `is_active = true`, set previous `is_active = false`
- ECR lifecycle policy retains last 10 images per container to ensure rollback targets exist

### Concurrent Deploy Protection

If a container has a deployment with status IN (`building`, `pushing`, `deploying`), reject new deploys with "deployment already in progress."

### Error Handling

| Failure Point       | Behavior                                                         |
| ------------------- | ---------------------------------------------------------------- |
| Clone fails         | Status: failed, log "repo not found or no access"                |
| Build fails         | Status: failed, build log saved, previous deployment stays live  |
| Health check fails  | Status: failed, ECS circuit breaker rolls back automatically     |
| Deploy timeout (10m)| Status: failed, clean up partial resources                       |

### Deploy Timeout Enforcement

The 10-minute timeout spanning build + deploy is enforced via EventBridge:
1. When a deploy starts, create a scheduled EventBridge rule for `now + 10 minutes`
2. The rule invokes a Lambda (or the backend webhook) that checks if the deployment is still in a non-terminal status
3. If still in progress, mark as `failed` and clean up
4. If already completed/failed, the rule is a no-op and gets cleaned up

### Container Status State Machine

```
pending → building → deploying → running
                                    ↓
                                  stopped
Any state → failed
```

### CodeBuild Configuration

The CodeBuild project uses a parameterized buildspec. Parameters passed as environment variable overrides on `startBuild()`:

- `REPO_URL` — GitHub clone URL (https with token)
- `BRANCH` — Git branch
- `DOCKERFILE_PATH` — Path to Dockerfile (or empty for Nixpacks)
- `ECR_REPO` — ECR repository URI
- `IMAGE_TAG` — Tag for the built image

Buildspec steps:
1. Clone repo using `REPO_URL` and `BRANCH`
2. If `DOCKERFILE_PATH` is empty, install and run Nixpacks to generate Dockerfile
3. `docker build` using Dockerfile
4. `docker tag` and `docker push` to `ECR_REPO:IMAGE_TAG`

### Fargate Resource Validation

Fargate only supports specific CPU/memory combinations. The backend must validate:

| CPU (units) | Valid Memory (MB)         |
| ----------- | ------------------------ |
| 256         | 512, 1024, 2048          |
| 512         | 1024, 2048, 3072, 4096   |
| 1024        | 2048, 3072, 4096, ..8192 |

Reject invalid combinations at the API layer before attempting deployment.

### ALB Rule Limits

ALB supports max 100 listener rules (can request increase to 200). At scale, this means:
- Phase 1 (< 100 containers): single ALB is fine
- At scale: add additional ALBs with a Route53 weighted/latency routing layer

## Configuration

### AWS Credentials (self-hosted)

New env vars in the InsForge `.env`:

```bash
# Feature toggle
COMPUTE_ENABLED=true
COMPUTE_PROVIDER=aws_fargate

# AWS credentials
COMPUTE_AWS_ACCESS_KEY_ID=AKIA...
COMPUTE_AWS_SECRET_ACCESS_KEY=...
COMPUTE_AWS_REGION=us-east-1

# Shared infra references (from one-time setup)
COMPUTE_ECS_CLUSTER_ARN=arn:aws:ecs:...
COMPUTE_ALB_LISTENER_ARN=arn:aws:elasticloadbalancing:...
COMPUTE_ECR_REGISTRY=123456789.dkr.ecr.us-east-1.amazonaws.com
COMPUTE_CODEBUILD_PROJECT=insforge-compute-builder
COMPUTE_SUBNET_IDS=subnet-abc,subnet-def
COMPUTE_SECURITY_GROUP_ID=sg-123
COMPUTE_DOMAIN=compute.insforge.app
```

**Networking prerequisites:**

1. `COMPUTE_SUBNET_IDS` and `COMPUTE_SECURITY_GROUP_ID` must be in the same VPC as the InsForge EC2 instance
2. Postgres must be listening on the EC2's private IP (not just `127.0.0.1`) — update Docker Compose `ports` to bind `0.0.0.0:5432:5432` or use host networking
3. The EC2 security group must allow inbound port 5432 from the Fargate security group (or the Fargate subnet CIDR range)
4. `INSFORGE_DB_URL` must use the EC2's private IP, not `localhost`

### Auto-Injected Into Customer Containers

```bash
INSFORGE_DB_URL=postgresql://user:pass@host:5432/db
INSFORGE_BASE_URL=https://project.region.insforge.app
INSFORGE_ANON_KEY=eyJ...
PORT=8080
```

### User-Defined Env Vars

Set via dashboard. The JSON object (e.g., `{"STRIPE_KEY": "sk_live_..."}`) is encrypted using the existing `SecretService` (AES-256) and stored as an opaque blob in `env_vars_encrypted`. Decrypted at deploy time when building the ECS task definition. User-defined vars cannot override auto-injected vars.

### Container Contract

The only requirements for the customer's container:

1. Listen on `$PORT` (default 8080)
2. Respond to `GET {health_check_path}` with 200 (default `/health`)

Any language, any framework, any dependencies.

## Dashboard UI

### Container List View (`/compute`)

Lists all containers for the project. Phase 1 shows one container; Phase 2 shows multiple. Each card shows: name, source repo, endpoint URL, status, resource allocation, last deploy time.

Primary action: **[+ Deploy]** button opens deploy modal.

### Deploy Modal

Two source modes:

- **GitHub repo**: Select repo, branch, Dockerfile path (or auto-detect with Nixpacks), port, health check path
- **Image URL**: Paste image URL, port, health check path

### Container Detail View (`/compute/:id`)

Three tabs:

- **Overview**: Status, endpoint URL, source config, resource allocation, actions (Redeploy, Stop, Delete)
- **Env Vars**: Auto-injected (read-only) and user-defined (editable). Two actions: "Save" (stages changes) and "Save & Redeploy" (saves and triggers deploy). Confirmation dialog before redeploy.
- **Deployments**: Chronological list of all deploys with status, trigger type, commit SHA, timing. Each entry has View Log and Rollback (for non-active deploys) actions.

### Build Log View

Slide-out panel showing streaming build output: clone → detect → install → build → push → deploy → health check result.

## Infrastructure Scaling Path

### Compute Scaling

| Stage                | When              | Migration Effort       |
| -------------------- | ----------------- | ---------------------- |
| ECS Fargate          | Now, < 100 containers | —                  |
| ECS on EC2           | 100-500 containers | Near zero (add capacity providers) |
| EKS                  | 500+ or need K8s features | Significant (K8s manifests) |

Fargate → ECS on EC2 is a config change, same API. EKS is the big jump, only justified for GPU workloads, service mesh, or complex multi-container networking.

### Routing Scaling

| Stage | When | How |
| ----- | ---- | --- |
| ALB host-based rules | Phase 1, < 100 containers | One ALB rule per container. Simple, no extra infra. |
| Traefik reverse proxy | 100+ containers or custom domains at scale | Replace ALB routing with Traefik. Reads routes from DB/API, no rule limits, auto-SSL via Let's Encrypt for custom domains. |

**Why Traefik over other proxies:**
- Simplest to operate — single container, zero config files
- Native Docker/ECS provider — auto-discovers containers
- Built-in Let's Encrypt — auto-SSL for custom domains without extra tooling
- Dynamic routing — add/remove routes via API, no reloads
- Dashboard included — visual route monitoring

**Migration path:** When moving to Traefik, the change is transparent to customers. Containers, URLs, and DNS stay the same. The ALB still terminates TLS for the default `*.compute.insforge.app` wildcard. Traefik sits behind the ALB (or replaces it) and handles host→container routing from a lookup table (Postgres or Redis-backed).

**Alternatives considered:**
- Envoy + xDS control plane — more powerful but requires building a separate control plane service
- OpenResty + Lua — very flexible but Lua scripting adds maintenance burden
- Caddy — good auto-SSL but weaker dynamic config story than Traefik
- Nginx — static config requires reloads; Nginx Plus (dynamic) is paid

## Pricing Model

| Tier     | Resources          | Suggested Price |
| -------- | ------------------ | --------------- |
| Starter  | 0.25 vCPU, 0.5 GB | $15/month       |
| Pro      | 0.5 vCPU, 1 GB    | $30/month       |
| Business | 1 vCPU, 2 GB      | $50/month       |

AWS Fargate cost for Starter tier: ~$9/month. Margin: ~$6/container.
